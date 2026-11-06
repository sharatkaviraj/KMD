"use client";

import Link from "@/ui/link";
import type { ReactNode } from "react";
import { useActionState, useMemo, useState } from "react";
import { AlertTriangle, Send, UserPlus, X } from "lucide-react";

import { sendRemindersAction, type SendRemindersState } from "@/app/(app)/fees/reminders/actions";
import { PendingSubmitButton } from "@/ui/shell/pending-submit-button";
import { MobileEmptyRows, MobileNote, MobileRecordCard } from "@/ui/mobile/mobile-kit";
import { ReminderCadenceControl } from "@/modules/whatsapp/ui/reminder-controls";
import { ProfileBadge } from "@/modules/whatsapp/ui/profile-badge";
import { Button } from "@/ui/primitives/button";
import { Checkbox } from "@/ui/primitives/checkbox";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import { Notice } from "@/ui/primitives/notice";
import { useActionFeedback } from "@/ui/hooks/use-action-feedback";
import { formatInr } from "@/platform/helpers/currency";
import { cn } from "@/platform/utils";
import type { WorkspaceCandidate } from "@/modules/whatsapp/ui/workspace-candidate";

type Props = {
  candidates: WorkspaceCandidate[];
  canSend: boolean;
  campaignName: string | null;
  /** Set when the office arrived via a saved campaign's Load button. */
  savedCampaign: { id: string; name: string } | null;
  /**
   * Step 1: the notice picker, the saved-campaign line and the WhatsApp
   * preview, composed on the server — see `ui/message-block.tsx`.
   */
  messageBlock: ReactNode;
  /**
   * The audience builder: presets, every filter, and the students named by
   * hand. Server-rendered for the same reason — see `AudienceBuilder`.
   */
  audienceControls: ReactNode;
  /**
   * The hidden inputs the SEND form posts, from one canonical key list.
   *
   * Was a hand-written block of `<input type="hidden">` here, which is how a
   * filter the office set could reach the screen and not the send — the action
   * rebuilds the audience from what this form posts, so a key missing here
   * messages a different set of families than the office ticked.
   */
  sendFormFields: ReactNode;
  /** What the amount on each row means, given the chosen quote basis. */
  amountNote: string;
  /**
   * `?exclude=` with a trailing separator, so a row's Remove link is this plus
   * the student id. Built server-side from the canonical key list rather than
   * assembled in the browser, which would need the whole filter serialiser
   * here.
   */
  excludeHrefPrefix: string;
  /**
   * The "hold some families back" disclosure, rendered on the server.
   *
   * A `ReactNode` prop rather than markup here, because it is static copy with
   * no client state and every byte of it would otherwise ship to the browser on
   * a route with a bundle ceiling. It renders inside this component's form, so
   * the field still posts with the run.
   */
  holdoutControl: ReactNode;
  /** Server-rendered links to the collection lists. A ReactNode, like
   *  `holdoutControl`, so this route gains no client JavaScript for them. */
  listActions: ReactNode;
  /**
   * Who is NOT on the list and why — the "Left out" line, the held-back and
   * no-number disclosures, and the all-messaged notice — rendered on the
   * server (`ui/audience-panels.tsx`). They were markup here until 2026-10-26
   * and every label of them shipped to the browser; moving them out is what
   * paid for the profile pill and the cost line.
   */
  everyoneMessagedNotice: ReactNode;
  leftOutSummary: ReactNode;
  pausedPanel: ReactNode;
  unreachablePanel: ReactNode;
  /**
   * What one message costs, in rupees, so the send bar can say what the run
   * costs before anybody presses it. Passed in rather than imported so the
   * figure lives in one place on the server.
   */
  messageCost: number;
  /**
   * `whatsapp_one_message_per_family`. On, children who share a number get one
   * message, so the bill and the confirmation count PHONES, not children.
   */
  onePerPhone: boolean;
  /**
   * `ESCALATE_TO_SECOND_NUMBER_AFTER`, passed in so the grouping module stays
   * out of the browser bundle: after this many delivered reminders the other
   * parent's number gets the message too, and that is a second billed message.
   */
  secondNumberAfter: number;
};

const IDLE_SEND: SendRemindersState = { status: "idle" };

/** "about ₹24 to send" — rounded up, because a bill is never smaller than this. */
function costLine(count: number, messageCost: number): string {
  return `about ${formatInr(Math.max(1, Math.ceil(count * messageCost)))} to send`;
}

/**
 * What the TODAY column says. A sibling named inside the family's one message
 * was reminded — the raw `covered_by_sibling` read as "not sent" to the office,
 * on the first morning under family grouping.
 */
function sentTodayLabel(status: string | undefined, sentLabel: string): string {
  if (status === "sent") return sentLabel;
  if (status === "covered_by_sibling") return "In sibling's message";
  return status ?? "";
}

export function RemindersWorkspace({
  candidates,
  canSend,
  campaignName,
  savedCampaign,
  messageBlock,
  audienceControls,
  sendFormFields,
  amountNote,
  excludeHrefPrefix,
  messageCost,
  onePerPhone,
  secondNumberAfter,
  holdoutControl,
  listActions,
  everyoneMessagedNotice,
  leftOutSummary,
  pausedPanel,
  unreachablePanel,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [sendState, sendFormAction] = useActionState(sendRemindersAction, IDLE_SEND);
  // A send that went clears the ticks, adjusted during render rather than in
  // an effect: the families it messaged are greyed out next, and keeping them
  // ticked is what made the bar promise a second send.
  const [handledSend, setHandledSend] = useState(sendState);
  if (sendState !== handledSend) {
    setHandledSend(sendState);
    if (sendState.status === "success" || sendState.status === "partial") setSelected(new Set());
  }

  // Announce the result and re-derive the list, so the families just messaged
  // drop off on their own. `partial` is a warning status in the hook, which is
  // right: the send DID happen for some, and the failures are named in the
  // notice below rather than being flattened into a success.
  useActionFeedback(sendState, {
    successTitle: "Reminders sent",
    warningTitle: "Sent, with failures",
    errorTitle: "Nothing was sent",
  });

  // A family already messaged today cannot be messaged again — the unique index
  // would reject it anyway, so the checkbox says so up front rather than
  // letting staff select a row that will silently come back as "already sent".
  const selectable = useMemo(
    () => candidates.filter((candidate) => !candidate.sentToday),
    [candidates],
  );

  const toggle = (studentId: string) => {
    setConfirming(false);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const selectAll = () => {
    setConfirming(false);
    setSelected(new Set(selectable.map((candidate) => candidate.studentId)));
  };

  const clearAll = () => {
    setConfirming(false);
    setSelected(new Set());
  };

  // Ticked AND still on this list AND not yet sent today. The raw set keeps
  // ids across a tile tap and after a send (the page segment survives both),
  // so counting it showed families that had left the list or already been
  // messaged — "This sends 141 messages" after a send that would send none.
  const selectedCandidates = candidates.filter(
    (candidate) => selected.has(candidate.studentId) && !candidate.sentToday,
  );
  const pickedCount = selectedCandidates.length;
  const selectedTotal = selectedCandidates.reduce(
    (sum, candidate) => sum + candidate.dueAmount,
    0,
  );
  // What is billed, the way the run decides it (`groupIntoFamilies` and
  // `chooseDestinations`): one message per family — a shared number or linked
  // siblings, `familyKey` — when siblings are grouped, plus a second number once
  // the family is past the threshold and has one.
  const families = new Map<string, { numbers: Set<string>; sent: number }>();
  for (const candidate of selectedCandidates) {
    const key = onePerPhone ? candidate.familyKey : candidate.studentId;
    const family = families.get(key) ?? { numbers: new Set<string>(), sent: 0 };
    family.numbers.add(candidate.destination);
    if (candidate.secondaryDestination) family.numbers.add(candidate.secondaryDestination);
    family.sent = Math.max(family.sent, candidate.sentCount);
    families.set(key, family);
  }
  let messages = 0;
  for (const family of families.values()) {
    messages += family.numbers.size > 1 && family.sent >= secondNumberAfter ? 2 : 1;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* First thing on the screen, not buried under the filters: it explains
          why every row below is greyed and why "Select all" reads 0. */}
      <div className="max-md:order-0 empty:hidden">{everyoneMessagedNotice}</div>

      {/* ------------------------------------------------------- what it says */}
      {/* Server-rendered (`ui/message-block.tsx`): the picker, the saved
          campaign line and the preview cost the browser nothing. */}
      <div className="max-md:order-1">{messageBlock}</div>

      {/* ------------------------------------------------------ who gets it */}
      <div className="max-md:order-2">{audienceControls}</div>

      {/* Under the filter, because the list you want to hand out is the list you
          just narrowed. `max-md:order-2` puts it with the phone's filter
          disclosure rather than 40 screens below the cards. */}
      <div className="max-md:order-2 max-md:-mt-2 print:hidden">{listActions}</div>

      {/* --------------------------------------------------------------- who is out */}
      {/* "Who is on this list" used to sit here as a second sentence about the
          same filters. It says it once now, in the audience panel that owns
          them — see `describeAudience`. This paragraph answers the other
          question, the one exclusion counts genuinely do answer: why is a
          family I expected NOT here. */}
      <div className="-mt-3 max-md:order-5 max-md:-mt-1">{leftOutSummary}</div>

      {/* ------------------------------------------------- paused, unreachable */}
      {/* Server-rendered — see `ui/audience-panels.tsx`. */}
      <div className="max-md:order-6 empty:hidden">{pausedPanel}</div>
      <div className="max-md:order-6 empty:hidden">{unreachablePanel}</div>

      {/* ------------------------------------------------------------------ results */}
      {sendState.status === "success" || sendState.status === "partial" ? (
        <Notice
          tone={sendState.status === "partial" ? "warning" : "success"}
          title="Send finished"
          className="max-md:order-3"
        >
          <p>{sendState.message}</p>
          {sendState.failures && sendState.failures.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {sendState.failures.map((failure) => (
                <li key={failure.admissionNo}>
                  <strong>{failure.admissionNo}</strong> {failure.studentName} — {failure.error}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-sm">
            The list has been re-read from the ledger. The families just messaged stay on it,
            greyed out as sent today, and cannot be sent this notice again until tomorrow.
          </p>
        </Notice>
      ) : null}

      {sendState.status === "error" ? (
        <Notice tone="danger" title="Nothing was sent" className="max-md:order-3">
          {sendState.message}
        </Notice>
      ) : null}

      {/* -------------------------------------------------------------------- list */}
      <form action={sendFormAction} className="max-md:order-4">
        {/* Every filter, from ONE canonical key list, rendered on the server.
            The action rebuilds the audience from what this form posts, so a key
            missing here would message a different set of families than the
            office ticked — and a hand-written block of hidden inputs is exactly
            how that happens. */}
        {sendFormFields}
        {/* ---------------------------------------------------- overrides */}
        {/* Rendered only after a run has actually been refused, so the ordinary
            path never shows a row of boxes inviting somebody to tick them. */}
        {sendState.status === "error" && sendState.guards && sendState.guards.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border border-warning/50 bg-warning/5 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-warning-foreground">
              Held back — say you mean it
            </p>
            <ul className="flex flex-col gap-2">
              {sendState.guards.map((guard) => (
                <li key={guard.code}>
                  {/* min-h-11 so the whole sentence is a tap target, not just the box. */}
                  <label className="flex min-h-11 items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      name="overrideGuard"
                      value={guard.code}
                      className="mt-1 size-4 shrink-0"
                    />
                    <span className="text-foreground">{guard.message}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5">
              <Label htmlFor="overrideReason">Why send anyway?</Label>
              <Input
                id="overrideReason"
                name="overrideReason"
                placeholder="Owner asked for the last-day push tonight"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Both the reason and which of these you ticked are written to the run.
            </p>
          </div>
        ) : null}

        {/* Server-rendered and passed in: it is static markup with no client
            state, and this route sits under a gzip ceiling that only ratchets
            down. It still lives INSIDE the one form, so its value posts with
            the rest of the run. */}
        {canSend ? holdoutControl : null}

        {/* Ties the run to the saved campaign it came from. Absent for an ad-hoc
            send, which is still a run — just an unnamed one. */}
        {savedCampaign ? (
          <input type="hidden" name="campaignId" value={savedCampaign.id} />
        ) : null}
        {[...selected].map((studentId) => (
          <input key={studentId} type="hidden" name="studentId" value={studentId} />
        ))}

        <div className="mb-3 hidden flex-wrap items-center gap-3 md:flex">
          <Button type="button" variant="outline" size="sm" onClick={selectAll}>
            Select all {selectable.length}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
            Clear
          </Button>
          <span className="text-sm text-muted-foreground">
            {pickedCount} selected · {formatInr(selectedTotal)} of dues behind them
          </span>
        </div>

        <div className="mb-2.5 flex items-center justify-between gap-2 md:hidden">
          <span className="text-[11.5px] font-semibold text-muted-foreground">
            {pickedCount} of {selectable.length} picked
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={selectAll}>
              Select all
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
              Clear
            </Button>
          </div>
        </div>

        {/* The desk table says "Message says due" in a column header. A card has
            no header to lean on, so the rule is stated once here instead of on
            every card. */}
        <MobileNote className="mb-2.5 md:hidden">{amountNote}</MobileNote>

        <ul
          className="flex flex-col gap-2.5 md:hidden"
          // Constant, even with the bar absent, so the list does not jump when
          // the first family is ticked. 7.5rem because the bar grows to two rows
          // in the confirm state.
          //
          // `/fees/reminders` became a top-level tab on 22 Aug 2026, so it
          // is NO LONGER a mobile takeover: the tab bar renders, the send bar
          // sits above it, and the last card has to clear both.
          style={{
            paddingBottom:
              "calc(var(--mobile-bottom-nav-offset, 0px) + var(--mobile-safe-area-bottom, 0px) + 7.5rem)",
          }}
        >
          {candidates.map((candidate) => {
            const already = Boolean(candidate.sentToday);
            const picked = selected.has(candidate.studentId);
            const locked = already || !canSend;

            return (
              <MobileRecordCard
                key={candidate.studentId}
                // `cv-row`: a card off screen is not laid out until it is
                // scrolled to, so 400 families do not all render on each tap.
                className={cn("cv-row", already && "opacity-60")}
                title={candidate.studentName}
                subtitle={`${candidate.studentClass} · ${candidate.parentName}`}
                amount={formatInr(candidate.dueAmount)}
                status={
                  <div className="flex flex-wrap justify-end gap-1">
                    {already ? (
                      <span className="rounded bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {sentTodayLabel(candidate.sentToday?.status, "Sent today")}
                      </span>
                    ) : null}
                    <ProfileBadge
                      profile={candidate.profile}
                      suggested={candidate.profileSource === "suggested"}
                    />
                    {candidate.includedByHand ? (
                      // The one row on the list a filter cannot explain.
                      <span className="inline-flex items-center gap-1 rounded bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground">
                        <UserPlus className="size-3" aria-hidden="true" />
                        By hand
                      </span>
                    ) : null}
                    {candidate.missingFacts.length > 0 ? (
                      // Any template can reach any family now, so a family can
                      // be sent a message built around a fact they do not have.
                      // Warned, never silent.
                      <span
                        title={`This message names ${candidate.missingFactsLabel}, which this family does not have`}
                        className="rounded bg-warning/20 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-warning-foreground"
                      >
                        {/* "Needs", not "No": the labels are noun phrases
                            carrying their own article, so "No" produced
                            "No a late fee on the ledger". */}
                        Needs {candidate.missingFactsLabel}
                      </span>
                    ) : null}
                  </div>
                }
                // The number the message goes to is the one fact a sender checks;
                // admission number and paid-so-far live under "More" with the
                // per-family controls, so 122 cards are a third of the height.
                fields={[
                  {
                    label: "Number",
                    value: `${candidate.destination}${candidate.usedMotherPhone ? " (mother)" : ""}`,
                  },
                ]}
                actions={
                  <>
                  <label className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 text-[12.5px] font-semibold">
                    {/* No `name` — the selection travels via the hidden
                        studentId inputs above. A name here would post a second,
                        unfiltered copy of it. A raw input rather than the Radix
                        Checkbox because that renders a <button role="checkbox">,
                        which a wrapping <label> does not reliably activate. */}
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 rounded border-border-strong accent-accent"
                      checked={picked}
                      onChange={() => toggle(candidate.studentId)}
                      disabled={locked}
                      aria-label={`Select ${candidate.studentName}`}
                    />
                    <span className={locked ? "text-muted-foreground" : "text-foreground"}>
                      {already
                        ? "Already messaged today"
                        : !canSend
                          ? "Sending is off"
                          : picked
                            ? "Selected"
                            : "Select for this send"}
                    </span>
                  </label>
                  <details className="group w-full border-t border-border pt-2">
                    <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg text-[12.5px] font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
                      More
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="size-4 transition-transform group-open:rotate-180"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </summary>
                    <p className="pb-2 text-[12px] text-muted-foreground">
                      Adm {candidate.admissionNo} · Paid so far {formatInr(candidate.totalPaid)}
                    </p>
                    <div className="flex w-full items-center gap-2">
                      <ReminderCadenceControl
                        studentId={candidate.studentId}
                        cadence={candidate.cadence}
                        disabled={!canSend}
                        className="min-w-0 flex-1 justify-between"
                      />
                      {/* Drops this family from the list itself, not just from
                          this send: it rides `?exclude=`, so the collection lists
                          and the export leave them off too. Undo is a chip in the
                          audience builder. */}
                      <Link
                        href={`${excludeHrefPrefix}${candidate.studentId}`}
                        scroll={false}
                        prefetch={false}
                        aria-label={`Remove ${candidate.studentName} from the list`}
                        className="focus-ring grid size-11 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </details>
                  </>
                }
              />
            );
          })}
          {candidates.length === 0 ? (
            <MobileEmptyRows>
              Nobody matches these filters. Either everyone has paid, or the filters are too narrow
              — widen them above, or start from one of the presets.
            </MobileEmptyRows>
          ) : null}
        </ul>

        <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2">Adm</th>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Parent</th>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Message says</th>
                <th className="px-3 py-2">Today</th>
                <th className="px-3 py-2">Remind</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => {
                const already = Boolean(candidate.sentToday);
                return (
                  <tr
                    key={candidate.studentId}
                    className={`border-t border-border ${already ? "opacity-55" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={selected.has(candidate.studentId)}
                        onCheckedChange={() => toggle(candidate.studentId)}
                        disabled={already || !canSend}
                        aria-label={`Select ${candidate.studentName}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{candidate.admissionNo}</td>
                    <td className="px-3 py-2 font-medium">
                      {candidate.studentName}
                      <ProfileBadge
                        profile={candidate.profile}
                        suggested={candidate.profileSource === "suggested"}
                        className="ml-1.5"
                      />
                      {candidate.includedByHand ? (
                        <span
                          title="Added by hand — the filters did not find this family"
                          className="ml-1.5 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground"
                        >
                          by hand
                        </span>
                      ) : null}
                      {candidate.missingFacts.length > 0 ? (
                        <span
                          title={`This message names ${candidate.missingFactsLabel}, which this family does not have`}
                          className="ml-1.5 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning-foreground"
                        >
                          ⚠
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{candidate.studentClass}</td>
                    <td className="px-3 py-2">{candidate.parentName}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {candidate.destination}
                      {candidate.usedMotherPhone ? (
                        <span className="ml-1 text-muted-foreground">(mother)</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatInr(candidate.totalPaid)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatInr(candidate.dueAmount)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {already ? (
                        <span className="rounded bg-surface-2 px-2 py-0.5">
                          {sentTodayLabel(candidate.sentToday?.status, "Sent")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ReminderCadenceControl
                        studentId={candidate.studentId}
                        cadence={candidate.cadence}
                        disabled={!canSend}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {/* Rides `?exclude=`, so the collection lists and the
                          export leave them off too. Undo is a chip in the
                          audience builder above. */}
                      <Link
                        href={`${excludeHrefPrefix}${candidate.studentId}`}
                        scroll={false}
                        prefetch={false}
                        aria-label={`Remove ${candidate.studentName} from the list`}
                        title="Remove from the list"
                        className="focus-ring grid size-7 place-items-center rounded text-muted-foreground hover:bg-surface-2"
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {candidates.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                    Nobody matches these filters. Either everyone has paid, or the filters are too
                    narrow — widen them above, or start from one of the presets.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* ------------------------------------------------------------- send (desk) */}
        {/* Sticky, not in flow. On a 135-family list the button sat 8,210px down:
            you tick at the top and then scroll seven screens to reach it. It
            appears only once something is selected, so an empty list is not
            covered by a bar that can do nothing. */}
        <div
          className={cn(
            "mt-4 hidden flex-wrap items-center gap-3 md:flex",
            pickedCount > 0 &&
              "sticky bottom-4 z-30 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur print:static print:border-0 print:bg-transparent print:shadow-none",
          )}
        >
          {pickedCount > 0 && !confirming ? (
            <span className="text-sm text-muted-foreground">
              <strong className="font-semibold text-foreground">{pickedCount} selected</strong> ·{" "}
              {formatInr(selectedTotal)} of dues behind them · {costLine(messages, messageCost)}
            </span>
          ) : null}
          {!confirming ? (
            <Button
              type="button"
              variant="primary"
              disabled={!canSend || pickedCount === 0}
              onClick={() => setConfirming(true)}
            >
              <Send className="size-4" aria-hidden="true" />
              Send to {pickedCount} {pickedCount === 1 ? "family" : "families"}
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              <span className="text-sm">
                This sends {messages} real WhatsApp {messages === 1 ? "message" : "messages"}
                {campaignName ? ` through "${campaignName}"` : ""}, billed per message. It cannot be
                undone.
              </span>
              <PendingSubmitButton idleLabel="Yes, send now" pendingLabel="Sending…" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          )}
          {!canSend ? (
            <span className="text-sm text-muted-foreground">
              You have read-only access to this screen, or sending is not configured.
            </span>
          ) : null}
        </div>

        {/* ------------------------------------------------------------ send (phone) */}
        {pickedCount > 0 ? (
          <div
            // A tab screen, not a takeover: the bottom nav is there, so this bar
            // sits ON TOP of it rather than over the home indicator. `md:bottom-0`
            // undoes the offset on the desk, where there is no tab bar.
            className="fixed inset-x-0 bottom-[var(--mobile-bottom-nav-offset,0px)] z-30 border-t border-border bg-background/95 px-4 pt-2.5 backdrop-blur md:bottom-0 md:hidden print:hidden"
            style={{ paddingBottom: "calc(var(--mobile-safe-area-bottom, 0px) + 0.75rem)" }}
          >
            {!confirming ? (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-extrabold text-foreground">
                    {pickedCount} selected
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {formatInr(selectedTotal)} · {costLine(messages, messageCost)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  className="h-12 px-5"
                  disabled={!canSend}
                  onClick={() => setConfirming(true)}
                >
                  <Send className="size-4" aria-hidden="true" />
                  Send
                </Button>
              </div>
            ) : (
              // Grows in place rather than opening a Sheet: a Sheet portals out
              // of this <form>, which would break useFormStatus and force the
              // form={id} + pinned-footer machinery.
              <div className="space-y-2.5">
                <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-[11.5px] leading-relaxed">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {messages} real WhatsApp {messages === 1 ? "message" : "messages"}
                    {campaignName ? ` through "${campaignName}"` : ""}, billed per message. It
                    cannot be undone.
                  </span>
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-12 flex-1"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </Button>
                  <PendingSubmitButton
                    className="h-12 flex-1"
                    idleLabel="Yes, send now"
                    pendingLabel="Sending…"
                  />
                </div>
              </div>
            )}
          </div>
        ) : null}
      </form>

    </div>
  );
}
