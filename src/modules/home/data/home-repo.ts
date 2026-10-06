import "server-only";

import { assertPermission, assertStaff } from "@/platform/auth/current-staff";
import { can, type StaffRole } from "@/platform/auth/permissions";
import {
  classLabelMap,
} from "@/modules/academics/data/academics-repo";
import {
  attendanceCalendar,
  registersForDay,
} from "@/modules/attendance/data/attendance-repo";
import { isSchoolOpen } from "@/modules/academics/domain/calendar";
import { countPendingCorrections } from "@/modules/attendance/data/corrections-repo";
import { pendingSubmissionCount } from "@/modules/collection/data/submissions-repo";
import { listEnrolments } from "@/modules/enrolments/data/enrolments-repo";
import { jobsBoard } from "@/modules/jobs/data/jobs-repo";
import {
  absenceCountOn,
  absencesOn,
} from "@/modules/substitutions/data/absences-repo";
import { listAssessments } from "@/modules/assessments/data/assessments-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { dutiesOn, liveOnly } from "@/modules/substitutions/data/cover-repo";
import { listRounds } from "@/modules/collection/data/rounds-repo";
import { linksForRound } from "@/modules/collection/data/fan-out-repo";
import type { AttentionFacts, AttentionKey } from "@/modules/home/domain/attention";
import type { OverviewFacts } from "@/modules/home/domain/overview";

/**
 * The counts behind a role's home, read in parallel and failing loudly.
 *
 * **A count that could not be read comes back null, not nought** (D-93). The
 * daily summary job once reported "19 classes have no class teacher" because a
 * query error was swallowed by `const { data } = await …`, and a dashboard is
 * exactly where that mistake is most expensive: an administrator reading a
 * confident 0 concludes there is nothing outstanding, which is the one wrong
 * answer this screen can give.
 *
 * So each read is wrapped, a failure records its key in `unavailable`, and the
 * screen renders a dash and says the count could not be read.
 *
 * Only the counts this role will actually display are fetched. A viewer does
 * not need the collection queue and the exam coordinator does not need either,
 * and a dashboard that reads six tables to render two numbers is the kind of
 * thing R7.1 comes back to delete.
 */

export type HomeSummary = {
  facts: AttentionFacts;
  /** For the viewer's read-only figures. */
  school: {
    childrenOnRoll: number | null;
    classes: number | null;
    registersIn: number | null;
  };
};

/**
 * The newest open information round, with how far it has got.
 *
 * The title travels as the two authored halves rather than as a `Localized`,
 * so the screen decides how to read it — `AuthoredText` already knows what to
 * do when the office typed only one of them (B-05).
 */
export type OverviewRound = {
  id: string;
  titleHi: string | null;
  titleEn: string | null;
  /** Distinct children who have answered, of those the round froze in. */
  answered: number;
  members: number;
};

/** Which facts a role's screen will read, so nothing else is fetched. */
function wanted(role: StaffRole): Set<AttentionKey | "school"> {
  switch (role) {
    case "admin":
      return new Set(["registers", "absences", "review", "corrections", "jobs", "school"]);
    case "office":
      return new Set(["registers", "absences", "review", "corrections"]);
    case "academic_coordinator":
      return new Set(["registers", "absences"]);
    case "view_only":
      return new Set(["school", "registers"]);
    default:
      return new Set();
  }
}

/** Run a read, and record which count is missing rather than calling it zero. */
async function attempt<T>(
  key: AttentionKey | "school",
  missing: (AttentionKey | "school")[],
  read: () => Promise<T>,
): Promise<T | null> {
  try {
    return await read();
  } catch {
    missing.push(key);
    return null;
  }
}

export async function homeSummary(
  sessionLabel: string,
  today: string,
): Promise<HomeSummary> {
  const staff = await assertStaff();
  const need = wanted(staff.role);
  const missing: (AttentionKey | "school")[] = [];

  const wants = (key: AttentionKey | "school") => need.has(key);

  const [
    registers,
    labels,
    absences,
    submissions,
    corrections,
    jobs,
    enrolments,
    calendar,
  ] =
    await Promise.all([
      wants("registers") || wants("school")
        ? attempt("registers", missing, () => registersForDay(sessionLabel, today))
        : null,
      wants("registers") || wants("school")
        ? attempt("school", missing, () => classLabelMap(sessionLabel))
        : null,
      wants("absences")
        ? attempt("absences", missing, () => absenceCountOn(sessionLabel, today))
        : null,
      wants("review")
        ? attempt("review", missing, () => pendingSubmissionCount())
        : null,
      wants("corrections") && can(staff, "attendance:correct")
        ? attempt("corrections", missing, () => countPendingCorrections(sessionLabel))
        : null,
      wants("jobs") ? attempt("jobs", missing, () => jobsBoard()) : null,
      wants("school")
        ? attempt("school", missing, () => listEnrolments(sessionLabel))
        : null,
      // Whether the school is open at all today. Without it a Sunday reads
      // as every register outstanding — see the note below.
      wants("registers")
        ? attempt("registers", missing, () => attendanceCalendar(sessionLabel))
        : null,
    ]);

  const classesTotal = labels?.size ?? 0;

  const submitted = new Set(
    (registers ?? [])
      .filter((entry) => entry.period === null && entry.status === "submitted")
      .map((entry) => entry.classId),
  );

  const registersIn = registers === null ? null : submitted.size;

  /*
   * Nothing is outstanding on a day the school is shut.
   *
   * This subtracted submitted registers from the class count and stopped
   * there, so on a Sunday — when no register is due and none is taken — the
   * administrator's home said **19 of 19 outstanding**, owner: teachers. It
   * had been wrong every weekend since R2.2 and was only seen when somebody
   * opened the deployed site on one.
   *
   * D-101 is the same bug in the nightly job, fixed there in 7.4; this is
   * the second copy of the question. The rule that catches both: a count on
   * this screen has to be a fact about work somebody could do, and there is
   * no register to take on a closed day.
   *
   * Zero rather than null. Null means "we could not read it" and renders a
   * dash; this is not unknown — it is known to be nothing, which is one of
   * the three kinds of nothing D-59 asks to be told apart.
   */
  const schoolOpenToday = calendar === null || isSchoolOpen(today, calendar);

  const registersOutstanding =
    registers === null || labels === null || !schoolOpenToday
      ? 0
      : Math.max(0, classesTotal - submitted.size);

  // The latest *attempt* per job, skips included: "did it fire this morning"
  // is a different question from "what did it do", and a failure that a later
  // skip hid would be a failure nobody was told about.
  const failedJobs =
    jobs === null
      ? 0
      : [...jobs.latest.values()].filter((run) => run.status === "failed").length;

  if (registers === null || labels === null) missing.push("registers");

  return {
    facts: {
      registersOutstanding,
      schoolOpenToday,
      classesTotal,
      absencesToday: absences ?? 0,
      pendingSubmissions: submissions ?? 0,
      pendingCorrections: corrections ?? 0,
      failedJobs,
      unavailable: [...new Set(missing)].filter(
        (key): key is AttentionKey => key !== "school",
      ),
    },
    school: {
      childrenOnRoll:
        enrolments === null
          ? null
          : enrolments.filter((row) => row.status === "enrolled").length,
      classes: labels === null ? null : classesTotal,
      registersIn,
    },
  };
}

/* ------------------------------------ the administrator's combined view */

/**
 * The figures behind the administrator's school overview.
 *
 * A separate function from `homeSummary()` on purpose: it is five more reads,
 * only one role asks for them, and folding them into the shared summary would
 * make every other role's home pay for a panel it never renders (§6 of the
 * design system, and the same reasoning `wanted()` above already applies).
 *
 * Same discipline as the summary: each read is wrapped, and a failure becomes
 * **null rather than nought**. "No registers are outstanding" and "the
 * register query failed" look identical on a screen that counts rows, and only
 * one of them means the morning is finished (D-93).
 *
 * Fees are deliberately not read here. VPPS One holds no fee totals until R6,
 * and `feeSummary()` in the domain says so in one place rather than this
 * function inventing a nought.
 */
export async function schoolOverview(
  sessionLabel: string,
  today: string,
): Promise<{ facts: OverviewFacts; round: OverviewRound | null }> {
  await assertPermission("dashboard:view");

  const missing: string[] = [];

  const guard = async <T,>(key: string, read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch {
      missing.push(key);
      return null;
    }
  };

  const [registers, labels, staff, absences, plan, assessments, round] =
    await Promise.all([
      guard("registers", () => registersForDay(sessionLabel, today)),
      guard("classes", () => classLabelMap(sessionLabel)),
      guard("staff", () => listStaff()),
      guard("absences", () => absencesOn(sessionLabel, today)),
      // The live duties. There is no draft any more: a cover command commits
      // and publishes in one step (P3), so every live row is a decision
      // somebody took — assigned, or visibly needing help.
      guard("cover", async () => {
        const live = liveOnly(await dutiesOn(sessionLabel, today));
        return live.length === 0 ? null : live;
      }),
      guard("exams", () => listAssessments(sessionLabel)),
      guard("round", () => newestOpenRound(sessionLabel)),
    ]);

  const classesTotal = labels === null ? null : labels.size;

  const registersIn =
    registers === null
      ? null
      : new Set(
          registers
            .filter((entry) => entry.period === null && entry.status === "submitted")
            .map((entry) => entry.classId),
        ).size;

  // The teaching roll, not everybody: the office and the librarian are not
  // "staff present" in the sense a cover decision needs.
  const teaching = staff === null ? null : staff.filter((row) => row.isActive && row.isTeaching);

  const awayIds = absences === null ? null : new Set(absences.map((row) => row.staffProfileId));

  const staffPresent =
    teaching === null || awayIds === null
      ? null
      : teaching.filter((row) => !awayIds.has(row.id)).length;

  // `plan` is null for two different reasons — the read failed, or nothing is
  // published — and only the second one is normal. `missing` tells them apart.
  const coverPublished = plan !== null;

  return {
    facts: {
      registersIn,
      classesTotal,
      staffPresent,
      staffTotal: teaching === null ? null : teaching.length,
      coverArranged:
        plan === null ? null : plan.filter((row) => row.coveringStaffId !== null).length,
      coverNeeded: plan === null ? null : plan.length,
      coverPublished,
      coverUnavailable: missing.includes("cover"),
      examsOpen:
        assessments === null
          ? null
          : assessments.filter((row) => row.status === "open").length,
      round: null,
      roundUnavailable: missing.includes("round"),
    },
    round,
  };
}

/**
 * The newest round that is still open, and how many of its children answered.
 *
 * "Newest" rather than "all": an administrator wants to know whether this
 * week's ask is landing, and a list of every round the school has ever run is
 * the rounds board's job. Null when nothing is open, which is a normal state
 * and not a failure.
 */
async function newestOpenRound(sessionLabel: string): Promise<OverviewRound | null> {
  const rounds = await listRounds(sessionLabel);
  const open = rounds.filter((row) => row.status === "open");
  if (open.length === 0) return null;

  // `listRounds` orders newest first; this does not re-sort on `createdAt`
  // because the two would then have to agree forever.
  const round = open[0];
  const links = await linksForRound(round.id);

  return {
    id: round.id,
    titleHi: round.titleHi,
    titleEn: round.titleEn,
    answered: links.reduce((total, link) => total + link.answered, 0),
    members: links.reduce((total, link) => total + link.members, 0),
  };
}
