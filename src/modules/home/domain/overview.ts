import * as m from "@/messages/pairs";
import type { Localized } from "@/platform/i18n/language";

/**
 * The administrator's combined view of the school, as figures rather than as a
 * queue.
 *
 * `attention.ts` answers "what needs a decision"; this answers the question
 * underneath it — **is the day going normally?** The design package asks the
 * administrator's home for "attendance, collections, SamPark, cover and exam
 * readiness" side by side, and the useful version of that is four or five
 * fractions a person can read in a glance, not a chart.
 *
 * Pure, and every count is `number | null`. Null means **the count could not
 * be read**, which is not nought: a home that reports a confident 0 registers
 * outstanding tells an administrator the morning is finished when in fact a
 * query failed (D-93). The same rule the attention list already follows.
 *
 * Fees are here as a first-class "unavailable". VPPS One reads no fee figures
 * yet — R6 is where that lands — and the design handoff is explicit that a
 * missing fee source must render as unavailable with a next step, "never ₹0".
 * So this file carries the row and the honest state, rather than the row being
 * quietly left out until it can be filled with a number.
 */

export type OverviewFacts = {
  /** Daily registers submitted today, and how many classes there are. */
  registersIn: number | null;
  classesTotal: number | null;
  /** Teaching staff not marked away today, out of the active teaching roll. */
  staffPresent: number | null;
  staffTotal: number | null;
  /**
   * Periods needing cover today and how many have somebody, from the
   * **published** plan. A draft is the coordinator still deciding.
   */
  coverArranged: number | null;
  coverNeeded: number | null;
  /** False when nothing is published for today — different from "0 of 0". */
  coverPublished: boolean;
  /** The plan read failed; distinct from no published plan. */
  coverUnavailable?: boolean;
  /** Exams currently open for marks. */
  examsOpen: number | null;
  /** The newest open information round, if there is one. */
  round: {
    title: Localized;
    href: string;
    answered: number;
    members: number;
  } | null;
  /** True when the round could not be read at all, as opposed to none open. */
  roundUnavailable: boolean;
};

export type OverviewRow = {
  key: "registers" | "staff" | "cover" | "exams";
  label: Localized;
  /** Already formatted for reading — "28 / 30", "4", or a dash. */
  figure: string;
  /** For the bar. Null on either side draws no bar at all. */
  value: number | null;
  total: number | null;
  /** Said in words when the figure alone would be misread. */
  note: Localized | null;
  tone: "neutral" | "warning";
};

/** "28 / 30", or a dash when either half is missing. */
function fraction(value: number | null, total: number | null): string {
  if (value === null || total === null) return "—";
  return `${value} / ${total}`;
}

/**
 * The day's figures, in the order an administrator asks about them.
 *
 * Attendance first because it has a deadline, then who is in the building,
 * then whether the gaps that leaves are covered, then exams — which are a
 * fortnight's worry rather than this morning's.
 */
export function overviewRows(facts: OverviewFacts): OverviewRow[] {
  const registersOutstanding =
    facts.registersIn === null || facts.classesTotal === null
      ? null
      : facts.classesTotal - facts.registersIn;

  const staffAway =
    facts.staffPresent === null || facts.staffTotal === null
      ? null
      : facts.staffTotal - facts.staffPresent;

  const coverOutstanding =
    facts.coverArranged === null || facts.coverNeeded === null
      ? null
      : facts.coverNeeded - facts.coverArranged;

  return [
    {
      key: "registers",
      label: m.overviewAttendanceSubmitted,
      figure: fraction(facts.registersIn, facts.classesTotal),
      value: facts.registersIn,
      total: facts.classesTotal,
      note: facts.registersIn === null ? m.homeUnavailable : null,
      tone: registersOutstanding !== null && registersOutstanding > 0 ? "warning" : "neutral",
    },
    {
      key: "staff",
      label: m.overviewTeachingNotAway,
      figure: fraction(facts.staffPresent, facts.staffTotal),
      value: facts.staffPresent,
      total: facts.staffTotal,
      note: facts.staffPresent === null ? m.homeUnavailable : m.overviewTeachingBasis,
      tone: staffAway !== null && staffAway > 0 ? "warning" : "neutral",
    },
    {
      key: "cover",
      label: m.overviewCoverArranged,
      // "0 / 0" for a day with nothing published reads as a failure; the note
      // is what makes "there is no plan" different from "the plan is empty".
      figure: facts.coverPublished ? fraction(facts.coverArranged, facts.coverNeeded) : "—",
      value: facts.coverPublished ? facts.coverArranged : null,
      total: facts.coverPublished ? facts.coverNeeded : null,
      note: facts.coverUnavailable ? m.homeUnavailable : facts.coverPublished
        ? facts.coverArranged === null
          ? m.homeUnavailable
          : null
        : m.overviewCoverNoPlan,
      tone: coverOutstanding !== null && coverOutstanding > 0 ? "warning" : "neutral",
    },
    {
      key: "exams",
      label: m.overviewExamsOpen,
      figure: facts.examsOpen === null ? "—" : String(facts.examsOpen),
      // A count with no denominator: a bar would need one, and "3 exams out of
      // what" is not a question the school asks.
      value: null,
      total: null,
      note: facts.examsOpen === null ? m.homeUnavailable : null,
      tone: "neutral",
    },
  ];
}

/**
 * How the fee figures stand, from this app's point of view.
 *
 * One function rather than a boolean at the call site, because the answer has
 * to be the same sentence everywhere it appears and because it will change in
 * exactly one place when R6 lands. Until then it is honest: no amount, no
 * currency symbol, and a destination that does hold the number.
 */
export type FeeSummary =
  | { kind: "unavailable"; reason: Localized }
  | { kind: "amount"; figure: string; asOf: Localized };

export function feeSummary(): FeeSummary {
  // R6.1/R6.2 replace this with a read of the fee app's own totals through a
  // verified handoff. Rendering ₹0 in the meantime would be a number an
  // administrator could act on, and it would be wrong every single day.
  return { kind: "unavailable", reason: m.overviewFeeUnavailable };
}
