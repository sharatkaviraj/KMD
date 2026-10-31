import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/ui/shell/page-header";
import { OfficeNotice } from "@/ui/office/office-ui";
import { NavLink } from "@/ui/shell/nav-link";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import {
  hasAnyStaffPermission,
  hasStaffPermission,
  requireAnyStaffPermission,
} from "@/modules/fees/platform/session";
import { formatInr } from "@/platform/helpers/currency";
import { formatDateTimeIst, formatDdMmYyyy } from "@/platform/helpers/date";
import { cn } from "@/platform/utils";
import { resolveReminderSessionLabel } from "@/modules/whatsapp/data/reminder-session";
import {
  describeAttemptResult,
  loadFixDesk,
  loadFixTimeline,
  type FixDesk,
  type FixPerson,
  type FixProblem,
} from "@/modules/whatsapp/data/fix-desk";
import { CAUSE_COPY, type ProblemCause } from "@/modules/whatsapp/domain/failure-cause";
import { FIX_LANES, isFixLane, type FixFamily, type FixLane } from "@/modules/whatsapp/domain/fix-desk";
import { toWhatsappDestination } from "@/modules/whatsapp/domain/phone";
import { phoneKey } from "@/modules/whatsapp/domain/phone-numbers";
import { RemindersNav } from "@/modules/whatsapp/ui/reminders-nav";
import {
  HandledForm,
  ImportReportForm,
  NumberHealthForm,
  NumberSheet,
  ResendForm,
  StuckForm,
} from "./fix-forms";

/**
 * The failure desk: every family a fee reminder did not reach, why, and the one
 * thing that fixes it.
 *
 * Five lanes — refused by AiSensy, not delivered by WhatsApp, no answer, no
 * usable number, left out — all from `loadFixDesk`, so the tab's red count is
 * the number of cards here. Lanes and causes are LINKS, not client state, the
 * way the Dashboard's boards are: every view stays linkable and the back button
 * stays honest, and the page ships only the small forms it needs.
 *
 * A SUB-PAGE, so a mobile takeover: `MobileBottomNav` is not rendered under
 * `/fees/reminders/`, and bottom spacing is the safe area only.
 */

export const revalidate = 0;

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const TONE_CLASS: Record<string, string> = {
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
  warning: "border-warning/30 bg-warning/10 text-warning",
  neutral: "border-border bg-surface-2 text-muted-foreground",
  info: "border-info/25 bg-info/10 text-info",
};

function CauseTag({ cause }: { cause: ProblemCause }) {
  const copy = CAUSE_COPY[cause];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold",
        TONE_CLASS[copy.tone],
      )}
    >
      {copy.label}
    </span>
  );
}

function prettyPhone(raw: string | null | undefined): string {
  const destination = toWhatsappDestination(raw);
  if (destination) return `${destination.slice(3, 8)} ${destination.slice(8)}`;
  return String(raw ?? "").trim() || "none";
}

/** The Send screen, opened on these families, the installments the calendar has passed. */
function sendScreenHref(studentIds: string[], installments: number[]): string {
  const params = new URLSearchParams();
  if (installments.length > 0) params.set("installments", installments.join(","));
  params.set("include", studentIds.slice(0, 120).join(","));
  return `/fees/reminders?${params.toString()}`;
}

function deadKeysOf(desk: FixDesk, problem: FixProblem | null): Record<string, string> {
  const keys: Record<string, string> = {};
  const failed = problem ? phoneKey(problem.destination) : null;
  if (failed && problem && (desk.failuresByKey[failed] ?? 0) > 0) {
    keys[failed] = `WhatsApp rejected this number (${CAUSE_COPY[problem.cause].label.toLowerCase()})`;
  }
  return keys;
}

export default async function FixPage({ searchParams }: Props) {
  const staff = await requireAnyStaffPermission(["settings:view", "settings:write"], {
    onDenied: "redirect",
  });
  const canSend = hasStaffPermission(staff, "settings:write");
  const canEditNumbers = hasAnyStaffPermission(staff, ["students:write", "students:edit_basic"]);
  const params = (await searchParams) ?? {};
  const laneParam = one(params.lane);
  const lane: FixLane | null = isFixLane(laneParam) ? laneParam : null;
  const causeParam = one(params.cause);
  const familyParam = one(params.family);

  const supabase = createAdminClient();
  const sessionLabel = await resolveReminderSessionLabel(supabase);

  let desk: FixDesk;
  try {
    desk = await loadFixDesk(sessionLabel);
  } catch (caught) {
    return (
      <div className="flex flex-col gap-5" style={{ paddingBottom: "calc(var(--mobile-safe-area-bottom, 0px) + 0.75rem)" }}>
        <PageHeader eyebrow="Reminders" title="Families we didn't reach" />
        <RemindersNav active="fix" />
        <OfficeNotice title="Could not load the failures" tone="danger">
          {caught instanceof Error ? caught.message : "Something went wrong reading the send log."}
        </OfficeNotice>
      </div>
    );
  }

  const hrefWith = (override: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const base: Record<string, string | null> = { lane, cause: causeParam || null, family: null };
    for (const [key, value] of Object.entries({ ...base, ...override })) {
      if (value) next.set(key, value);
    }
    const text = next.toString();
    return text ? `?${text}` : "?";
  };

  const problemLane = lane === null || lane === "refused" || lane === "not_delivered" || lane === "stuck";
  const shownFamilies = desk.families.filter(
    (family) =>
      (lane === null || family.latest.lane === lane) &&
      (!causeParam || family.latest.cause === causeParam),
  );
  const causesInView = [
    ...new Set(
      desk.families
        .filter((family) => lane === null || family.latest.lane === lane)
        .map((family) => family.latest.cause),
    ),
  ];
  const resendable = shownFamilies.filter((family) => family.latest.action.canResend);
  const selected =
    shownFamilies.find((family) => family.key === familyParam) ?? (problemLane ? shownFamilies[0] : undefined);
  const selectedByParam = Boolean(familyParam && selected?.key === familyParam);

  const timeline = selected
    ? await loadFixTimeline(supabase, {
        sendIds: selected.problems.map((problem) => problem.sendId),
        studentIds: [...new Set(selected.problems.flatMap((problem) => problem.coveredStudentIds))],
        since: selected.problems[selected.problems.length - 1]!.sentOn,
      }).catch(() => [])
    : [];

  const laneCount = (value: FixLane) => desk.laneCounts[value];
  const totalOpen = desk.families.length;

  return (
    <div
      className="flex flex-col gap-5"
      style={{ paddingBottom: "calc(var(--mobile-safe-area-bottom, 0px) + 0.75rem)" }}
    >
      <PageHeader
        eyebrow="Reminders"
        title="Families we didn't reach"
        description={`Session ${sessionLabel} · last ${30} days · ${
          desk.lastReportAt
            ? `AiSensy report last imported ${formatDateTimeIst(desk.lastReportAt)}`
            : "no AiSensy report imported yet"
        }`}
        mobileEyebrow={`${totalOpen} to fix · ${desk.noNumber.length} no number`}
      />
      <RemindersNav active="fix" />

      {desk.degraded ? (
        <OfficeNotice title="Delivery reasons are not being stored yet" tone="warning">
          The database update for the failure desk has not run. Failures still show, but
          resolutions and AiSensy&apos;s reasons cannot be saved until it does.
        </OfficeNotice>
      ) : null}

      {/* ------------------------------------------------------------ lanes */}
      <nav aria-label="Lanes" className="-mx-1">
        <ul className="no-scrollbar flex snap-x gap-2 overflow-x-auto px-1 pb-1 md:grid md:grid-cols-6 md:overflow-visible">
          <li className="shrink-0 snap-start">
            <NavLink
              href={hrefWith({ lane: null, cause: null })}
              aria-current={lane === null ? "true" : undefined}
              className={cn(
                "tap focus-ring flex h-full min-h-16 w-36 flex-col justify-between rounded-xl border bg-card p-3 md:w-auto",
                lane === null ? "border-accent ring-1 ring-accent" : "border-border",
              )}
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Didn&apos;t get it</span>
              <span className="text-xl font-extrabold tabular-nums">{totalOpen}</span>
              <span className="text-[11px] text-muted-foreground">{formatInr(desk.owedByFailed)} asked for</span>
            </NavLink>
          </li>
          {FIX_LANES.map((entry) => {
            const active = lane === entry.value;
            return (
              <li key={entry.value} className="shrink-0 snap-start">
                <NavLink
                  href={hrefWith({ lane: active ? null : entry.value, cause: null })}
                  aria-current={active ? "true" : undefined}
                  title={entry.hint}
                  className={cn(
                    "tap focus-ring flex h-full min-h-16 w-36 flex-col justify-between rounded-xl border bg-card p-3 md:w-auto",
                    active ? "border-accent ring-1 ring-accent" : "border-border",
                  )}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{entry.label}</span>
                  <span className="text-xl font-extrabold tabular-nums">{laneCount(entry.value)}</span>
                  <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{entry.hint}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ------------------------------------------------------ not checked */}
      <section className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-bold">
            <span className="tabular-nums">{desk.notChecked}</span> of{" "}
            <span className="tabular-nums">{desk.sentInWindow}</span> reminders sent in the last 30
            days have no delivery result
          </h2>
          <p className="text-xs text-muted-foreground">
            &ldquo;Sent&rdquo; means AiSensy accepted it, not that a phone received it. Download
            the campaign report from the AiSensy dashboard and import it here: undelivered
            messages then appear above with WhatsApp&apos;s reason. One file covers every run that
            used that campaign.
          </p>
        </div>
        {canSend ? <ImportReportForm /> : null}
      </section>

      {/* ------------------------------------------------- systemic banners */}
      {problemLane
        ? desk.systemic.map((group) => (
            <OfficeNotice
              key={`${group.cause}-${group.campaignName}`}
              tone="danger"
              title={`${group.sendIds.length} refused for the same reason: ${CAUSE_COPY[group.cause].label}`}
              action={
                canSend ? (
                  <ResendForm sendIds={group.sendIds} label={`Resend all ${group.sendIds.length}`} />
                ) : undefined
              }
            >
              <span className="block">{CAUSE_COPY[group.cause].explanation}</span>
              <span className="mt-1 block text-xs">
                Template <code className="font-mono">{group.campaignName}</code>
                {group.reason ? ` · AiSensy said: “${group.reason}”` : ""}
              </span>
            </OfficeNotice>
          ))
        : null}

      {/* -------------------------------------------------------- problems */}
      {problemLane ? (
        <>
          {causesInView.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by cause">
              <NavLink
                href={hrefWith({ cause: null })}
                aria-current={!causeParam ? "true" : undefined}
                className={cn(
                  "tap focus-ring inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-semibold md:min-h-8",
                  !causeParam ? "border-foreground bg-foreground text-background" : "border-border bg-card",
                )}
              >
                All causes
              </NavLink>
              {causesInView.map((cause) => (
                <NavLink
                  key={cause}
                  href={hrefWith({ cause: causeParam === cause ? null : cause })}
                  aria-current={causeParam === cause ? "true" : undefined}
                  className={cn(
                    "tap focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold md:min-h-8",
                    causeParam === cause ? "border-foreground bg-foreground text-background" : "border-border bg-card",
                  )}
                >
                  {CAUSE_COPY[cause].label}
                  <span className="tabular-nums opacity-70">{desk.causeCounts[cause] ?? 0}</span>
                </NavLink>
              ))}
            </div>
          ) : null}

          {shownFamilies.length === 0 ? (
            <OfficeNotice
              title={desk.notChecked > 0 && desk.lastReportAt === null ? "Nothing failed that we know of" : "Nothing to fix"}
              tone={desk.notChecked > 0 && desk.lastReportAt === null ? "info" : "success"}
            >
              {desk.notChecked > 0 && desk.lastReportAt === null
                ? "AiSensy refused nothing, but no delivery report has been imported, so undelivered messages cannot show here yet."
                : "Every reminder in this view either arrived, was resent, or was handled."}
            </OfficeNotice>
          ) : (
            <>
              {canSend && resendable.length > 1 ? (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 md:flex-row md:items-center md:justify-between">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground tabular-nums">{resendable.length}</span>{" "}
                    of {shownFamilies.length} can be resent now. The rest need a number, a fix in
                    AiSensy, or a call first.
                  </p>
                  <ResendForm
                    sendIds={resendable.flatMap((family) => family.problems.map((problem) => problem.sendId))}
                    label={`Resend ${resendable.length} that can go`}
                  />
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:items-start">
                <ul className="flex flex-col gap-2.5" aria-label="Families">
                  {shownFamilies.map((family) => (
                    <FamilyCard
                      key={family.key}
                      family={family}
                      selected={family.key === selected?.key}
                      href={hrefWith({ family: family.key })}
                      canSend={canSend}
                      canEditNumbers={canEditNumbers}
                      deadKeys={deadKeysOf(desk, family.latest)}
                    />
                  ))}
                </ul>

                {selected ? (
                  <aside
                    aria-label="Selected family"
                    className={cn(
                      "flex-col gap-4 rounded-xl border border-border bg-card p-4 md:sticky md:top-4 md:flex",
                      selectedByParam ? "order-first flex md:order-none" : "hidden",
                    )}
                  >
                    {selectedByParam ? (
                      <Link
                        href={hrefWith({ family: null })}
                        className="focus-ring inline-flex min-h-11 items-center text-xs font-semibold text-accent md:hidden"
                      >
                        ← Back to the list
                      </Link>
                    ) : null}
                    <FamilyDetail
                      family={selected}
                      desk={desk}
                      timeline={timeline}
                      canSend={canSend}
                      canEditNumbers={canEditNumbers}
                    />
                  </aside>
                ) : null}
              </div>
            </>
          )}

          {(lane === null && (desk.noNumber.length > 0 || desk.leftOut.length > 0)) ? (
            <div className="grid gap-2 md:grid-cols-2">
              {desk.noNumber.length > 0 ? (
                <NavLink
                  href={hrefWith({ lane: "no_number", cause: null })}
                  className="tap focus-ring flex min-h-11 items-center justify-between rounded-xl border border-border bg-card p-3 text-sm"
                >
                  <span>
                    <strong className="tabular-nums">{desk.noNumber.length}</strong> owing families have no
                    number WhatsApp can use
                  </span>
                  <span aria-hidden="true">→</span>
                </NavLink>
              ) : null}
              {desk.leftOut.length > 0 ? (
                <NavLink
                  href={hrefWith({ lane: "left_out", cause: null })}
                  className="tap focus-ring flex min-h-11 items-center justify-between rounded-xl border border-border bg-card p-3 text-sm"
                >
                  <span>
                    <strong className="tabular-nums">{desk.leftOut.length}</strong> owing families not
                    messaged since {formatDdMmYyyy(desk.leftOutSince)}
                  </span>
                  <span aria-hidden="true">→</span>
                </NavLink>
              ) : null}
            </div>
          ) : null}

          {desk.sortedItself.length > 0 ? (
            <details className="rounded-xl border border-border bg-card p-4 text-sm">
              <summary className="cursor-pointer font-semibold">
                {desk.sortedItself.length} sorted themselves out: reached later, or paid since
              </summary>
              <ul className="mt-3 flex flex-col gap-1.5 text-xs text-muted-foreground">
                {desk.sortedItself.slice(0, 40).map(({ problem, why }) => (
                  <li key={problem.sendId}>
                    <span className="font-semibold text-foreground">{problem.studentName}</span> (
                    {problem.admissionNo}) · {CAUSE_COPY[problem.cause].label} on{" "}
                    {formatDdMmYyyy(problem.sentOn)} ·{" "}
                    <span className="font-semibold text-success">
                      {why === "paid" ? "Paid since ✓" : "Reached by a later reminder ✓"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      {/* ------------------------------------------------------- no number */}
      {lane === "no_number" ? (
        <PeopleList
          people={desk.noNumber}
          empty="Every owing family has a number WhatsApp can use."
          intro={
            <>
              These families owe fees on installments that have fallen due, and WhatsApp cannot
              reach them. Add or correct a number, and they join the next reminder.{" "}
              <Link href="/fees/reminders/unreachable" className="font-semibold text-accent underline-offset-2 hover:underline">
                Print slips for all of them
              </Link>
              .
            </>
          }
          passed={desk.passedInstallments}
          canEditNumbers={canEditNumbers}
          canSend={canSend}
          kind="no_number"
        />
      ) : null}

      {/* -------------------------------------------------------- left out */}
      {lane === "left_out" ? (
        <PeopleList
          people={desk.leftOut}
          empty="Every owing family with a number has been messaged since the latest installment fell due."
          intro={
            <>
              These families owe on installments that have fallen due and have a working number,
              but have not been messaged since {formatDdMmYyyy(desk.leftOutSince)}. Usually that
              is because the runs since then chased other installments.
              {canSend && desk.leftOut.length > 0 ? (
                <>
                  {" "}
                  <Link
                    href={sendScreenHref(
                      desk.leftOut.slice(0, 60).flatMap((person) => person.studentIds),
                      desk.passedInstallments,
                    )}
                    className="font-semibold text-accent underline-offset-2 hover:underline"
                  >
                    Open the Send screen with {Math.min(60, desk.leftOut.length)} of them added
                  </Link>
                  .
                </>
              ) : null}
            </>
          }
          passed={desk.passedInstallments}
          canEditNumbers={canEditNumbers}
          canSend={canSend}
          kind="left_out"
        />
      ) : null}
    </div>
  );
}

/** One family on the list: name, money, number, cause, and the one button. */
function FamilyCard({
  family,
  selected,
  href,
  canSend,
  canEditNumbers,
  deadKeys,
}: {
  family: FixFamily<FixProblem>;
  selected: boolean;
  href: string;
  canSend: boolean;
  canEditNumbers: boolean;
  deadKeys: Record<string, string>;
}) {
  const problem = family.latest;
  const copy = CAUSE_COPY[problem.cause];
  const sendIds = family.problems.map((entry) => entry.sendId);
  return (
    <li
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border bg-card p-3",
        selected ? "border-accent ring-1 ring-accent md:ring-2" : "border-border",
      )}
    >
      <NavLink href={href} className="focus-ring flex flex-col gap-1 rounded-md">
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">
            {problem.studentName}
            {problem.siblingNames.length > 0 ? (
              <span className="font-normal text-muted-foreground"> + {problem.siblingNames.join(", ")}</span>
            ) : null}
          </span>
          <span className="shrink-0 font-bold tabular-nums">{formatInr(problem.dueAmount)}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {problem.admissionNo} · {problem.studentClass} · <span className="font-mono">{prettyPhone(problem.destination)}</span>
          {family.problems.length > 1 ? ` · ${family.problems.length} failures` : ""} ·{" "}
          {formatDdMmYyyy(problem.sentOn)}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <CauseTag cause={problem.cause} />
          <span className="text-muted-foreground">{copy.hindi}</span>
        </span>
      </NavLink>
      <FamilyAction
        problem={problem}
        sendIds={sendIds}
        canSend={canSend}
        canEditNumbers={canEditNumbers}
        deadKeys={deadKeys}
      />
    </li>
  );
}

/** The single right button for a family, decided by `fixActionFor`. */
function FamilyAction({
  problem,
  sendIds,
  canSend,
  canEditNumbers,
  deadKeys,
}: {
  problem: FixProblem;
  sendIds: string[];
  canSend: boolean;
  canEditNumbers: boolean;
  deadKeys: Record<string, string>;
}) {
  const action = problem.action;
  if (problem.lane === "stuck") {
    return canSend ? <StuckForm sendIds={sendIds} /> : <p className="text-xs text-muted-foreground">{action.blocked}</p>;
  }
  if (action.canResend && canSend) {
    return <ResendForm sendIds={sendIds} label={action.label} />;
  }
  if (action.policy === "needs_number" && canEditNumbers) {
    return (
      <NumberSheet
        studentId={problem.studentId}
        studentName={problem.studentName}
        fatherPhone={problem.fatherPhone}
        motherPhone={problem.motherPhone}
        siblingIds={problem.coveredStudentIds.filter((id) => id !== problem.studentId)}
        siblingNames={problem.siblingNames}
        sendIds={sendIds}
        canResend={canSend}
        deadKeys={deadKeys}
        triggerLabel="Fix number"
      />
    );
  }
  if (action.policy === "never") {
    return (
      <p className="flex min-h-11 flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">{action.blocked}</span>
        <a href={`tel:${toWhatsappDestination(problem.destination) ?? problem.destination}`} className="font-mono font-semibold text-accent">
          {prettyPhone(problem.destination)}
        </a>
      </p>
    );
  }
  return action.blocked ? <p className="text-xs text-muted-foreground">{action.blocked}</p> : null;
}

/** Everything about one family: why, both numbers, what happened, and what to do. */
function FamilyDetail({
  family,
  desk,
  timeline,
  canSend,
  canEditNumbers,
}: {
  family: FixFamily<FixProblem>;
  desk: FixDesk;
  timeline: Awaited<ReturnType<typeof loadFixTimeline>>;
  canSend: boolean;
  canEditNumbers: boolean;
}) {
  const problem = family.latest;
  const copy = CAUSE_COPY[problem.cause];
  const sendIds = family.problems.map((entry) => entry.sendId);
  const failedKey = phoneKey(problem.destination);
  const numbers = [
    { label: "Father", raw: problem.fatherPhone },
    { label: "Mother", raw: problem.motherPhone },
  ];

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-bold">
          {[problem.studentName, ...problem.siblingNames].join(" & ")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {problem.studentClass} · {problem.admissionNo}
          {problem.parentName ? ` · ${problem.parentName}` : ""} · asked for{" "}
          {formatInr(problem.dueAmount)}
        </p>
      </div>

      <div className={cn("flex flex-col gap-1 rounded-lg border p-3", TONE_CLASS[copy.tone])}>
        <span className="font-bold">{copy.label}</span>
        <span className="text-foreground">{copy.hindi}</span>
        <span className="text-xs text-foreground">{copy.explanation}</span>
        {problem.reason ? (
          <span className="mt-1 text-xs text-muted-foreground">
            {problem.lane === "not_delivered" ? "WhatsApp said" : "AiSensy said"}: &ldquo;{problem.reason}&rdquo;
            {problem.errorCode ? ` (code ${problem.errorCode})` : ""}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {problem.lane === "not_delivered" ? "From the AiSensy report" : "When it was sent"} ·{" "}
          {formatDdMmYyyy(problem.sentOn)} · tried {problem.attempts}×
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Numbers</h3>
        {numbers.map((entry) => {
          const key = phoneKey(entry.raw);
          const usable = Boolean(toWhatsappDestination(entry.raw));
          const failures = key ? desk.failuresByKey[key] ?? 0 : 0;
          const isFailed = key !== null && key === failedKey;
          return (
            <div key={entry.label} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
              <span className="w-14 text-xs text-muted-foreground">{entry.label}</span>
              <span className="flex-1 font-mono text-sm">{entry.raw ? prettyPhone(entry.raw) : "none on record"}</span>
              {!entry.raw ? null : !usable ? (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted-foreground">not a mobile</span>
              ) : failures > 0 ? (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-bold text-destructive">
                  rejected {failures}×
                </span>
              ) : isFailed ? (
                <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-bold text-warning">this one failed</span>
              ) : (
                <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success">no failures</span>
              )}
              {canSend && usable && key ? (
                failures > 0 ? (
                  <NumberHealthForm phone={key} working label="Try it again" />
                ) : isFailed ? (
                  <NumberHealthForm phone={key} working={false} label="Mark not working" />
                ) : null
              ) : null}
            </div>
          );
        })}
        {canEditNumbers ? (
          <NumberSheet
            studentId={problem.studentId}
            studentName={problem.studentName}
            fatherPhone={problem.fatherPhone}
            motherPhone={problem.motherPhone}
            siblingIds={problem.coveredStudentIds.filter((id) => id !== problem.studentId)}
            siblingNames={problem.siblingNames}
            sendIds={sendIds}
            canResend={canSend}
            deadKeys={deadKeysOf(desk, problem)}
            triggerLabel="Edit numbers"
            triggerVariant="outline"
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">What to do</h3>
        <FamilyAction
          problem={problem}
          sendIds={sendIds}
          canSend={canSend}
          canEditNumbers={canEditNumbers}
          deadKeys={deadKeysOf(desk, problem)}
        />
        {problem.action.nextDestination && problem.action.canResend ? (
          <p className="text-xs text-muted-foreground">
            Goes to <span className="font-mono">{prettyPhone(problem.action.nextDestination)}</span>, with
            today&apos;s amount for every child. Anyone who has paid since is skipped.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Call instead:{" "}
          <a href={`tel:${toWhatsappDestination(problem.destination) ?? problem.destination}`} className="font-mono font-semibold text-accent">
            {prettyPhone(problem.destination)}
          </a>
        </p>
        {canSend ? <HandledForm sendIds={sendIds} compact /> : null}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">What happened</h3>
        {timeline.length === 0 ? (
          <p className="text-xs text-muted-foreground">No history recorded for these messages yet.</p>
        ) : (
          <ol className="flex flex-col gap-2 border-l-2 border-border pl-3">
            {timeline.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="text-xs">
                <span className="tabular-nums text-muted-foreground">{formatDateTimeIst(entry.at)}</span>{" "}
                <span
                  className={cn(
                    "font-semibold",
                    entry.result === "failed" || entry.result === "refused"
                      ? "text-destructive"
                      : entry.result === "delivered" || entry.result === "read" || entry.result === "paid"
                      ? "text-success"
                      : "text-foreground",
                  )}
                >
                  {describeAttemptResult(entry.result)}
                </span>
                {entry.kind === "payment" ? ` · ${formatInr(Number(entry.text ?? 0))}` : ""}
                {entry.destination ? (
                  <span className="text-muted-foreground"> · {prettyPhone(entry.destination)}</span>
                ) : null}
                {entry.kind === "attempt" && entry.text ? (
                  <span className="block text-muted-foreground">{entry.text}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** The no-number and left-out lanes: families with no failed message to resend. */
function PeopleList({
  people,
  empty,
  intro,
  passed,
  canEditNumbers,
  canSend,
  kind,
}: {
  people: FixPerson[];
  empty: string;
  intro: ReactNode;
  passed: number[];
  canEditNumbers: boolean;
  canSend: boolean;
  kind: "no_number" | "left_out";
}) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{intro}</p>
      {people.length === 0 ? (
        <OfficeNotice title="Nobody here" tone="success">
          {empty}
        </OfficeNotice>
      ) : (
        <ul className="grid gap-2.5 md:grid-cols-2">
          {people.map((person) => (
            <li key={person.key} className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{person.names.join(", ")}</span>
                <span className="shrink-0 font-bold tabular-nums">{formatInr(person.owed)}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {person.admissionNos.join(", ")} · {person.studentClass}
                {person.parentName ? ` · ${person.parentName}` : ""}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-xs">
                <CauseTag cause={kind === "left_out" ? "left_out" : person.reason === "unusable" ? "invalid_number" : person.reason === "dead" ? "not_on_whatsapp" : "no_number"} />
                <span className="text-muted-foreground">
                  {kind === "left_out"
                    ? person.lastReachedOn
                      ? `Last reached ${formatDdMmYyyy(person.lastReachedOn)} · ${prettyPhone(person.destination)}`
                      : `Not reached this month · ${prettyPhone(person.destination)}`
                    : person.reason === "unusable"
                    ? `On record: ${person.fatherPhone || person.motherPhone}`
                    : person.reason === "dead"
                    ? "WhatsApp rejected every number on record"
                    : "No number on record"}
                </span>
              </span>
              <div className="flex flex-col gap-2 md:flex-row">
                {kind === "no_number" && canEditNumbers ? (
                  <NumberSheet
                    studentId={person.studentIds[0]!}
                    studentName={person.names[0] ?? "Student"}
                    fatherPhone={person.fatherPhone}
                    motherPhone={person.motherPhone}
                    siblingIds={[]}
                    siblingNames={[]}
                    sendIds={[]}
                    canResend={false}
                    deadKeys={{}}
                    triggerLabel={person.reason === "none" ? "Add number" : "Fix number"}
                  />
                ) : null}
                {canSend && (kind === "left_out" || person.destination) ? (
                  <Link
                    href={sendScreenHref(person.studentIds, passed)}
                    className="focus-ring inline-flex h-11 items-center justify-center rounded-lg border border-border px-4 text-xs font-semibold md:h-9"
                  >
                    Add to today&apos;s send
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
