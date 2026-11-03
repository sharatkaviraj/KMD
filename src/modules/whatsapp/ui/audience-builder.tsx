import type { ReactNode } from "react";
import { Check, Plus, RotateCcw, X } from "lucide-react";

import { Button } from "@/ui/primitives/button";
import { PendingSubmitButton } from "@/ui/shell/pending-submit-button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import { SelectNative } from "@/ui/primitives/select-native";
import { cn } from "@/platform/utils";
import { formatInr } from "@/platform/helpers/currency";
import {
  DEFAULT_MAX_TOTAL_PAID,
  describeAudience,
  INSTALLMENT_MATCHES,
  installmentMatchHref,
  installmentTileHref,
  lastYearTileHref,
  PAID_OPTIONS,
  profileToggleHref,
  PROMISE_OPTIONS,
  reminderQuery,
  type ReminderQueryKey,
} from "@/modules/whatsapp/domain/audience";
import {
  defaultInstallmentsFor,
  describeInstallmentTile,
  type InstallmentCalendar,
} from "@/modules/whatsapp/domain/installment-calendar";
import {
  describeTileMoney,
  type ReminderAudience,
  type ReminderFilters,
} from "@/modules/whatsapp/domain/fee-reminders";
import type { StudentBrief } from "@/modules/whatsapp/data/student-lookup";
import { CarriedFilterFields } from "@/modules/whatsapp/ui/carried-filter-fields";
import { REMINDER_PROFILES } from "@/modules/whatsapp/domain/reminder-profile";
import { ProfileBadge } from "@/modules/whatsapp/ui/profile-badge";
import { NavLink } from "@/ui/shell/nav-link";

/**
 * Who gets this message — the installment tiles, and nothing the template
 * decides.
 *
 * ONE main control: Inst 1 · 2 · 3 · 4 · Last year. Each tile says what the
 * calendar makes of it ("Overdue since 20-04-2026", "Due 20-10-2026") and how
 * many families it alone would reach, so due-versus-overdue is read off the
 * tile rather than asked for as a filter. Tap to select; two or more tiles
 * bring up "owing on all of them / any of them". Everything else — class, paid
 * so far, a late fee on the ledger, a minimum, the promise hold-back — sits
 * folded under "Narrow down", because those are the questions the office asks
 * rarely and the tiles are the one it asks every day.
 *
 * Until 2026-09-10 this card carried nine audience chips (each borrowing a
 * TEMPLATE's old audience as a preset) and twelve controls, most of them
 * yes/no/either facts nobody could explain without knowing the rule they were
 * extracted from. The owner's words were "very confusing", and the owner's
 * mental model was installment-first, so this is installment-first.
 *
 * Every link is the shell's `NavLink`, already in the shared bundle, so a tap
 * starts the top progress bar the moment it lands instead of looking ignored
 * until the server answers; `tap` (globals.css) gives the press itself.
 *
 * A SERVER component, and that is not a style choice. `/fees/reminders`
 * sits ~1000 gzip bytes under its ceiling in `quality/route-bundle-baseline.json`,
 * and that file's rule is that ceilings ratchet down. Everything here is a
 * `<Link>`, a GET form or a server action — none of which needs a byte of
 * client JavaScript — so the whole audience builder costs the browser nothing.
 */

type Props = {
  filters: ReminderFilters;
  audience: ReminderAudience;
  /** Names for the ids in `?include=` — a row of UUIDs is unreadable before a send. */
  included: StudentBrief[];
  excluded: StudentBrief[];
  /**
   * Matches for a search that did not resolve to exactly one student, so the
   * office picks. Empty on the ordinary path.
   */
  matches: StudentBrief[];
  /** What was typed, echoed back beside the matches. */
  searchQuery: string;
  /**
   * What today makes of the fee calendar — the same one the audience was
   * counted with. Passed in rather than recomputed: a tile's label has to
   * describe the SAME state its count was built on, or a tile reading
   * "Overdue" and 201 lands on a different 201.
   */
  calendar: InstallmentCalendar;
  /**
   * The add-a-student action, passed in rather than imported — see the same
   * note on `NoticePicker`. `src/modules/**` may not reach into `src/app/**`,
   * and the architecture gate counts every edge that does.
   */
  addAction: (formData: FormData) => void | Promise<void>;
  /**
   * `app_settings.whatsapp_one_message_per_family`. On, children who share a
   * number get ONE message, so the headline says how many phones the list is.
   */
  onePerPhone: boolean;
};

/** A label above a compact control. */
function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-[11.5px] leading-tight">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-[10.5px] leading-tight text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * One Narrow down question as a row of one-tap choices.
 *
 * Each option is a link that sets this key and keeps every other, so picking
 * one is a single tap that lands on the new list — not a select, then a
 * scroll, then Apply. Plain links in a server component: no browser bytes.
 */
function Choice({
  label,
  hint,
  options,
}: {
  label: string;
  hint?: string;
  options: ReadonlyArray<{ label: string; href: string; active: boolean }>;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <p className="text-[11.5px] font-semibold leading-tight text-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <NavLink
            key={option.label}
            href={option.href}
            scroll={false}
            prefetch={false}
            aria-current={option.active ? "true" : undefined}
            className={cn(
              "tap focus-ring inline-flex min-h-11 items-center rounded-full border px-3 text-[12px] font-semibold md:min-h-8",
              option.active
                ? "border-accent bg-accent/12 text-foreground"
                : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            {option.label}
          </NavLink>
        ))}
      </div>
      {hint ? <p className="text-[10.5px] leading-tight text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// 44px on a phone, the desk's own 36 above md. Every control on this panel, so
// a thumb never has to find a 28px select between two others.
const CONTROL = "h-11 w-full text-[13px] md:h-9";

/**
 * One tile. The whole surface is the tap target, and a tile whose tap would
 * leave zero tiles selected is rendered inert rather than as a link — zero
 * tiles is not a state, because the quoted amount is derived from them.
 */
function Tile({
  href,
  selected,
  title,
  subtitle,
  count,
  owing,
}: {
  href: string | null;
  selected: boolean;
  title: string;
  subtitle: string;
  count: number;
  /**
   * Who this tile would reach with Narrow down cleared. Shown as "1 of 134"
   * only when it is more — the gap is what the narrowing hides.
   */
  owing: number;
}) {
  // A zero-count tile is dimmed by COLOUR, never by opacity: opacity composites
  // the text too, and took a chip label to 2.88:1 against the 4.5 axe requires.
  // `text-muted-foreground` on `surface-2` measures 5.21:1 in light and 8.04:1
  // in dark, so the tile still reads as quiet without becoming unreadable.
  const className = cn(
    "tap focus-ring flex min-h-11 min-w-0 flex-col justify-center gap-0.5 rounded-xl border px-3 py-2 text-left md:min-h-14",
    selected
      ? "border-accent bg-accent/12 text-foreground"
      : count === 0
        ? "border-border/60 bg-surface-2 text-muted-foreground"
        : "border-border bg-card text-foreground hover:border-border-strong",
  );
  const body = (
    <>
      <span className="flex w-full items-start justify-between gap-2">
        <span className="whitespace-nowrap text-[13px] font-extrabold">{title}</span>
        {/* "of 416" sits UNDER the count, not beside it: "Installment 3" and
            "357 of 416" on one line overflow a half-width tile at 375px. */}
        <span className="flex shrink-0 flex-col items-end leading-tight">
          <span
            className={cn(
              "tabular-nums text-[12px] font-extrabold",
              selected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {count}
          </span>
          {owing > count ? (
            <span className="tabular-nums text-[10px] font-semibold text-muted-foreground">
              of {owing}
            </span>
          ) : null}
        </span>
      </span>
      <span className="truncate text-[10.5px] leading-tight text-muted-foreground">{subtitle}</span>
    </>
  );
  if (href === null) {
    return (
      <span aria-current="true" aria-disabled="true" className={className}>
        {body}
      </span>
    );
  }
  return (
    <NavLink
      href={href}
      scroll={false}
      prefetch={false}
      aria-current={selected ? "true" : undefined}
      className={className}
    >
      {body}
    </NavLink>
  );
}

/** One person, as a removable chip. */
function StudentChip({
  brief,
  href,
  title,
  tone,
}: {
  brief: StudentBrief;
  href: string;
  title: string;
  tone: "included" | "excluded";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1 text-[11.5px] font-semibold",
        tone === "included"
          ? "border-accent/40 bg-accent/10 text-foreground"
          : "border-border bg-surface-2 text-muted-foreground line-through",
      )}
    >
      <span className="max-w-[11rem] truncate">
        {brief.studentName} · {brief.admissionNo}
      </span>
      <NavLink
        href={href}
        scroll={false}
        prefetch={false}
        title={title}
        aria-label={`${title}: ${brief.studentName}`}
        className="focus-ring grid size-7 shrink-0 place-items-center rounded-full hover:bg-background"
      >
        {tone === "included" ? (
          <X className="size-3.5" aria-hidden="true" />
        ) : (
          <RotateCcw className="size-3.5" aria-hidden="true" />
        )}
      </NavLink>
    </span>
  );
}

export function AudienceBuilder({
  filters,
  audience,
  included,
  excluded,
  matches,
  searchQuery,
  calendar,
  addAction,
  onePerPhone,
}: Props) {
  /** Drop `id` from a comma list in the query string, keeping everything else. */
  const without = (key: "include" | "exclude", id: string) => {
    const source = key === "include" ? filters.includeStudentIds : filters.excludeStudentIds;
    const next = source.filter((value) => value !== id);
    return `?${reminderQuery(filters, { [key]: next.join(",") || null }).toString()}`;
  };

  // Last year combines with the installments, so the installment tiles stay
  // as they are whether it is on or not.
  const selectedInstallments = filters.installments;
  const calendarDefault = defaultInstallmentsFor(calendar);
  // The courtesy-notice rule only means something when nothing selected is
  // overdue (`calendar.overdue`, strictly past — the row due today is not); on
  // an overdue tile everybody is overdue by definition, and the tile hrefs
  // drop the key there for the same reason.
  const offerSkipOverdue =
    !filters.lastYear &&
    selectedInstallments.length > 0 &&
    selectedInstallments.every((installment) => !calendar.overdue.includes(installment));

  const classLabel =
    audience.classOptions.find((option) => option.classId === filters.classId)?.label ?? null;
  /**
   * What Narrow down has set, each with the link that clears it alone.
   *
   * Shown as chips in the sentence, not only on Narrow down's folded summary
   * line. On 2026-10-26 a "late fee: yes" left over from the waiver suggestion
   * made Installment 1 read 1 when 134 families owed on it, and the only place
   * that said so was that summary line, under the profiles.
   */
  const clearHref = (key: ReminderQueryKey) => `?${reminderQuery(filters, { [key]: null })}`;
  /** Set one Narrow down key (null = its default), keeping every other. */
  const choiceHref = (key: ReminderQueryKey, value: string | null) =>
    `?${reminderQuery(filters, { [key]: value })}`;
  const narrowing = [
    classLabel ? { label: classLabel, href: clearHref("classId") } : null,
    filters.paid !== "any"
      ? {
          label: PAID_OPTIONS.find((entry) => entry.value === filters.paid)?.label ?? filters.paid,
          href: clearHref("paid"),
          drops: audience.droppedByFilter.paid,
        }
      : null,
    filters.lateFee !== "any"
      ? {
          label: filters.lateFee === "yes" ? "late fee still charged" : "no late fee charged",
          href: clearHref("lateFee"),
          drops: audience.droppedByFilter.lateFee,
        }
      : null,
    filters.minDueAmount > 1
      ? {
          label: `owing at least ${formatInr(filters.minDueAmount)}`,
          href: clearHref("minDueAmount"),
          drops: audience.droppedByFilter.minDueAmount,
        }
      : null,
    filters.promise !== "skip_open"
      ? {
          label:
            PROMISE_OPTIONS.find((entry) => entry.value === filters.promise)?.label ?? filters.promise,
          href: clearHref("promise"),
        }
      : null,
    filters.skipOverdue
      ? {
          label: "not overdue on anything earlier",
          href: clearHref("skipOverdue"),
          drops: audience.droppedByFilter.skipOverdue,
        }
      : null,
    filters.includeRte ? { label: "RTE included", href: clearHref("includeRte") } : null,
  ].filter(
    (entry): entry is { label: string; href: string; drops?: number } => entry !== null,
  );
  // Clears exactly the ledger questions `reachesUnnarrowed` relaxes, so the
  // number on the link is the list it lands on. A minimum the office LOWERED
  // below the default stays where they put it.
  const showAllHref = `?${reminderQuery(filters, {
    paid: null,
    lateFee: null,
    minDueAmount: filters.minDueAmount > 1 ? null : String(filters.minDueAmount),
    skipOverdue: null,
  })}`;
  const clearAllHref = `?${reminderQuery(filters, {
    classId: null,
    paid: null,
    lateFee: null,
    minDueAmount: null,
    promise: null,
    skipOverdue: null,
    includeRte: null,
  })}`;
  const hidden = audience.hiddenByNarrowing;

  // The audience, every Narrow down setting and every hand-pick at rest; the
  // message above (notice, language, date, late-fee wording) is kept.
  const startOverHref = `?${reminderQuery(filters, {
    installments: null,
    installmentMatch: null,
    paid: null,
    minDueAmount: null,
    lateFee: null,
    promise: null,
    skipOverdue: null,
    classId: null,
    includeRte: null,
    profiles: null,
    include: null,
    exclude: null,
  })}`;

  // Children who share a number or are linked as siblings get one message —
  // what the bill counts (`familyKey`, as the run groups).
  const phones = onePerPhone
    ? new Set(audience.candidates.map((candidate) => candidate.familyKey)).size
    : audience.candidates.length;

  // "Why this number?", in the order the list applies its guards. Zero rows are
  // dropped, so the common case is two lines.
  const funnel = audience.funnel;
  const tileWord =
    selectedInstallments.length + (filters.lastYear ? 1 : 0) === 1 ? "this tile" : "these tiles";
  const funnelRows = [
    { count: funnel.removedByHand, label: "removed by hand" },
    { count: funnel.noCall, label: "marked “don’t contact”" },
    { count: funnel.rte, label: "RTE students, left out" },
    { count: funnel.noNumber, label: "no usable WhatsApp number" },
    { count: funnel.otherClass, label: "in another class" },
    { count: funnel.heldBack, label: "held back by their reminder setting or a promise" },
    { count: funnel.hiddenByNarrowing, label: "hidden by Narrow down" },
  ].filter((row) => row.count > 0);
  const addedByHand = audience.candidates.length - funnel.onList;

  const handPicked = included.length + excluded.length;

  /**
   * The sentence, built from what this run actually landed on.
   *
   * `quotedTotal` sums the SAME `dueAmount` each family will be messaged, so
   * the figure on screen is the figure that goes out — not a re-derivation that
   * could disagree with it.
   */
  const sentence = describeAudience(filters, {
    count: audience.candidates.length,
    quotedTotal: audience.candidates.reduce((sum, candidate) => sum + candidate.dueAmount, 0),
    heldByPromise: audience.paused.filter((family) => family.reason === "promise_open").length,
    // Everything else in `paused` is a cadence decision: never, snoozed, or
    // messaged too recently. The tile counts these families and the send does
    // not, so the sentence has to account for them or the two numbers look
    // like they disagree.
    heldByCadence: audience.paused.filter(
      (family) => family.reason !== "promise_open" && family.reason !== "profile",
    ).length,
    heldByProfile: audience.paused.filter((family) => family.reason === "profile").length,
    className: classLabel,
  });
  // The reconciliation with the Dashboard, composed server-side (this is a
  // server component, and `fee-reminders` is `server-only`), so the office
  // sees every rupee of the difference named without a byte reaching the
  // client bundle.
  const notes = [...sentence.notes, ...describeTileMoney(filters, audience.money)];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm md:rounded-lg md:p-4">
      {/* Numbered, because the two cards on this screen answer two questions
          that used to be one. Without the numbers they read as two rows of
          chips doing the same job. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-extrabold text-accent-foreground">
            2
          </span>
          Who gets it
        </h3>
        <p className="text-[11.5px] text-muted-foreground">
          Pick the installments they still owe on, and Last year to add last session&rsquo;s balance to
          the amount. Changing the message above never changes the list.
        </p>
        <NavLink
          href={startOverHref}
          scroll={false}
          prefetch={false}
          className="tap focus-ring inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-[12px] font-bold text-accent hover:underline md:min-h-0"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Start over
        </NavLink>
      </div>

      {/* ------------------------------------------------------- the sentence */}
      {/* The answer to "who gets it", in words, above the tiles that decide it.

          Three weights, not one. As a single string this measured six lines
          and 124px of uniform semibold at 390px, and it is both the first thing
          on the card and what a person reads before sending a few hundred
          billed messages. The two figures they actually check land in one
          glance; the qualifiers stay legible without competing.

          `aria-live` sits on the wrapper so a screen reader hears the whole
          thing as one update rather than three. */}
      <div
        aria-live="polite"
        className="flex flex-col gap-1 rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-2.5"
      >
        <p className="text-[15px] font-extrabold leading-tight tracking-tight text-foreground tabular-nums md:text-[14px]">
          {sentence.headline}
        </p>
        <p className="text-[12.5px] font-semibold leading-snug text-foreground">
          {sentence.claim}
        </p>
        {phones < audience.candidates.length ? (
          <p className="text-[12px] leading-snug text-foreground">
            Goes to <strong className="font-extrabold tabular-nums">{phones}</strong>{" "}
            {phones === 1 ? "family" : "families"}: children who share a number or are linked as siblings get
            one message.
          </p>
        ) : null}
        {/* What Narrow down is doing to these numbers, where the numbers are.
            Each chip clears itself alone; "Show all" clears every one. */}
        {narrowing.length > 0 ? (
          <div className="flex flex-col gap-1.5 border-t border-accent/20 pt-2">
            <p className="text-[12px] font-bold leading-snug text-foreground">
              {hidden > 0
                ? `Narrow down hides ${hidden} more ${
                    hidden === 1 ? "family who owes" : "families who owe"
                  } on ${tileWord}${classLabel ? ` in ${classLabel}` : ""}.`
                : "Narrowed by:"}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {narrowing.map((entry) => (
                <NavLink
                  key={entry.label}
                  href={entry.href}
                  scroll={false}
                  prefetch={false}
                  aria-label={`Remove the filter: ${entry.label}`}
                  className="tap focus-ring inline-flex min-h-11 items-center gap-1 rounded-full border border-accent/40 bg-card px-3 text-[12px] font-semibold text-foreground hover:border-accent md:min-h-8"
                >
                  {entry.label}
                  {entry.drops ? (
                    <span className="tabular-nums font-bold text-accent">−{entry.drops}</span>
                  ) : null}
                  <X className="size-3.5 text-muted-foreground" aria-hidden />
                </NavLink>
              ))}
              {hidden > 0 || narrowing.length > 1 ? (
                <NavLink
                  href={hidden > 0 ? showAllHref : clearAllHref}
                  scroll={false}
                  prefetch={false}
                  className="tap focus-ring inline-flex min-h-11 items-center rounded-full px-2 text-[12px] font-bold text-accent underline-offset-2 hover:underline md:min-h-8"
                >
                  {hidden > 0 ? `Show all ${audience.candidates.length + hidden}` : "Clear all"}
                </NavLink>
              ) : null}
            </div>
          </div>
        ) : null}
        {/* No JavaScript: a <details>, like Narrow down. Each row is the FIRST
            thing keeping those families off, so the rows add up. */}
        {funnel.owing > 0 ? (
          <details className="reveal group border-t border-accent/20 pt-1.5">
            <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md text-[12px] font-bold text-accent md:min-h-8">
              Why {audience.candidates.length}?
              <span className="font-semibold text-muted-foreground group-open:hidden">
                See who is left out
              </span>
            </summary>
            <ul className="flex flex-col gap-1 pb-1 text-[12px] leading-snug text-foreground">
              <li className="flex justify-between gap-3">
                <span>Owe on {tileWord}</span>
                <span className="tabular-nums font-bold">{funnel.owing}</span>
              </li>
              {funnelRows.map((row) => (
                <li key={row.label} className="flex justify-between gap-3 text-muted-foreground">
                  <span>− {row.label}</span>
                  <span className="tabular-nums font-semibold">{row.count}</span>
                </li>
              ))}
              {addedByHand > 0 ? (
                <li className="flex justify-between gap-3 text-muted-foreground">
                  <span>+ added by hand</span>
                  <span className="tabular-nums font-semibold">{addedByHand}</span>
                </li>
              ) : null}
              <li className="flex justify-between gap-3 border-t border-accent/20 pt-1 font-bold">
                <span>On the list</span>
                <span className="tabular-nums">{audience.candidates.length}</span>
              </li>
            </ul>
          </details>
        ) : null}
        {/* The reconciliation runs to a paragraph of figures; it answers "why
            this number" when somebody asks, so it waits to be opened. */}
        {notes.length > 0 ? (
          <details className="group text-[11.5px] leading-snug text-muted-foreground">
            <summary className="focus-ring inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded font-semibold text-accent [&::-webkit-details-marker]:hidden">
              How this number is worked out
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="size-3.5 transition-transform group-open:rotate-180"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <p className="mt-1">{notes.join(" ")}</p>
          </details>
        ) : null}
      </div>

      {/* ------------------------------------------------------------- tiles */}
      {/* Two columns on a phone, five across at the desk — a GRID that wraps,
          never a scrolling row: this is the control the office retunes on
          every run, and five counts are only comparable when all five are on
          screen. Each tile is the
          whole tap target; the count is who THAT tile alone would reach under
          the same narrowing, class and hold-backs as the list — so with one
          tile selected, its number is the list. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {[1, 2, 3, 4].map((installment) => {
          const tile = describeInstallmentTile(installment, calendar);
          return (
            <Tile
              key={installment}
              href={installmentTileHref(filters, installment, calendar)}
              selected={selectedInstallments.includes(installment)}
              title={`Installment ${installment}`}
              subtitle={tile.label}
              count={audience.tileCounts.byInstallment[installment - 1] ?? 0}
              owing={audience.tileOwingCounts.byInstallment[installment - 1] ?? 0}
            />
          );
        })}
        <Tile
          href={lastYearTileHref(filters, calendarDefault)}
          selected={filters.lastYear}
          title="Last year"
          subtitle={
            selectedInstallments.length > 0
              ? "Adds last session’s balance"
              : "Carried forward from last session"
          }
          count={audience.tileCounts.lastYear}
          owing={audience.tileOwingCounts.lastYear}
        />
      </div>

      {/* "Owing on all of them" is the default — the office asked for it — and
          the difference is not small: 187 against 345 on installments 1 and 2
          the day this shipped. Only shown when it can mean anything. */}
      {selectedInstallments.length > 1 ? (
        <div
          role="group"
          aria-label="How many of the selected installments they must still owe on"
          className="inline-flex w-fit overflow-hidden rounded-lg border border-border"
        >
          {INSTALLMENT_MATCHES.map((entry) => {
            const active = entry.value === filters.installmentMatch;
            return (
              <NavLink
                key={entry.value}
                href={installmentMatchHref(filters, entry.value)}
                scroll={false}
                prefetch={false}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "tap focus-ring inline-flex min-h-11 items-center px-3.5 text-[12px] font-bold md:min-h-9",
                  active
                    ? "bg-accent/12 text-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
              </NavLink>
            );
          })}
        </div>
      ) : null}

      {/* ---------------------------------------------------------- profiles */}
      {/* Always open, unlike Narrow down: how hard each family is chased is
          the decision the office makes every run, and Hardship and Quiet are
          OUT by default — a choice that changes who is messaged is never
          folded away. Each chip's number is who it would add. */}
      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-[12.5px] font-bold text-foreground">Reminder profiles</p>
          <NavLink
            href="/fees/reminders/families"
            prefetch={false}
            className="focus-ring rounded text-[11.5px] font-semibold text-accent underline-offset-2 hover:underline"
          >
            Change a family&rsquo;s profile
          </NavLink>
        </div>
        <div
          role="group"
          aria-label="Which reminder profiles this run reaches"
          className="flex flex-wrap gap-1.5"
        >
          {REMINDER_PROFILES.map((entry) => {
            const on = filters.profiles.includes(entry.value);
            const href = profileToggleHref(filters, entry.value);
            const chip = (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-4 place-items-center rounded border",
                    on ? "border-accent bg-accent text-accent-foreground" : "border-border-strong",
                  )}
                >
                  {on ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <ProfileBadge profile={entry.value} />
                <span className="tabular-nums text-[12px] font-extrabold text-foreground">
                  {audience.profileCounts[entry.value] ?? 0}
                </span>
              </>
            );
            const className = cn(
              "tap focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-2.5 md:min-h-9",
              on
                ? "border-accent/50 bg-accent/[0.06]"
                : "border-border bg-card hover:border-border-strong",
            );
            return href === null ? (
              <span
                key={entry.value}
                aria-current="true"
                aria-disabled="true"
                title={entry.hint}
                className={className}
              >
                {chip}
              </span>
            ) : (
              <NavLink
                key={entry.value}
                href={href}
                scroll={false}
                prefetch={false}
                title={entry.hint}
                aria-current={on ? "true" : undefined}
                className={className}
              >
                {chip}
              </NavLink>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------- narrow down */}
      {/* Folded on every viewport. Open by itself the moment any of it is
          applied, so a narrowed list never hides the fact; the summary line
          carries what is applied either way. */}
      <details open={narrowing.length > 0} className="reveal border-t border-border pt-3">
        <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 text-[12.5px] font-bold text-foreground md:min-h-0">
          <span>Narrow down</span>
          <span className="max-w-[62%] truncate text-[11px] font-semibold text-muted-foreground">
            {narrowing.length > 0
              ? narrowing.map((entry) => entry.label).join(" · ")
              : "Every class, whatever they have paid"}
          </span>
        </summary>
        {/* One tap each — see `Choice`. Only the two typed values (a class,
            an amount) still need the small form below. */}
        <div className="grid gap-x-4 gap-y-3.5 pt-3 md:grid-cols-2">
          <Choice
            label="Paid so far"
            hint={`Nothing yet is at most ${formatInr(DEFAULT_MAX_TOTAL_PAID)} received.`}
            options={PAID_OPTIONS.map((entry) => ({
              label: entry.label === "Either" ? "Anyone" : entry.label,
              href: choiceHref("paid", entry.value === "any" ? null : entry.value),
              active: filters.paid === entry.value,
            }))}
          />
          <Choice
            label="Late fee on these installments"
            options={[
              { value: "any", label: "Anyone" },
              { value: "yes", label: "Still charged" },
              { value: "no", label: "Not charged" },
            ].map((entry) => ({
              label: entry.label,
              href: choiceHref("lateFee", entry.value === "any" ? null : entry.value),
              active: filters.lateFee === entry.value,
            }))}
          />
          <Choice
            label="Promise to pay"
            hint="From the office's own contact log."
            options={PROMISE_OPTIONS.map((entry) => ({
              label: entry.label,
              href: choiceHref("promise", entry.value === "skip_open" ? null : entry.value),
              active: filters.promise === entry.value,
            }))}
          />
          <Choice
            label="Also"
            options={[
              ...(offerSkipOverdue
                ? [
                    {
                      label: "Skip families already overdue earlier",
                      href: choiceHref("skipOverdue", filters.skipOverdue ? null : "on"),
                      active: filters.skipOverdue,
                    },
                  ]
                : []),
              {
                label: "Include RTE students",
                href: choiceHref("includeRte", filters.includeRte ? null : "on"),
                active: filters.includeRte,
              },
            ]}
          />
        </div>

        <form method="get" className="pt-3.5">
          <div className="grid grid-cols-2 items-end gap-x-3 gap-y-3.5 md:grid-cols-[1fr_1fr_auto]">
            <Field id="classId" label="Class">
              <SelectNative
                id="classId"
                name="classId"
                defaultValue={filters.classId ?? ""}
                className={CONTROL}
              >
                <option value="">All classes</option>
                {/* Counted before the class filter is applied, so picking a class
                    does not empty the dropdown that picked it. */}
                {audience.classOptions.map((option) => (
                  <option key={option.classId} value={option.classId}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </SelectNative>
            </Field>
            <Field id="minDueAmount" label="Owing at least">
              <Input
                id="minDueAmount"
                name="minDueAmount"
                type="number"
                min={0}
                inputMode="numeric"
                defaultValue={filters.minDueAmount}
                className={CONTROL}
              />
            </Field>
            <div className="col-span-2 flex justify-end md:col-span-1">
              {/* `max-md:h-11`, not `h-11`: the button primitive carries a
                  compound variant `{ size: "sm", class: "max-md:h-10" }` that a
                  bare `h-11` loses to inside the media query, so Apply measured
                  40px beside 44px selects. Same variant level is what wins. */}
              <Button type="submit" variant="primary" size="sm" className="max-md:h-11 px-6 md:h-9">
                Apply
              </Button>
            </div>
          </div>
          {/* The tiles and the one-tap choices are NOT this form's keys, so
              they ride along as hidden inputs and pressing Apply cannot reset
              them. */}
          <CarriedFilterFields filters={filters} except={FILTER_FORM_KEYS} />
        </form>
      </details>

      {/* ---------------------------------------------------- by hand */}
      {/* A disclosure, not an always-open block. On a phone the search field,
          its button and three lines of standing explanation cost six rows
          above a list the office is scrolling to — for an action they take
          rarely. Open by default the moment anybody IS hand-picked, so a list
          that has been edited never hides that fact; the summary carries the
          counts either way, because a hand-picked student changes who gets a
          billed message and must never be invisible. */}
      <details
        open={handPicked > 0 || matches.length > 0 || Boolean(searchQuery)}
        className="border-t border-border pt-3"
      >
        <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 text-[12.5px] font-bold text-foreground md:min-h-0">
          <span className="inline-flex items-center gap-1.5">
            <Plus className="size-3.5" aria-hidden="true" />
            Add or remove specific students
          </span>
          {handPicked > 0 ? (
            <span className="rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-extrabold text-foreground">
              {included.length > 0 ? `${included.length} added` : null}
              {included.length > 0 && excluded.length > 0 ? " · " : null}
              {excluded.length > 0 ? `${excluded.length} removed` : null}
            </span>
          ) : null}
        </summary>
      <div className="flex flex-col gap-2 pt-2.5">
        <form
          action={addAction}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
            <Label htmlFor="addStudent" className="text-[11.5px] leading-tight">
              Add someone the filters missed
            </Label>
            <Input
              id="addStudent"
              name="addStudent"
              defaultValue={searchQuery}
              placeholder="Name or admission number"
              autoComplete="off"
              className="h-11 text-[13px] md:h-9"
            />
          </div>
          {/* A server action, so the tap has to say it landed — this form
              navigates, and on a phone a silent 400ms is a second tap. */}
          <PendingSubmitButton
            variant="outline"
            size="sm"
            className="max-md:h-11 px-4 md:h-9"
            pendingLabel="Finding…"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add
          </PendingSubmitButton>
          <CarriedFilterFields filters={filters} />
        </form>

        {matches.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-2.5">
            <p className="text-[11.5px] font-semibold text-foreground">
              {matches.length} match{matches.length === 1 ? "" : "es"} for &ldquo;{searchQuery}
              &rdquo; — pick one:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {matches.map((brief) => (
                <NavLink
                  key={brief.studentId}
                  href={`?${reminderQuery(filters, {
                    include: [...filters.includeStudentIds, brief.studentId].join(","),
                  }).toString()}`}
                  scroll={false}
                  prefetch={false}
                  className="focus-ring inline-flex min-h-9 items-center rounded-full border border-border bg-card px-3 text-[11.5px] font-semibold hover:border-border-strong"
                >
                  {brief.studentName} · {brief.admissionNo} · {brief.studentClass}
                  {brief.phoneOnRecord ? "" : " · no phone"}
                </NavLink>
              ))}
            </div>
          </div>
        ) : searchQuery && included.length === 0 ? (
          <p className="text-[11.5px] text-muted-foreground">
            Nobody in this session matches &ldquo;{searchQuery}&rdquo;.
          </p>
        ) : null}

        {handPicked > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {included.map((brief) => (
              <StudentChip
                key={brief.studentId}
                brief={brief}
                tone="included"
                title="Remove from the list"
                href={without("include", brief.studentId)}
              />
            ))}
            {excluded.map((brief) => (
              <StudentChip
                key={brief.studentId}
                brief={brief}
                tone="excluded"
                title="Put back on the list"
                href={without("exclude", brief.studentId)}
              />
            ))}
          </div>
        ) : null}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Someone added by hand joins the list whatever the filters and their reminder cadence say —
          naming them is the more recent decision. It cannot get past the three things that mean a
          family is uncontactable: off the roll having never paid, flagged no-call, or no usable
          number.
        </p>
      </div>
      </details>
    </div>
  );
}

/**
 * The keys the Narrow-down form owns. Everything else — the tiles, the notice,
 * the language, the deadline, the hand-picked students — rides along as a
 * hidden input, or pressing Apply would reset choices the office made, all of
 * which a parent then reads.
 */
const FILTER_FORM_KEYS = ["minDueAmount", "classId"] as const satisfies readonly ReminderQueryKey[];
