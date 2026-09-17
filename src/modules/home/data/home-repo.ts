import "server-only";

import { assertStaff } from "@/platform/auth/current-staff";
import { can, type StaffRole } from "@/platform/auth/permissions";
import {
  classLabelMap,
} from "@/modules/academics/data/academics-repo";
import { registersForDay } from "@/modules/attendance/data/attendance-repo";
import { countPendingCorrections } from "@/modules/attendance/data/corrections-repo";
import { pendingSubmissionCount } from "@/modules/collection/data/submissions-repo";
import { listEnrolments } from "@/modules/enrolments/data/enrolments-repo";
import { jobsBoard } from "@/modules/jobs/data/jobs-repo";
import { absenceCountOn } from "@/modules/substitutions/data/absences-repo";
import type { AttentionFacts, AttentionKey } from "@/modules/home/domain/attention";

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

  const [registers, labels, absences, submissions, corrections, jobs, enrolments] =
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
        ? attempt("corrections", missing, () => countPendingCorrections())
        : null,
      wants("jobs") ? attempt("jobs", missing, () => jobsBoard()) : null,
      wants("school")
        ? attempt("school", missing, () => listEnrolments(sessionLabel))
        : null,
    ]);

  const classesTotal = labels?.size ?? 0;

  const submitted = new Set(
    (registers ?? [])
      .filter((entry) => entry.period === null && entry.status === "submitted")
      .map((entry) => entry.classId),
  );

  const registersIn = registers === null ? null : submitted.size;
  const registersOutstanding =
    registers === null || labels === null ? 0 : Math.max(0, classesTotal - submitted.size);

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
