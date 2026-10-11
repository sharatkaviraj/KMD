/**
 * The QA accounts, and what each one exists to prove.
 *
 * One list, read by three things: `scripts/qa-fixture.mjs` creates them,
 * `scripts/smoke-roles.mjs` signs in as them, and `tests/qa-fixture.test.ts`
 * checks the list itself is coherent. Before this existed the smoke runner
 * carried its own map of six addresses, which is how B-17 survived — the
 * account it signed in as for `teacher` had no class, no periods and no
 * assignments, so every "teacher" result in a 216-combination run was a result
 * about an empty teacher and nobody could tell.
 *
 * **The `purpose` field is the point.** An account with no stated purpose is an
 * account somebody will eventually reuse for a different case and break both.
 *
 * Rule 6: every address is `@qa.vpps.local`, which is not a deliverable domain,
 * and no real member of staff is named here. Which *existing* staff profile a
 * teaching account binds to is resolved at seed time by the rule in `binding`,
 * never by a name written into this repository.
 */

import type { StaffRole } from "@/platform/auth/permissions";

export type QaLanguage = "hi" | "en" | "both";

/**
 * How an account is attached to a staff profile.
 *
 * - `existing` — the profile already exists and is found by its short name.
 *   These are the QA-only profiles seeded in Phase 1.
 * - `timetable-teacher` — bind to a teacher the **published timetable already
 *   knows**, chosen by rule at seed time. This is what gives a QA teacher a
 *   real day: periods come from `timetable_slots`, so an account that is not in
 *   the sheet has no periods no matter what else is written for it.
 * - `create` — a profile that does not exist yet and is made by the seeder.
 */
export type QaBinding =
  | { kind: "existing"; shortName: string }
  | { kind: "timetable-teacher"; slot: 1 | 2 }
  | { kind: "create"; shortName: string; displayName: string; isActive: boolean };

export type QaAccount = {
  /** Stable key used by runners and evidence records. */
  key: string;
  email: string;
  role: StaffRole;
  language: QaLanguage;
  binding: QaBinding;
  /** Whether this account is expected to be able to sign in at all. */
  canSignIn: boolean;
  /** What breaks if this account stops existing. */
  purpose: string;
};

/**
 * Two teaching accounts, and they must not share a class.
 *
 * Slot 1 is the teacher every ordinary teacher case runs as. Slot 2 exists so
 * "own classes" can be tested as a *boundary* rather than as a feature: a
 * permission says a teacher may mark attendance and only a query says whose,
 * and the only way to catch a missing `.eq(staff_profile_id, …)` is to have a
 * second teacher whose classes the first one must not see.
 *
 * The seeder picks them with `pickTimetableTeachers()` below.
 */
export const QA_ACCOUNTS: readonly QaAccount[] = [
  {
    key: "admin",
    email: "qa.admin@qa.vpps.local",
    role: "admin",
    language: "both",
    binding: { kind: "existing", shortName: "QAAD" },
    canSignIn: true,
    purpose: "Every screen, and the bilingual rendering of all of them.",
  },
  {
    key: "office",
    email: "qa.accountant@qa.vpps.local",
    role: "office",
    language: "hi",
    binding: { kind: "existing", shortName: "QAOF" },
    canSignIn: true,
    purpose: "Office work in Hindi: collection, review, attendance on behalf.",
  },
  {
    key: "accountant",
    email: "qa.fees@qa.vpps.local",
    role: "accountant",
    language: "en",
    binding: {
      kind: "create",
      shortName: "QAAN",
      displayName: "QA Accountant",
      isActive: true,
    },
    canSignIn: true,
    purpose:
      "The fee desk: posts payments, waives late fees and prints receipts. Paired with office to prove that office cannot post, and with feeCollector to prove that collection alone does not grant waiver, correction, reversal or bulk-entry permissions.",
  },
  {
    key: "feeCollector",
    email: "qa.recovery@qa.vpps.local",
    role: "fee_collector",
    language: "hi",
    binding: {
      kind: "create",
      shortName: "QAFC",
      displayName: "QA Fee Collector",
      isActive: true,
    },
    canSignIn: true,
    purpose:
      "Reads fee screens, logs parent contact attempts and posts payments with printed receipts. Paired with accountant to prove that collection does not grant late-fee waiver; corrections, reversals, bulk entry and day close remain unavailable.",
  },
  {
    key: "academic",
    email: "qa.academic@qa.vpps.local",
    role: "academic_coordinator",
    language: "en",
    binding: { kind: "existing", shortName: "QAAC" },
    canSignIn: true,
    purpose: "Timetable, cover and the academic calendar.",
  },
  {
    key: "exam",
    email: "qa.exam@qa.vpps.local",
    role: "exam_coordinator",
    language: "en",
    binding: { kind: "existing", shortName: "QAEC" },
    canSignIn: true,
    purpose: "Assessments, marks entry and report readiness.",
  },
  {
    key: "teacher",
    email: "qa.teacher@qa.vpps.local",
    role: "teacher",
    language: "hi",
    binding: { kind: "timetable-teacher", slot: 1 },
    canSignIn: true,
    purpose:
      "A teacher with a real day: periods in the published timetable, a class of their own, and a register to take. Reading this account in Hindi also keeps the teacher surface honest about word order.",
  },
  {
    key: "teacher2",
    email: "qa.teacher2@qa.vpps.local",
    role: "teacher",
    language: "en",
    binding: { kind: "timetable-teacher", slot: 2 },
    canSignIn: true,
    purpose:
      "A second teacher whose classes do not overlap the first's. Every 'own classes' boundary is tested against this account, because a query missing its staff filter passes every test that only ever has one teacher.",
  },
  {
    key: "teacherWithoutClasses",
    email: "qa.teacher.none@qa.vpps.local",
    role: "teacher",
    language: "hi",
    binding: { kind: "existing", shortName: "QATE" },
    canSignIn: true,
    purpose:
      "A teacher who holds nothing. 'No class of your own' is one of the three kinds of nothing the Today card names (D-59), and it is the one that used to be the only teacher fixture there was.",
  },
  {
    key: "inactive",
    email: "qa.inactive@qa.vpps.local",
    role: "teacher",
    language: "en",
    binding: {
      kind: "create",
      shortName: "QAIN",
      displayName: "QA Deactivated",
      isActive: false,
    },
    canSignIn: false,
    purpose:
      "A deactivated profile with a live Supabase session behind it. The login page refuses from the profile rather than the JWT (D-23); without this account nothing exercises that path.",
  },
  {
    key: "viewOnly",
    email: "qa.viewonly@qa.vpps.local",
    role: "view_only",
    language: "hi",
    binding: { kind: "existing", shortName: "QAVW" },
    canSignIn: true,
    purpose: "Oversight without per-child records.",
  },
];

/** The QA email domain. Nothing outside it is ever created by the fixture. */
export const QA_EMAIL_DOMAIN = "@qa.vpps.local";

export function qaAccount(key: string): QaAccount {
  const found = QA_ACCOUNTS.find((account) => account.key === key);
  if (!found) throw new Error(`No QA account named ${key}`);
  return found;
}

/** `role` → the address the role runners sign in as. Signable accounts only. */
export function accountsByRole(): Record<string, string> {
  const map: Record<string, string> = {};

  for (const account of QA_ACCOUNTS) {
    // First wins, so the list order decides which teacher represents
    // `teacher` — and the representative is the one with a real day, not the
    // empty one that happens to sort first alphabetically.
    if (account.canSignIn && !(account.role in map)) {
      map[account.role] = account.email;
    }
  }

  return map;
}

/* ------------------------------------------------- picking two teachers */

export type TimetableTeacher = {
  staffProfileId: string;
  shortName: string;
  /** Distinct class ids this teacher has periods in, from the published sheet. */
  classIds: readonly string[];
  slots: number;
};

export type TeacherPair = { first: TimetableTeacher; second: TimetableTeacher };

/**
 * Choose the two teaching accounts' profiles from the published timetable.
 *
 * Deterministic and name-free: most periods first, ties broken by short name,
 * and the second pick is the first candidate after that whose classes do not
 * intersect the first's. No teacher's name is written into this repository;
 * the rule is, and the run prints what it resolved to.
 *
 * Throws rather than falling back. A fixture that quietly pairs two teachers
 * who share Class 8 produces a run where every cross-teacher leak test passes
 * for the wrong reason, which is worse than no run at all.
 */
export function pickTimetableTeachers(
  candidates: readonly TimetableTeacher[],
): TeacherPair {
  const ordered = [...candidates]
    .filter((teacher) => teacher.slots > 0 && teacher.classIds.length > 0)
    .sort(
      (a, b) => b.slots - a.slots || a.shortName.localeCompare(b.shortName, "en"),
    );

  const first = ordered[0];

  if (!first) {
    throw new Error(
      "No teacher in the published timetable has any periods. Run `npm run seed:timetable` first.",
    );
  }

  const held = new Set(first.classIds);
  const second = ordered
    .slice(1)
    .find((teacher) => teacher.classIds.every((classId) => !held.has(classId)));

  if (!second) {
    throw new Error(
      `Every other teacher shares a class with ${first.shortName}, so there is no disjoint second teacher to test 'own classes' against.`,
    );
  }

  return { first, second };
}
