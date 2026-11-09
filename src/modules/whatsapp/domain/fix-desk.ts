/**
 * The failure desk's rules: which lane a failed reminder belongs in, which
 * family it is, and what can be done about it right now.
 *
 * Pure, so every decision the desk shows — "Resend to mother's number",
 * "Fix the template first", "Paid since" — is pinned in
 * `tests/unit/whatsapp-fix-desk.test.ts` without a database. The IO is
 * `data/fix-desk.ts`; the screen is `/fees/reminders/fix`.
 *
 * Two things are deliberately NOT stored and are worked out here instead, from
 * the send log and the ledger, so they can never disagree with either:
 *
 * - **Reached later.** A later reminder to the same student went and was not
 *   reported undelivered. The failure is history, not a job.
 * - **Paid since.** Nothing is owed any more on what the failed message asked
 *   for. Resending would chase money already in.
 */

import {
  classifyFailure,
  isDeadNumberCause,
  isFailureCause,
  isSystemicCause,
  resendPolicyFor,
  type ProblemCause,
  type ResendPolicy,
} from "@/modules/whatsapp/domain/failure-cause";
import { phoneKey } from "@/modules/whatsapp/domain/phone-numbers";

/** Minutes a `pending` row waits before it counts as stuck — `data/delivery-store`. */
export const FIX_STUCK_AFTER_MINUTES = 15;

/** How far back the desk looks. Older failures quoted amounts and dates that have moved on. */
export const FIX_WINDOW_DAYS = 30;

export type FixLane = "refused" | "not_delivered" | "stuck" | "no_number" | "left_out";

export const FIX_LANES: ReadonlyArray<{ value: FixLane; label: string; hint: string }> = [
  { value: "refused", label: "Refused", hint: "WhatsApp said no before sending." },
  { value: "not_delivered", label: "Not delivered", hint: "Accepted, then WhatsApp could not deliver it." },
  { value: "stuck", label: "No answer", hint: "The send never heard back. It may or may not have gone." },
  { value: "no_number", label: "No usable number", hint: "Never tried: no number, or not a mobile." },
  { value: "left_out", label: "Left out", hint: "Owes overdue fees, has a number, not messaged lately." },
];

export function isFixLane(value: unknown): value is FixLane {
  return FIX_LANES.some((lane) => lane.value === value);
}

/** One send-log row that may be a problem, as the loader reads it. */
export type FixSendRow = {
  id: string;
  studentId: string;
  runId: string | null;
  sentOn: string;
  createdAt: string;
  campaignName: string;
  destination: string;
  destinationRole: string;
  dueAmount: number;
  status: string;
  deliveryStatus: string | null;
  failureCause: string | null;
  errorMessage: string | null;
  lastError: string | null;
  deliveryError: string | null;
  deliveryErrorCode: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  resolution: string | null;
  /** Students the message covered (`pay_scope.studentIds`), when it says. */
  scopeStudentIds: string[];
};

/** The lane a row is in, or null when it is not a problem at all. */
export function laneOfSend(row: FixSendRow, now: Date): Exclude<FixLane, "no_number" | "left_out"> | null {
  if (row.resolution) return null;
  if (row.status === "failed") return "refused";
  if (row.status === "sent" && row.deliveryStatus === "failed") return "not_delivered";
  if (row.status === "pending") {
    const age = now.getTime() - new Date(row.createdAt).getTime();
    return age >= FIX_STUCK_AFTER_MINUTES * 60_000 ? "stuck" : null;
  }
  return null;
}

/**
 * Why a problem row failed. The stored cause when the row has one; otherwise
 * read from the text, so rows written before `20261030190000` are classified
 * the same way as rows written after it.
 */
export function causeOfSend(row: FixSendRow, lane: FixLane): ProblemCause {
  if (lane === "stuck") return "stuck";
  if (isFailureCause(row.failureCause)) return row.failureCause;
  if (lane === "not_delivered") {
    return classifyFailure({ text: row.deliveryError, code: row.deliveryErrorCode });
  }
  return classifyFailure({ text: row.lastError ?? row.errorMessage });
}

/** The reason as the provider worded it, newest first. */
export function reasonOfSend(row: FixSendRow, lane: FixLane): string | null {
  if (lane === "not_delivered") return row.deliveryError ?? null;
  if (lane === "stuck") return null;
  return row.lastError ?? row.errorMessage ?? null;
}

/**
 * A later reminder that reached this student, so this failure is history.
 *
 * "Reached" means sent (or covered by a sibling's message) and not reported
 * undelivered. Later means a later day, or the same day and created after —
 * the same row taken back and resent is not "later", it is this row, and it
 * stops being a problem the moment its status moves.
 */
export function reachedLater(
  row: Pick<FixSendRow, "id" | "studentId" | "sentOn" | "createdAt">,
  reached: ReadonlyArray<{ id: string; studentId: string; sentOn: string; createdAt: string }>,
): boolean {
  return reached.some(
    (other) =>
      other.id !== row.id &&
      other.studentId === row.studentId &&
      (other.sentOn > row.sentOn || (other.sentOn === row.sentOn && other.createdAt > row.createdAt)),
  );
}

/** What the desk can do for a family right now. */
export type FixAction = {
  policy: ResendPolicy;
  /** Resend is possible this minute. */
  canResend: boolean;
  /** The button, when there is one. */
  label: string;
  /** Why there is no button, in a sentence. */
  blocked: string | null;
  /** Where the resend will actually go, when it differs from where it failed. */
  nextDestination: string | null;
};

/**
 * The one thing to do for a family, decided from the cause and from where the
 * next message would go.
 *
 * `nextDestination` is what the audience would pick NOW (`pickFamilyNumber`):
 * once WhatsApp has marked the father's number dead, it is already the mother's.
 * So a dead-number failure becomes resendable the moment there is somewhere
 * else to send it — a fixed number, or the other parent — and not before.
 */
export function fixActionFor(input: {
  cause: ProblemCause;
  failedDestination: string | null;
  nextDestination: string | null;
  nextParent: "father" | "mother" | null;
  sentOn: string;
  today: string;
}): FixAction {
  const { cause, failedDestination, nextDestination, nextParent, sentOn, today } = input;
  const policy = resendPolicyFor(cause);
  const movedNumber =
    nextDestination !== null && phoneKey(nextDestination) !== phoneKey(failedDestination);
  const to = nextParent === "mother" ? "mother's number" : "father's number";

  if (!nextDestination && cause !== "stuck" && cause !== "left_out") {
    return {
      policy: "needs_number",
      canResend: false,
      label: "Fix number",
      blocked: "No working number on record. Add or correct one, then resend.",
      nextDestination: null,
    };
  }

  switch (policy) {
    case "now":
      return {
        policy,
        canResend: true,
        label: movedNumber ? `Resend to ${to}` : "Resend",
        blocked: null,
        nextDestination,
      };
    case "after_fix":
      return {
        policy,
        canResend: true,
        label: "Resend",
        blocked: null,
        nextDestination,
      };
    case "tomorrow":
      return sentOn < today
        ? { policy, canResend: true, label: "Resend", blocked: null, nextDestination }
        : {
            policy,
            canResend: false,
            label: "Resend",
            blocked: "WhatsApp held this back today. Resend tomorrow.",
            nextDestination,
          };
    case "needs_number":
      return movedNumber
        ? { policy, canResend: true, label: `Resend to ${to}`, blocked: null, nextDestination }
        : {
            policy,
            canResend: false,
            label: "Fix number",
            blocked: "This number cannot get WhatsApp. Fix it, or add the other parent's number.",
            nextDestination,
          };
    case "never":
      return movedNumber
        ? { policy, canResend: true, label: `Resend to ${to}`, blocked: null, nextDestination }
        : {
            policy,
            canResend: false,
            label: "Call",
            blocked: "The family stopped messages from the school on this number. Call them.",
            nextDestination,
          };
    case "check_first":
      return {
        policy,
        canResend: false,
        label: "Check WhatsApp",
        blocked: "Check the school’s WhatsApp dashboard first, then record whether it went.",
        nextDestination,
      };
    case "send_screen":
      return {
        policy,
        canResend: false,
        label: "Add to today's send",
        blocked: null,
        nextDestination,
      };
  }
}

/** One family on the desk: everything that went wrong for one phone. */
export type FixFamily<P extends { sentOn: string; createdAt: string; dueAmount: number }> = {
  key: string;
  problems: P[];
  /** The newest problem, which decides the lane, cause and action. */
  latest: P;
};

/**
 * One card per phone, not per message.
 *
 * Keyed by the number the message went to — siblings on one phone already got
 * one message, and a family failed three days running is one family with three
 * attempts, not three families. A row with no usable number falls back to its
 * student, so it can never merge two strangers.
 */
export function groupIntoFixFamilies<
  P extends { sentOn: string; createdAt: string; dueAmount: number; destination: string; studentId: string },
>(problems: readonly P[]): Array<FixFamily<P>> {
  const byKey = new Map<string, P[]>();
  for (const problem of problems) {
    const key = phoneKey(problem.destination) ?? `student:${problem.studentId}`;
    const list = byKey.get(key);
    if (list) list.push(problem);
    else byKey.set(key, [problem]);
  }
  return [...byKey.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) =>
        a.sentOn === b.sentOn ? b.createdAt.localeCompare(a.createdAt) : b.sentOn.localeCompare(a.sentOn),
      );
      return { key, problems: sorted, latest: sorted[0]! };
    })
    .sort((a, b) => b.latest.dueAmount - a.latest.dueAmount);
}

/**
 * Failures that are the SCHOOL's problem, grouped so the desk shows one banner
 * per template or account fault instead of forty identical rows.
 */
export function systemicGroups<P extends { cause: ProblemCause; campaignName: string; sendId: string }>(
  problems: readonly P[],
): Array<{ cause: ProblemCause; campaignName: string; sendIds: string[]; sample: P }> {
  const groups = new Map<string, { cause: ProblemCause; campaignName: string; sendIds: string[]; sample: P }>();
  for (const problem of problems) {
    if (!isSystemicCause(problem.cause)) continue;
    const key = `${problem.cause}|${problem.campaignName}`;
    const group = groups.get(key);
    if (group) group.sendIds.push(problem.sendId);
    else groups.set(key, { cause: problem.cause, campaignName: problem.campaignName, sendIds: [problem.sendId], sample: problem });
  }
  return [...groups.values()].sort((a, b) => b.sendIds.length - a.sendIds.length);
}

/** Whether a cause means the NUMBER is the problem — the number sheet opens on it. */
export function isNumberProblem(cause: ProblemCause): boolean {
  return cause === "no_number" || isDeadNumberCause(cause);
}

/**
 * What the family still owes on what the failed message asked for: the fees
 * pending on the installments it named, summed over the children it covered.
 * Zero means the resend would chase money already in.
 */
export function owedOnInstallments(
  pendingByStudent: ReadonlyMap<string, readonly number[]>,
  studentIds: readonly string[],
  installments: readonly number[],
): number {
  let total = 0;
  for (const studentId of studentIds) {
    const pending = pendingByStudent.get(studentId);
    if (!pending) continue;
    for (const installment of installments) {
      total += Number(pending[installment - 1] ?? 0);
    }
  }
  return total;
}
