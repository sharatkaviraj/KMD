import Link from "@/ui/link";

import { ResumeReminderButton } from "@/modules/whatsapp/ui/reminder-controls";
import { ProfileBadge } from "@/modules/whatsapp/ui/profile-badge";
import { cadenceLabel } from "@/modules/whatsapp/domain/reminder-cadence";
import { profileLabel } from "@/modules/whatsapp/domain/reminder-profile";
import type { PausedFamily, ReminderAudience } from "@/modules/whatsapp/domain/fee-reminders";
import { formatInr } from "@/platform/helpers/currency";

/**
 * The parts of the send screen that explain who is NOT being messaged.
 *
 * They used to be markup inside `RemindersWorkspace`, a client component, so
 * every label and every sentence here shipped to the browser on a route whose
 * gzip ceiling only ratchets down. None of it has client state — the one
 * interactive control, Resume, is its own small client island — so it is
 * rendered here, on the server, and handed to the workspace as nodes. That is
 * what paid for the profile pill and the cost line on every row.
 */

const SKIP_LABELS: Array<{ key: keyof ReminderAudience["skipped"]; label: string }> = [
  // `installmentsClear` counts "did not match your filters" rather than "this
  // notice is not about them" — the notice stopped deciding that.
  { key: "installmentsClear", label: "did not match these filters" },
  { key: "leftAndNeverPaid", label: "left and never paid" },
  { key: "noCallFlagged", label: "flagged no-call by the office" },
  { key: "rteStudent", label: "RTE students" },
  { key: "belowMinimum", label: "below the minimum amount" },
  { key: "noPhoneOnRecord", label: "no phone on record" },
  { key: "phoneUnusable", label: "phone number unusable" },
  // Named in the office's own terms. This is not the ledger saying nothing is
  // owed — it is the family having already said when they will pay.
  { key: "promiseOpen", label: "inside a promise they have already given" },
  { key: "profileNotSelected", label: "left out by their reminder profile" },
  { key: "whatsappNever", label: "set to never remind" },
  { key: "whatsappSnoozed", label: "skipped for now" },
  { key: "whatsappTooSoon", label: "messaged too recently for their cadence" },
];

/** "Left out: 12 did not match these filters · 3 RTE students." */
export function LeftOutSummary({ audience }: { audience: ReminderAudience }) {
  const parts = [
    ...SKIP_LABELS.map((entry) => ({ count: audience.skipped[entry.key], label: entry.label })),
    { count: audience.excludedByHand, label: "removed by hand" },
  ]
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.count} ${entry.label}`);

  return (
    <p className="text-sm text-muted-foreground">
      Left out: {parts.join(" · ") || "nobody"}.
    </p>
  );
}

function pausedReason(family: PausedFamily): string {
  switch (family.reason) {
    case "profile":
      return `${profileLabel(family.profile)} profile — not on this run`;
    case "never":
      return "Set to never remind";
    case "snoozed":
      return `Skipped until ${family.returnsOn}`;
    case "promise_open":
      return `Promised to pay by ${family.returnsOn}`;
    default:
      return `${cadenceLabel(family.cadence)} — next reminder from ${family.returnsOn}`;
  }
}

/** The families the office's own settings are holding back, with a way to undo each. */
export function PausedPanel({
  audience,
  canSend,
}: {
  audience: ReminderAudience;
  canSend: boolean;
}) {
  if (audience.paused.length === 0) return null;
  const count = audience.paused.length;

  return (
    <details className="rounded-lg border border-border bg-surface-2 p-4 text-sm">
      <summary className="cursor-pointer font-medium">
        {count} famil{count === 1 ? "y is" : "ies are"} being held back by your settings — tap to
        review or undo
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        These owe money and would otherwise be on the list. Nothing here is permanent: a skip expires
        on its own, a cadence can be changed back at any time, and a profile is ticked in above.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {audience.paused.map((family) => (
          <li
            key={family.studentId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">
                {family.studentName}{" "}
                <span className="font-normal text-muted-foreground">
                  · {family.studentClass} · {formatInr(family.dueAmount)}
                </span>
              </p>
              <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                {family.reason === "profile" ? <ProfileBadge profile={family.profile} /> : null}
                {pausedReason(family)}
              </p>
            </div>
            {/* Resume resets cadence and snooze. A profile hold-back is the
                run's own choice, undone by ticking the profile in above. A
                promise is the family's own word and outranks cadence, so
                Resume did nothing for them except quietly set their cadence to
                every run; it is not offered. Adding them by hand still works. */}
            {canSend && family.reason !== "profile" && family.reason !== "promise_open" ? (
              <ResumeReminderButton studentId={family.studentId} />
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Families WhatsApp cannot reach — no number, a number that is not a mobile, or
 * numbers WhatsApp has rejected. They need a call, a slip, or a fixed number.
 */
export function UnreachablePanel({ audience }: { audience: ReminderAudience }) {
  if (audience.unreachable.length === 0) return null;
  return (
    <details className="rounded-lg border border-border bg-surface-2 p-4 text-sm">
      <summary className="cursor-pointer font-medium">
        {audience.unreachable.length} families have no number WhatsApp can use — they need a call
      </summary>
      <ul className="mt-3 grid gap-1 md:grid-cols-2">
        {audience.unreachable.slice(0, 20).map((entry) => (
          <li key={entry.studentId} className="text-muted-foreground">
            {entry.admissionNo} · {entry.studentName} · {entry.studentClass}
          </li>
        ))}
      </ul>
      {/* The full list, class-wise, with a printable slip and a link to fix
          each number. Only the second of those gets a family off the list. */}
      <Link
        href="/fees/reminders/unreachable"
        className="focus-ring mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-xs font-semibold"
      >
        Open all {audience.unreachable.length} — print slips, fix numbers
      </Link>
    </details>
  );
}

/** Shown first when nobody on the list can be ticked, so the greyed rows make sense. */
export function EveryoneMessagedNotice({
  audience,
  campaignName,
}: {
  audience: ReminderAudience;
  campaignName: string;
}) {
  const total = audience.candidates.length;
  if (total === 0 || audience.candidates.some((candidate) => !candidate.sentToday)) return null;
  return (
    <div className="rounded-lg border border-success/40 bg-success-soft p-4 text-sm text-success-soft-foreground">
      <p className="font-semibold">Everyone on this list has been messaged today</p>
      <p className="mt-1">
        All {total} of them, through <span className="font-mono">{campaignName}</span>. The same
        notice cannot go to a family twice in one day, which is why nothing below can be ticked.
      </p>
      <p className="mt-1.5">
        A <strong>different</strong> message still can, and so can the same one tomorrow — the list
        rebuilds without whoever pays tonight.
      </p>
    </div>
  );
}
