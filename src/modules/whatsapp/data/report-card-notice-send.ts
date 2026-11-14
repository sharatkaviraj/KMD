import "server-only";

import { sendableCard } from "@/modules/whatsapp/domain/helper-facts";
import {
  REPORT_CARD_NOTICE_TEMPLATE,
  reportCardNoticeKey,
  reportCardNoticeLanguage,
  reportCardNoticeParams,
  reportCardNoticePayloads,
} from "@/modules/whatsapp/domain/report-card-notice";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { logWarn } from "@/platform/observability/log";
import { toE164 } from "@/platform/whatsapp/numbers";
import { sendTemplate, type SendOutcome } from "@/platform/whatsapp/service";
import { readSwitches, readTemplateRow, whatsappDb } from "@/platform/whatsapp/store";

import { readChat, readChildFacts, readHelperSettings } from "./helper-store";

/**
 * "Results are out" from the exam office (D-615): after a class's results
 * are released, one approved message per child, each with its Get report
 * card button. The tap is Veer Patta AI's (D-614): the card goes as its PDF,
 * and only if every exam on it is released, checked again at the tap.
 *
 * Practice only, like the rest of Veer Patta AI. In a TEST year the owner's
 * number stands in for the family of the practice children (Settings →
 * Veer Patta AI), so a class's notice goes to that number for each of them
 * on the class roll. A real year sends nothing: real families wait for the
 * owner to switch them on. Every message still passes `checkWhatsAppSend`
 * (Report cards switched on, the template approved as UTILITY, real
 * recipients off = the owner's number only, practice mode).
 *
 * A child is told once per issued revision of the card (`reportCardNoticeKey`),
 * so a second press tells nobody twice. A child whose card is not issued,
 * not this exam's term or not fully released is left out and counted.
 */

export type NoticeTemplateState = "approved" | "pending" | "rejected" | "marketing" | "missing";

export type ResultsNoticeBoard = {
  template: NoticeTemplateState;
  /** A TEST year: the practice run to the owner's number. */
  practice: boolean;
  ownerSet: boolean;
  /** The children the owner's number stands in for. */
  practiceIds: string[];
  /** Children already told about the card they have now (any revision), this year. */
  toldIds: string[];
};

const TOLD = ["accepted", "sent", "delivered", "read"];

function templateState(rows: ReadonlyArray<{ status: string; category?: string | null } | null>, allowMarketing: boolean): NoticeTemplateState {
  if (rows.some((row) => !row)) return "missing";
  const known = rows as ReadonlyArray<{ status: string; category?: string | null }>;
  if (known.some((row) => row.status === "rejected" || row.status === "disabled" || row.status === "paused")) return "rejected";
  if (known.every((row) => row.status === "approved")) {
    return !allowMarketing && known.some((row) => row.category === "marketing") ? "marketing" : "approved";
  }
  return "pending";
}

/** What the Publish step shows about telling parents. Never throws: an unreadable part reads as not ready. */
export async function readResultsNoticeBoard(sessionLabel: string): Promise<ResultsNoticeBoard> {
  const practice = isTestSessionLabel(sessionLabel);
  try {
    const [hi, en, switches, settings] = await Promise.all([
      readTemplateRow(REPORT_CARD_NOTICE_TEMPLATE.hi).catch(() => null),
      readTemplateRow(REPORT_CARD_NOTICE_TEMPLATE.en).catch(() => null),
      readSwitches(),
      practice ? readHelperSettings() : Promise.resolve(null),
    ]);
    let toldIds: string[] = [];
    if (practice) {
      const { data } = await whatsappDb()
        .from("whatsapp_messages")
        .select("idempotency_key")
        .eq("session_label", sessionLabel)
        .eq("feature", "report_delivery")
        .like("idempotency_key", "results-out:%")
        .in("status", TOLD)
        .limit(500)
        .returns<{ idempotency_key: string | null }[]>();
      toldIds = [...new Set((data ?? []).map((row) => row.idempotency_key?.split(":")[1] ?? "").filter(Boolean))];
    }
    return {
      template: templateState([hi, en], switches?.allowMarketing === true),
      practice,
      ownerSet: Boolean(toE164(switches?.ownerTestNumber ?? "")),
      practiceIds: settings?.practiceStudentIds ?? [],
      toldIds,
    };
  } catch {
    return { template: "missing", practice, ownerSet: false, practiceIds: [], toldIds: [] };
  }
}

export type ResultsNoticeRun =
  | { ok: false; why: "real_year" | "no_practice_child" | "no_owner" | "read_failed" }
  | {
      ok: true;
      /** Accepted by WhatsApp (or waiting a few minutes in its queue). */
      sent: number;
      /** Told before, about this same card. */
      already: number;
      /** Practice mode: written to the WhatsApp log, not sent. */
      logged: number;
      /** No issued card for this term that is fully released. */
      noCard: number;
      /** Stopped by a check (not approved yet, switched off, refused): the first reason, as WhatsApp's checks word it. */
      stopped: { count: number; code: string | null; reason: string | null };
      /** Sent, but WhatsApp refused it or never answered. */
      failed: number;
    };

type IssueRow = { id: string; revision: number; student_name: string | null; class_label: string | null };

async function readIssueRow(input: { sessionLabel: string; studentId: string; term: string }): Promise<IssueRow | null> {
  const { data, error } = await whatsappDb()
    .from("report_card_issues")
    .select("id, revision, student_name:card->>studentName, class_label:card->>classLabel")
    .eq("session_label", input.sessionLabel)
    .eq("student_id", input.studentId)
    .eq("term", input.term)
    .eq("status", "issued")
    .order("revision", { ascending: false })
    .limit(1)
    .returns<IssueRow[]>();
  if (error || !data || data.length !== 1) return null;
  return data[0];
}

/**
 * Tell the practice family of the children on a released class's roll that
 * results are out (D-615). `studentIds` is the class's roll; the caller has
 * checked the class is locked and the exam released, and the card is checked
 * again here (`sendableCard`: issued, and every exam on it released).
 */
export async function sendResultsOutNotices(input: {
  sessionLabel: string;
  term: string;
  exam: { en: string; hi: string | null };
  studentIds: readonly string[];
  /** The staff member's auth user id. */
  requestedBy: string;
}): Promise<ResultsNoticeRun> {
  if (!isTestSessionLabel(input.sessionLabel)) return { ok: false, why: "real_year" };
  const [settings, switches] = await Promise.all([readHelperSettings(), readSwitches()]);
  if (!settings || !switches) return { ok: false, why: "read_failed" };
  const roll = new Set(input.studentIds);
  const ids = settings.practiceStudentIds.filter((id) => roll.has(id));
  if (ids.length === 0) return { ok: false, why: "no_practice_child" };
  const owner = toE164(switches.ownerTestNumber ?? "");
  if (!owner) return { ok: false, why: "no_owner" };

  const [children, chat] = await Promise.all([readChildFacts(ids), readChat(owner)]);
  if (!children) return { ok: false, why: "read_failed" };
  const language = reportCardNoticeLanguage(chat.language);
  const exam = language === "hi" ? (input.exam.hi ?? input.exam.en) : input.exam.en;

  const run = { sent: 0, already: 0, logged: 0, noCard: ids.length - children.length, failed: 0 };
  const stopped: { count: number; code: string | null; reason: string | null } = { count: 0, code: null, reason: null };
  for (const child of children) {
    const sendable = sendableCard(child);
    if (!sendable || sendable.term !== input.term || sendable.child.sessionLabel !== input.sessionLabel) {
      run.noCard += 1;
      continue;
    }
    const issue = await readIssueRow({ sessionLabel: input.sessionLabel, studentId: child.studentId, term: input.term }).catch(() => null);
    // The card read now must be the one the facts read: a card reissued in between waits for the next press.
    if (!issue || issue.revision !== sendable.card.revision) {
      run.noCard += 1;
      continue;
    }
    const name = issue.student_name?.trim() || child.firstName;
    const outcome: SendOutcome = await sendTemplate(
      owner,
      REPORT_CARD_NOTICE_TEMPLATE[language],
      language,
      reportCardNoticeParams({ studentName: name, className: issue.class_label?.trim() || child.className, exam }),
      {
        feature: "report_delivery",
        toName: `Parent of ${name} (practice)`,
        link: { table: "report_card_issues", id: issue.id },
        sessionLabel: input.sessionLabel,
        requestedBy: input.requestedBy,
        idempotencyKey: reportCardNoticeKey({ studentId: child.studentId, term: input.term, revision: issue.revision, to: owner }),
        quickReplies: reportCardNoticePayloads(child.studentId),
      },
    ).catch((caught: unknown) => {
      logWarn("results_notice.send_threw", { error: caught instanceof Error ? caught.message : "unknown" });
      return { outcome: "unknown", logId: "", code: "threw", reason: "" } as const;
    });
    switch (outcome.outcome) {
      case "accepted":
      case "queued":
        run.sent += 1;
        break;
      case "duplicate":
        run.already += 1;
        break;
      case "dry_run":
        run.logged += 1;
        break;
      case "refused":
        stopped.count += 1;
        if (!stopped.code) {
          stopped.code = outcome.code;
          stopped.reason = outcome.reason;
        }
        break;
      default:
        run.failed += 1;
    }
  }
  return { ok: true, ...run, stopped };
}
