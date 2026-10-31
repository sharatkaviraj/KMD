import "server-only";

import { randomUUID } from "node:crypto";

import { getOptionalEnvVar, getSiteUrl, getVppsOneEnvironment } from "@/platform/env";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveLanguage, type Language } from "@/platform/i18n/language";
import { currentBells } from "@/modules/substitutions/data/cover-repo";
import { evaluateStaffSend, paceDelay, type StaffGateFacts } from "@/modules/staff-notices/domain/gates";
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
 *   STAFF_NOTICE_TRANSPORT=aisensy   the real one — only with an API key, never
 *                                    under a test runner
 *
 * A live deployment with nothing set is `disabled`. A real WhatsApp to a
 * member of staff is the school's decision, not a default (CLAUDE.md rule 8):
 * even with `aisensy`, nothing reaches a person who has not consented, and on
 * anything but Vercel production (a confined deployment), nothing reaches a
 * number outside `vppsone.message_test_recipients`.
 *
 * AiSensy is asked at most once a second (plan §8.3), within a run. Two runs
 * at once each keep their own pace; the cron runs one.
 */

export type StaffTransportName = "disabled" | "mock" | "aisensy";

type SendInput = { destination: string; templateCode: string; params: string[]; userName: string; attemptId: string };

export type StaffTransport = {
  name: Exclude<StaffTransportName, "disabled">;
  send(input: SendInput): Promise<TransportOutcome>;
};

const PROVIDER_TIMEOUT_MS = 10_000;

export function staffTransportName(): StaffTransportName {
  const underTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
  const declared = getOptionalEnvVar("STAFF_NOTICE_TRANSPORT")?.toLowerCase();
  const fallback: StaffTransportName = getVppsOneEnvironment() === "live" ? "disabled" : "mock";
  const chosen = (["disabled", "mock", "aisensy"] as const).find((name) => name === declared) ?? fallback;

  if (chosen === "aisensy" && (underTest || !getOptionalEnvVar("AISENSY_API_KEY"))) return "disabled";
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

const aisensyTransport: StaffTransport = {
  name: "aisensy",
  async send({ destination, templateCode, params, userName }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const response = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: getOptionalEnvVar("AISENSY_API_KEY"),
          campaignName: templateCode,
          destination: `91${destination}`,
          userName,
          templateParams: params,
          source: "vppsone/staff-notice",
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      return classifyResponse(response.status, body);
    } catch (error) {
      // Aborted or dropped after the request may have left: Unknown, not failed.
      return outcomeOfThrow(error);
    } finally {
      clearTimeout(timer);
    }
  },
};

function transportFor(name: StaffTransportName): StaffTransport | null {
  if (name === "mock") return mockTransport;
  if (name === "aisensy") return aisensyTransport;
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

    if (verdict.digestCount !== null) {
      const { data: folded } = await admin.rpc("digest_staff_notices", { p_attempt: claimed.attempt_id, p_worker: worker });
      summary.digested += Number(folded ?? 0);
    }

    if (transport.name === "aisensy") {
      const wait = paceDelay(lastProviderCall, Date.now());
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

    if (options.noticeId) break;
  }

  return summary;
}

function isCoverKind(kind: OutboxKind): kind is StaffNoticeKind {
  return kind === "cover_assigned" || kind === "cover_changed" || kind === "cover_cancelled" || kind === "cover_escalation";
}
