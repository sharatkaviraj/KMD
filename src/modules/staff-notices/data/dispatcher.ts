import "server-only";

import { randomUUID } from "node:crypto";

import { getOptionalEnvVar, getSiteUrl, getVppsOneEnvironment } from "@/platform/env";
import { readWhatsAppConfig } from "@/platform/whatsapp/config";
import { sendTemplate, type SendOutcome } from "@/platform/whatsapp/service";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveLanguage, type Language } from "@/platform/i18n/language";
import { currentBells } from "@/modules/substitutions/data/cover-repo";
import { evaluateStaffSend, MIN_SEND_GAP_MS, paceDelay, type StaffGateFacts } from "@/modules/staff-notices/domain/gates";
import { isOutboxKind, type OutboxKind } from "@/modules/staff-notices/domain/kinds";
import {
  classifyResponse,
  mockBehaviourFor,
  outcomeOfThrow,
  renderDigest,
  renderNotice,
  renderPayloadNotice,
  renderReminder,
  type PayloadKind,
  type StaffNoticeKind,
  type TransportOutcome,
} from "@/modules/staff-notices/domain/notices";

/**
 * Sends what the staff outbox holds (P4, D-214; go-live Phase F, D-356).
 *
 * One notice at a time, each through the database steps: claim (under a
 * lease, after re-checking it is still true and still useful, and reading
 * every fact the staff gate needs), the gate (`domain/gates.ts`: consent,
 * the kind's switch, the person's own switch, the test allowlist, the
 * 07:00–20:00 window, 8 a day, the month's cap, the digest) — and, if the gate
 * says no or not yet, `release_staff_notice` hands it back before anything is
 * sent. Otherwise stamp (what is about to be sent, before it is), send, and
 * finish (what came back). The transport never decides what a reply means —
 * `classifyResponse` does, and anything short of a receipt id is Unknown.
 *
 * Which transport runs is a deployment fact, read here and nowhere else:
 *
 *   STAFF_NOTICE_TRANSPORT=disabled  nothing is claimed
 *   STAFF_NOTICE_TRANSPORT=mock      a synthetic provider
 *   STAFF_NOTICE_TRANSPORT=whatsapp  the school's own number, through the one
 *                                    WhatsApp service — only once this
 *                                    deployment is connected, never under a
 *                                    test runner (`aisensy` is read as this)
 *
 * A live deployment with nothing set is `disabled`. A real WhatsApp to a
 * member of staff is the school's decision, not a default (CLAUDE.md rule 8):
 * even with `whatsapp`, nothing reaches a person who has not consented, and on
 * anything but Vercel production (a confined deployment), nothing reaches a
 * number outside `vppsone.message_test_recipients` — and a confined
 * deployment claims TEST-session notices only (`p_test_only`), so Preview or
 * a local `next dev`, pointed at the one database, never leases, suppresses
 * or sends a real one.
 *
 * WhatsApp is asked at most once a second (plan §8.3) across every run at
 * once: each send takes the next free second from
 * `vppsone.reserve_staff_send_slot` and waits for it. If that cannot be read
 * the run falls back to its own pace.
 */

export type StaffTransportName = "disabled" | "mock" | "whatsapp";

type SendInput = { destination: string; templateCode: string; params: string[]; userName: string; attemptId: string };

export type StaffTransport = {
  name: Exclude<StaffTransportName, "disabled">;
  send(input: SendInput): Promise<TransportOutcome>;
};

export function staffTransportName(): StaffTransportName {
  const underTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
  const raw = getOptionalEnvVar("STAFF_NOTICE_TRANSPORT")?.toLowerCase();
  // `aisensy` is the old name for the real transport; One sends from the school's own number now.
  const declared = raw === "aisensy" ? "whatsapp" : raw;
  const fallback: StaffTransportName = getVppsOneEnvironment() === "live" ? "disabled" : "mock";
  const chosen = (["disabled", "mock", "whatsapp"] as const).find((name) => name === declared) ?? fallback;

  if (chosen === "whatsapp" && (underTest || !readWhatsAppConfig().ok)) return "disabled";
  return chosen;
}

const mockTransport: StaffTransport = {
  name: "mock",
  async send({ destination, attemptId }) {
    const behaviour = mockBehaviourFor(destination);
    switch (behaviour) {
      case "accepted":
        return classifyResponse(200, { submitted_message_id: `mock:${attemptId}` });
      case "slow":
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return classifyResponse(200, { submitted_message_id: `mock:${attemptId}` });
      case "timeout":
        return outcomeOfThrow(new Error("The provider did not answer in time"));
      case "rate_limited":
        return classifyResponse(429, {});
      case "server_error":
        return classifyResponse(503, {});
      case "no_receipt":
        return classifyResponse(200, { status: "ok" });
      default:
        return classifyResponse(400, { message: "Not a valid WhatsApp number" });
    }
  },
};

/**
 * The school's own WhatsApp number, through the one WhatsApp service (D-562).
 * Its policy refuses until the deployment is connected and `staff_notice` is
 * switched on, and while real recipients are off it messages only the
 * owner's test number. Its answer is mapped onto the four outcomes the outbox
 * already knows: anything short of a receipt id is Unknown, never failed.
 */
const whatsappTransport: StaffTransport = {
  name: "whatsapp",
  async send({ destination, templateCode, params, userName, attemptId }) {
    try {
      const outcome = await sendTemplate(`+91${destination}`, templateCode, null, params, {
        feature: "staff_notice",
        toName: userName,
        link: { table: "staff_notice_attempts", id: attemptId },
        // The attempt is the outbox's own claim: the same attempt twice is one message.
        idempotencyKey: `staff_notice:${attemptId}`,
      });
      return transportOutcomeFrom(outcome);
    } catch (error) {
      // Thrown after the request may have left: Unknown, not failed.
      return outcomeOfThrow(error);
    }
  },
};

/** The WhatsApp service's answer as one of the outbox's four outcomes. */
export function transportOutcomeFrom(outcome: SendOutcome): TransportOutcome {
  switch (outcome.outcome) {
    case "accepted":
      return { outcome: "accepted", providerMessageId: outcome.providerMessageId, status: 200 };
    case "duplicate":
      return outcome.providerMessageId
        ? { outcome: "accepted", providerMessageId: outcome.providerMessageId, status: 200 }
        : { outcome: "unknown", status: null, error: "Already handed to WhatsApp once; its answer is not known." };
    case "dry_run":
    case "refused":
      return outcome.outcome === "refused" && outcome.code === "daily_limit"
        ? { outcome: "rate_limited", status: 429, error: outcome.reason }
        : { outcome: "rejected", status: 0, error: `Not sent: ${outcome.reason}` };
    case "rejected":
      return outcome.code === "130429" || outcome.code === "131056"
        ? { outcome: "rate_limited", status: 429, error: outcome.reason }
        : { outcome: "rejected", status: 400, error: outcome.code ? `${outcome.reason} (WhatsApp ${outcome.code})` : outcome.reason };
    case "queued":
    case "unknown":
      return { outcome: "unknown", status: null, error: outcome.reason };
  }
}

function transportFor(name: StaffTransportName): StaffTransport | null {
  if (name === "mock") return mockTransport;
  if (name === "whatsapp") return whatsappTransport;
  return null;
}

/** Where a notice's link points: this deployment, resolved the way the fee app resolves it. */
function siteOrigin(): string {
  return getSiteUrl().replace(/\/$/, "");
}

/** What the reader's language makes of a pair: English first with Hindi help for `both`. */
function inLanguage(text: { hi: string; en: string }, language: Language): string {
  if (language === "hi") return text.hi;
  if (language === "en") return text.en;
  return `${text.en}\n${text.hi}`;
}

export type DispatchSummary = {
  transport: StaffTransportName;
  claimed: number;
  accepted: number;
  failed: number;
  unknown: number;
  /** Handed back by the gate: never sent (no consent, switched off, a cap…). */
  suppressed: number;
  /** Handed back by the gate until later (the 07:00 window, a digest hold). */
  held: number;
  /** Notices folded into a digest that went in their place. */
  digested: number;
  swept: { released: number; unknown: number };
  stopped: "empty" | "disabled" | "limit";
};

type Claim =
  | { claimed: false; reason: "empty" | "disabled" }
  | {
      claimed: true;
      attempt_id: string;
      notice: {
        id: string;
        kind: string;
        day: string;
        period: number | null;
        session_label: string;
        payload: Record<string, unknown> | null;
      };
      /** A cover notice's duty; null otherwise. */
      duty: { id: string; class_labels: string[]; subject_code: string; period: number; day: string } | null;
      /** An attendance reminder's class; null otherwise. */
      register: { class_id: string; class_label: string | null; day: string } | null;
      staff: { id: string; display_name: string; language: string };
      destination: string;
      gate: StaffGateFacts | null;
      student_names: boolean;
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type DispatchOptions = {
  max?: number;
  noticeId?: string;
  /** Tests only: a fake database, transport, clock and sleep. */
  client?: Db;
  transport?: StaffTransport | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  confined?: boolean;
  origin?: string;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Send what is due, up to `max`, and say what happened.
 *
 * Safe to run from anywhere at any time — after a cover command, from the
 * five-minute job, from a button — and concurrently: two dispatchers never
 * claim the same notice, because the claim is `for update skip locked`.
 */
export async function dispatchStaffNotices(options: DispatchOptions = {}): Promise<DispatchSummary> {
  const admin = options.client ?? createAdminClient();
  const name: StaffTransportName = options.transport !== undefined ? (options.transport?.name ?? "disabled") : staffTransportName();
  const transport = options.transport !== undefined ? options.transport : transportFor(name);
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? realSleep;
  const confined = options.confined ?? isConfinedDeployment();
  const worker = `dispatch:${randomUUID()}`;
  const summary: DispatchSummary = {
    transport: name,
    claimed: 0,
    accepted: 0,
    failed: 0,
    unknown: 0,
    suppressed: 0,
    held: 0,
    digested: 0,
    swept: { released: 0, unknown: 0 },
    stopped: "limit",
  };

  const { data: swept } = await admin.rpc("sweep_staff_notices");
  if (swept) summary.swept = swept as DispatchSummary["swept"];

  if (!transport) {
    summary.stopped = "disabled";
    return summary;
  }

  const bellsBySession = new Map<string, Awaited<ReturnType<typeof currentBells>>>();
  let lastProviderCall: number | null = null;

  const release = async (attemptId: string, action: "suppress" | "defer", reason: string, until?: Date) => {
    await admin.rpc("release_staff_notice", {
      p_attempt: attemptId,
      p_worker: worker,
      p_action: action,
      p_reason: reason,
      p_until: until ? until.toISOString() : null,
    });
    if (action === "defer") summary.held += 1;
    else summary.suppressed += 1;
  };

  for (let index = 0; index < (options.max ?? 20); index += 1) {
    const { data, error } = await admin.rpc("claim_staff_notice", {
      p_worker: worker,
      p_lease_seconds: 60,
      p_transport: transport.name,
      p_notice_id: options.noticeId ?? null,
      p_test_only: confined,
    });
    if (error) throw new Error(`Could not claim a notice: ${error.message}`);

    const claimed = data as Claim;
    if (!claimed.claimed) {
      summary.stopped = claimed.reason;
      break;
    }
    summary.claimed += 1;

    const kind = claimed.notice.kind;
    if (!isOutboxKind(kind)) {
      await release(claimed.attempt_id, "suppress", "kind_unknown");
      if (options.noticeId) break;
      continue;
    }

    // The staff gate (domain/gates.ts). Anything but "send" is handed back
    // before a word is rendered or sent.
    const verdict = evaluateStaffSend({ kind, facts: claimed.gate, transport: transport.name, confined, now: now() });
    if (verdict.action !== "send") {
      await release(claimed.attempt_id, verdict.action, verdict.reason, verdict.action === "defer" ? verdict.until : undefined);
      if (options.noticeId) break;
      continue;
    }

    const language = resolveLanguage(claimed.staff.language);
    const origin = options.origin ?? siteOrigin();
    let rendered: { templateCode: string; params: string[]; text: { hi: string; en: string } } | null = null;
    let link = origin;

    try {
      if (verdict.digestCount !== null) {
        const digest = renderDigest(kind, verdict.digestCount, {
          staffName: claimed.staff.display_name,
          language,
          origin,
          studentNames: claimed.student_names === true,
        });
        rendered = digest;
        link = digest.link;
      } else if (kind === "attendance_reminder" && claimed.register) {
        // The register itself, which says "Recorded" if it was saved after this
        // went out (P6).
        link = `${origin}/teach/attendance?class=${claimed.register.class_id}&day=${claimed.register.day}`;
        rendered = renderReminder({
          staffName: claimed.staff.display_name,
          language,
          day: claimed.register.day,
          classLabel: claimed.register.class_label ?? "",
          link,
        });
      } else if (claimed.duty && isCoverKind(kind)) {
        const sessionLabel = claimed.notice.session_label;
        if (!bellsBySession.has(sessionLabel)) bellsBySession.set(sessionLabel, await currentBells(sessionLabel));
        const bells = bellsBySession.get(sessionLabel)!;
        const duty = claimed.duty;
        const window = bells.periods.find((period) => period.index === duty.period);
        link = `${origin}/duty/${duty.id}`;
        rendered = renderNotice({
          kind,
          staffName: claimed.staff.display_name,
          language,
          day: duty.day,
          period: duty.period,
          periodTime: window ? `${window.starts}–${window.ends}` : null,
          classLabels: duty.class_labels,
          subjectCode: duty.subject_code,
          link,
        });
      } else if (claimed.notice.payload && !isCoverKind(kind) && kind !== "attendance_reminder") {
        const payloadNotice = renderPayloadNotice(kind as PayloadKind, claimed.notice.payload, {
          staffName: claimed.staff.display_name,
          language,
          origin,
          studentNames: claimed.student_names === true,
        });
        rendered = payloadNotice;
        link = payloadNotice.link;
      }
    } catch {
      // A rendered message that would carry a phone number (or anything else
      // the renderer refuses) is never sent.
      await release(claimed.attempt_id, "suppress", "render_refused");
      if (options.noticeId) break;
      continue;
    }

    if (!rendered) {
      // A claim naming none of its subject is a database fault: the constraint
      // forbids it. Hand it back rather than send something half-formed.
      await release(claimed.attempt_id, "suppress", "no_subject");
      if (options.noticeId) break;
      continue;
    }

    const { data: stamped } = await admin.rpc("stamp_staff_notice", {
      p_attempt: claimed.attempt_id,
      p_worker: worker,
      p_template: rendered.templateCode,
      p_language: language,
      p_params: { params: rendered.params, text: inLanguage(rendered.text, language), digest: verdict.digestCount },
      p_link: link,
    });
    if (!stamped) continue; // The lease went; the sweeper will put it back.

    if (transport.name === "whatsapp") {
      const wait = await paceWait(admin, lastProviderCall);
      if (wait > 0) await sleep(wait);
      lastProviderCall = Date.now();
    }

    const outcome = await transport.send({
      destination: claimed.destination,
      templateCode: rendered.templateCode,
      params: rendered.params,
      userName: claimed.staff.display_name,
      attemptId: claimed.attempt_id,
    });

    await admin.rpc("finish_staff_notice", {
      p_attempt: claimed.attempt_id,
      p_worker: worker,
      p_outcome: outcome.outcome,
      p_provider_message_id: outcome.outcome === "accepted" ? outcome.providerMessageId : null,
      p_provider_status: outcome.status,
      p_error: outcome.outcome === "accepted" ? null : outcome.error,
    });

    if (outcome.outcome === "accepted") summary.accepted += 1;
    else if (outcome.outcome === "unknown") summary.unknown += 1;
    else summary.failed += 1;

    // The rest of the burst is folded in only once the digest went (or may
    // have): a refused or rate-limited digest folds nothing, so every notice
    // in it is still there for the retry. The database checks the outcome too.
    if (verdict.digestCount !== null && (outcome.outcome === "accepted" || outcome.outcome === "unknown")) {
      const { data: folded } = await admin.rpc("digest_staff_notices", { p_attempt: claimed.attempt_id, p_worker: worker });
      summary.digested += Number(folded ?? 0);
    }

    if (options.noticeId) break;
  }

  return summary;
}

/**
 * How long to wait for this send's second. The database hands out one second
 * per request to every dispatcher at once; if it cannot be asked, this run
 * keeps its own pace, which is still one a second within the run.
 */
async function paceWait(admin: Db, lastProviderCall: number | null): Promise<number> {
  try {
    const { data, error } = await admin.rpc("reserve_staff_send_slot", { p_gap_ms: MIN_SEND_GAP_MS });
    const slot = !error && typeof data === "string" ? Date.parse(data) : Number.NaN;
    if (Number.isFinite(slot)) return Math.max(0, slot - Date.now());
  } catch {
    // Fall through to the run's own pace.
  }
  return paceDelay(lastProviderCall, Date.now());
}

function isCoverKind(kind: OutboxKind): kind is StaffNoticeKind {
  return kind === "cover_assigned" || kind === "cover_changed" || kind === "cover_cancelled" || kind === "cover_escalation";
}
