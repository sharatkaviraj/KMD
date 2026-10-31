import "server-only";

import { randomUUID } from "node:crypto";

import { getOptionalEnvVar, getSiteUrl, getVppsOneEnvironment } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveLanguage, type Language } from "@/platform/i18n/language";
import { currentBells } from "@/modules/substitutions/data/cover-repo";
import {
  classifyResponse,
  mockBehaviourFor,
  outcomeOfThrow,
  renderNotice,
  renderReminder,
  type StaffNoticeKind,
  type TransportOutcome,
} from "@/modules/staff-notices/domain/notices";

/**
 * Sends the staff notices the cover command queued (P4).
 *
 * One notice at a time, each through the three database steps: claim (under a
 * lease, after re-checking it is still true and still useful), stamp (what is
 * about to be sent, before it is), finish (what came back). The transport
 * never decides what a reply means — `classifyResponse` does, and anything
 * short of a receipt id is Unknown.
 *
 * Which transport runs is a deployment fact, read here and nowhere else:
 *
 *   STAFF_NOTICE_TRANSPORT=disabled  nothing is claimed
 *   STAFF_NOTICE_TRANSPORT=mock      a synthetic provider (dev default)
 *   STAFF_NOTICE_TRANSPORT=aisensy   the real one — only with an API key, never
 *                                    under a test runner, and only after the
 *                                    provider gate (prompt 8) is passed
 *
 * A live deployment with nothing set is `disabled`. A real WhatsApp to a
 * member of staff is the school's decision, not a default (CLAUDE.md rule 8).
 *
 * Hook for go-live Phase F (staff consent gates): while staff sending is off,
 * a staff test send is to follow the parent rule — `checkTestOnlySend` in
 * `platform/messaging/parent-send-gate.ts`, i.e. only a number in
 * `vppsone.message_test_recipients`, and only with test-only mode switched on
 * (owner, 31 Oct). Nothing here calls it yet.
 */

export type StaffTransportName = "disabled" | "mock" | "aisensy";

type SendInput = { destination: string; templateCode: string; params: string[]; userName: string; attemptId: string };

type StaffTransport = {
  name: StaffTransportName;
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
          source: "vppsone-staff-cover",
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
  swept: { released: number; unknown: number };
  stopped: "empty" | "disabled" | "limit";
};

/**
 * Send what is due, up to `max`, and say what happened.
 *
 * Safe to run from anywhere at any time — after a cover command, from the
 * nightly job, from a button — and concurrently: two dispatchers never claim
 * the same notice, because the claim is `for update skip locked`.
 */
export async function dispatchStaffNotices(options: { max?: number; noticeId?: string } = {}): Promise<DispatchSummary> {
  const admin = createAdminClient();
  const name = staffTransportName();
  const transport = transportFor(name);
  const worker = `dispatch:${randomUUID()}`;
  const summary: DispatchSummary = {
    transport: name,
    claimed: 0,
    accepted: 0,
    failed: 0,
    unknown: 0,
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

  for (let index = 0; index < (options.max ?? 20); index += 1) {
    const { data: claim, error } = await admin.rpc("claim_staff_notice", {
      p_worker: worker,
      p_lease_seconds: 60,
      p_transport: transport.name,
      p_notice_id: options.noticeId ?? null,
    });
    if (error) throw new Error(`Could not claim a notice: ${error.message}`);

    const claimed = claim as
      | { claimed: false; reason: "empty" | "disabled" }
      | {
          claimed: true;
          attempt_id: string;
          notice: {
            id: string;
            kind: StaffNoticeKind | "attendance_reminder";
            day: string;
            period: number | null;
            session_label: string;
          };
          /** A cover notice's duty; null for an attendance reminder. */
          duty: { id: string; class_labels: string[]; subject_code: string; period: number; day: string } | null;
          /** An attendance reminder's class; null for a cover notice. */
          register: { class_id: string; class_label: string | null; day: string } | null;
          staff: { id: string; display_name: string; language: string };
          destination: string;
        };

    if (!claimed.claimed) {
      summary.stopped = claimed.reason;
      break;
    }
    summary.claimed += 1;

    const language = resolveLanguage(claimed.staff.language);
    let rendered: { templateCode: string; params: string[]; text: { hi: string; en: string } };
    let link: string;

    if (claimed.notice.kind === "attendance_reminder" && claimed.register) {
      // The register itself, which says "Recorded" if it was saved after this
      // went out (P6).
      link = `${siteOrigin()}/teach/attendance?class=${claimed.register.class_id}&day=${claimed.register.day}`;
      rendered = renderReminder({
        staffName: claimed.staff.display_name,
        language,
        day: claimed.register.day,
        classLabel: claimed.register.class_label ?? "",
        link,
      });
    } else if (claimed.duty && claimed.notice.kind !== "attendance_reminder") {
      const sessionLabel = claimed.notice.session_label;
      if (!bellsBySession.has(sessionLabel)) bellsBySession.set(sessionLabel, await currentBells(sessionLabel));
      const bells = bellsBySession.get(sessionLabel)!;
      const duty = claimed.duty;
      const window = bells.periods.find((period) => period.index === duty.period);
      link = `${siteOrigin()}/duty/${duty.id}`;
      rendered = renderNotice({
        kind: claimed.notice.kind,
        staffName: claimed.staff.display_name,
        language,
        day: duty.day,
        period: duty.period,
        periodTime: window ? `${window.starts}–${window.ends}` : null,
        classLabels: duty.class_labels,
        subjectCode: duty.subject_code,
        link,
      });
    } else {
      // A claim naming neither a duty nor a register is a database fault: the
      // constraint forbids it. Leave the attempt to the sweeper rather than
      // send something half-formed.
      continue;
    }

    const { data: stamped } = await admin.rpc("stamp_staff_notice", {
      p_attempt: claimed.attempt_id,
      p_worker: worker,
      p_template: rendered.templateCode,
      p_language: language,
      p_params: { params: rendered.params, text: inLanguage(rendered.text, language) },
      p_link: link,
    });
    if (!stamped) continue; // The lease went; the sweeper will put it back.

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

