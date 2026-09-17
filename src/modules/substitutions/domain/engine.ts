/**
 * The substitution engine, ported from `timetable2025/scripts/substitution.js`.
 *
 * It has run this school's cover for a year. The port keeps every number, every
 * tier and every tie-break; what changed is listed at the bottom of this
 * comment and nowhere else, so a future reader can diff the two files and find
 * only types.
 *
 * The shape of the thing: a vacancy is one class, one period, one subject. For
 * each vacancy every member of staff is scored, and the scores are fed to a
 * min-cost maximum-flow solver so the whole day is allocated at once rather
 * than greedily period by period. Greedy allocation is what hands the first
 * vacancy to the best teacher in the school and then discovers that the fourth
 * one needed them.
 *
 * The scoring is deliberately two-layer:
 *
 *  - **the tier** says how useful this cover is to the class, and school policy
 *    is that familiarity with the class comes first — a teacher those children
 *    already know can hold a useful lesson where a stranger with the right
 *    subject often cannot;
 *  - **the modifiers** — fatigue, repetition, history, load — reorder people
 *    *inside* a tier and can never cross one, because the tier bases are spaced
 *    further apart than twice the modifier clamp. `tierDominates()` is the
 *    executable statement of that invariant, and a test asserts it for every
 *    adjacent pair.
 *
 * **Keys are opaque strings.** The original keyed everything by teacher name
 * because it had no database. VPPS One passes `staff_profiles.id`, and nothing
 * in here cares which it is.
 *
 * ## What the port changed, and why
 *
 *  - **`createPlanStore` is gone.** It was a `localStorage` store with 30-day
 *    pruning and schedule-version invalidation. Plans are rows here, so the
 *    pruning is a query and the invalidation is `substitution_plans.version_id`
 *    — see `planIsStale()`, which is the rule kept as a function.
 *  - **`DEFAULT_SHIFTS` and `SHIFT_POLICY_VERSION` are gone.** They hard-coded
 *    a real teacher's name and part-time hours in source, which rule 6 forbids
 *    and which meant the school could not change its own hours without a
 *    deploy. Shifts are rows in `cover_policies` (task 4.4); the version stamp
 *    existed only to break a tie between a shipped constant and a stored copy,
 *    and with no constant there is no tie.
 *  - **Reserve and duty staff come from `cover_policies.cover_role`** rather
 *    than from two hard-coded name lists, for the same reason.
 */

/* --------------------------------------------------------------- policy */

export const DEFAULT_MAX_AUTO_SUBSTITUTIONS = 2;
export const DEFAULT_MAX_CONSECUTIVE = 3;
export const DEFAULT_PERIOD_COUNT = 8;

export const SUBJECT_ALIASES: Record<string, string> = {
  mathematics: "maths",
  math: "maths",
  english: "english compulsory",
  "computer science": "ccs",
  computers: "ccs",
  "physical education": "sports",
  games: "sports",
  "environmental studies": "evs",
  "social studies": "sst",
  accounts: "accountancy",
  "eng lit": "english literature",
  gs: "general studies",
};

export const SUBJECT_GROUPS: Record<string, string[]> = {
  english: ["english compulsory", "english literature", "elga"],
  science: ["science", "physics", "chemistry", "biology", "evs"],
  social: [
    "sst",
    "history",
    "geography",
    "political science",
    "civics",
    "general studies",
  ],
  commerce: ["accountancy", "business studies", "economics"],
  computing: ["ccs", "robotics"],
  maths: ["maths"],
  hindi: ["hindi"],
  sanskrit: ["sanskrit"],
  sports: ["sports"],
};

export const TIER_ORDER = [
  "class_subject",
  "class",
  "exact",
  "approved",
  "related",
  "general",
  "last_resort",
  "reserve",
] as const;

export type MatchTier = (typeof TIER_ORDER)[number];

export const TIER_GAP = 1500;
export const MODIFIER_CAP = 700;

export const TIER_SCORE: Record<MatchTier, number> = {
  class_subject: 15000,
  class: 13500,
  exact: 12000,
  approved: 10500,
  related: 5500,
  general: 4000,
  // Duty-holders: coordinators and exam in-charges. The school's own
  // free-teacher chart stars them and says to use them "only if no one else is
  // free", so they sit below every ordinary candidate but above the reserve —
  // they are still teaching staff and still get suggested, just last, and
  // never without a coordinator confirming.
  last_resort: 2500,
  // Admin staff who can be asked, but are never volunteered. Bottom of the
  // ladder so they sort last by the ordinary rules rather than by a special
  // case bolted onto the sort.
  reserve: 1000,
};

/**
 * Tiers the engine may assign without a coordinator confirming.
 *
 * `class` qualifies on the school's own evidence: the timetable says this
 * teacher works with these children every week.
 */
export const AUTO_TIERS: MatchTier[] = ["class_subject", "class", "exact", "approved"];

export const WEIGHTS = {
  // Familiarity, inside a tier: eight periods a week beats one.
  classPeriod: 26,
  classPeriodMax: 210,
  sameGrade: 90,
  sameBand: 45,
  lightDay: 22,
  // Fatigue.
  consecutiveEach: 45,
  consecutiveOver: 210,
  lastFreePeriod: 620,
  nearlyFullDay: 150,
  // Repetition, today and over the retention window.
  repeatToday: 260,
  historyEach: 70,
  historyMax: 420,
  // Cost added to each successive cover in the flow. Below TIER_GAP, so
  // spreading reorders within a tier and never overrides familiarity.
  spreadStep: 600,
} as const;

/**
 * Combining two classes under one teacher.
 *
 * When nobody is free, a school does not leave thirty children alone — it
 * sends them next door. A gap of one keeps that sensible: Class 5 may join
 * Class 4 or 6, and the three Class 11 streams may join each other, but
 * Class 1 never joins Class 9.
 */
export const MAX_GRADE_GAP = 1;

/* ---------------------------------------------------------------- types */

export type BlockReason = "absent" | "regular_class" | "double_booked" | "unavailable";

export type CoverWarning =
  | "reserve_staff"
  | "duty_holder"
  | "class_not_subject"
  | "related_subject"
  | "subject_mismatch"
  | "over_substitution_limit"
  | "full_day"
  | "excessive_consecutive";

export type ScheduleSlot = { subject?: string | null; className?: string | null };

/** `schedule[day][periodIndex]` — null where the teacher is free. */
export type TeacherSchedule = Record<string, (ScheduleSlot | null)[]>;

export type TeacherDetail = {
  subjects?: Iterable<string> | string[] | Set<string>;
  schedule?: TeacherSchedule;
};

export type Availability = {
  allowedPeriodIndexes?: number[];
  blockedPeriodIndexes?: number[];
} | null;

export type PolicyOverride = {
  canTeach?: string[];
  canCover?: string[];
  gradeBands?: string[];
  availability?: Availability;
  maxAutoSubstitutions?: number;
};

export type TeacherProfile = {
  teacher: string;
  reserve: boolean;
  lastResort: boolean;
  subjects: Set<string>;
  canCover: Set<string>;
  grades: Set<number>;
  classLoad: Record<string, number>;
  classSubjects: Record<string, Set<string>>;
  gradeBands: Set<string>;
  schedule: TeacherSchedule;
  availability: Availability;
  maxAutoSubstitutions: number;
};

export type TeacherProfiles = Record<string, TeacherProfile>;

export type Vacancy = {
  slotId?: string;
  periodIndex: number;
  className: string;
  subject: string;
  originalTeacher?: string;
};

export type PlacedVacancy = Vacancy & { slotId: string };

export type AssignmentLike = {
  slotId?: string;
  teacher: string;
  periodIndex: number;
};

export type LoadFacts = {
  regular: number;
  substitutions: number;
  totalAfter: number;
  dayLength: number;
  freeAfter: number;
  consecutiveBefore: number;
  consecutiveAfter: number;
};

export type Candidate = {
  teacher: string;
  score: number;
  matchTier: MatchTier;
  autoEligible: boolean;
  reserve: boolean;
  lastResort: boolean;
  blocked: BlockReason[];
  warnings: CoverWarning[];
  load: LoadFacts;
  grade: number | null;
  exactGrade: boolean;
  sameBand: boolean;
  classPeriods: number;
  recentCovers: number;
  reasonKey: string;
};

export type AbsenceIndex = Record<string, number[]>;

/** Every shape the original accepted, because saved plans are full of them. */
export type AbsenceInput =
  | string[]
  | { teacher?: string; name?: string; periods?: number[] | true | null }[]
  | Record<string, number[] | true | null | { periods?: number[] }>
  | null
  | undefined;

export type EngineInput = {
  day: string;
  periodCount?: number;
  teacherProfiles: TeacherProfiles;
  absentTeachers?: AbsenceInput;
  absenceIndex?: AbsenceIndex;
  assignments?: AssignmentLike[];
  coverHistory?: Record<string, number>;
  policy?: { maxConsecutive?: number };
};

export type RankInput = EngineInput & { vacancy: Vacancy };

export type GeneratedAssignment = {
  slotId: string;
  periodIndex: number;
  className: string;
  subject: string;
  originalTeacher?: string;
  teacher: string;
  matchTier: MatchTier;
  warnings: CoverWarning[];
  load: LoadFacts;
  classPeriods: number;
  recentCovers: number;
  reasonKey: string;
  source: "auto" | "suggestion";
};

export type PlanResult = {
  assignments: (AssignmentLike | GeneratedAssignment)[];
  reviewSuggestions: GeneratedAssignment[];
  openSlots: PlacedVacancy[];
  diagnostics: {
    vacancies: number;
    autoAssigned: number;
    reviewRequired: number;
    open: number;
    flow: number;
    objectiveCost: number;
  };
};

/* ------------------------------------------------------------ utilities */

function toArray<T>(value: Iterable<T> | T | null | undefined): T[] {
  if (!value) return [];
  if (value instanceof Set) return Array.from(value);
  return Array.isArray(value) ? value : [value as T];
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

export function tierRank(tier: string): number {
  const at = (TIER_ORDER as readonly string[]).indexOf(tier);
  return at === -1 ? TIER_ORDER.length : at;
}

/** True when `better` outranks `worse` on tier alone, whatever the load. */
export function tierDominates(better: MatchTier, worse: MatchTier): boolean {
  return (
    tierRank(better) < tierRank(worse) &&
    TIER_SCORE[better] - TIER_SCORE[worse] > 2 * MODIFIER_CAP
  );
}

export function canonicalSubject(value: unknown): string {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return SUBJECT_ALIASES[normalized] ?? normalized;
}

export function extractGrade(className: unknown): number | null {
  const match = String(className ?? "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function gradeBand(grade: number | null): string {
  if (!grade) return "";
  if (grade <= 5) return "primary";
  if (grade <= 8) return "middle";
  if (grade <= 10) return "secondary";
  return "senior";
}

export function subjectGroup(subject: string): string {
  const canonical = canonicalSubject(subject);
  return (
    Object.keys(SUBJECT_GROUPS).find((group) =>
      SUBJECT_GROUPS[group].includes(canonical),
    ) ?? ""
  );
}

/* --------------------------------------------------------------- shifts */

export type Shift = {
  fromPeriodIndex?: number;
  toPeriodIndex?: number;
  allowedPeriodIndexes?: number[];
  note?: string;
};

/**
 * The period indexes a teacher is actually in school for.
 *
 * A shift may be an explicit list or a from/to range; no entry at all means
 * the whole day.
 */
export function shiftPeriods(
  shift: Shift | null | undefined,
  periodCount?: number,
): number[] {
  const count = periodCount || DEFAULT_PERIOD_COUNT;
  const all = Array.from({ length: count }, (_, index) => index);
  if (!shift) return all;
  if (Array.isArray(shift.allowedPeriodIndexes)) {
    return all.filter((index) => shift.allowedPeriodIndexes!.indexOf(index) !== -1);
  }
  const from = Number.isFinite(shift.fromPeriodIndex) ? shift.fromPeriodIndex! : 0;
  const to = Number.isFinite(shift.toPeriodIndex) ? shift.toPeriodIndex! : count - 1;
  return all.filter((index) => index >= from && index <= to);
}

export function isFullDayShift(
  shift: Shift | null | undefined,
  periodCount?: number,
): boolean {
  return (
    shiftPeriods(shift, periodCount).length === (periodCount || DEFAULT_PERIOD_COUNT)
  );
}

/** Is this teacher in the building for this period? */
export function isOnShift(
  shifts: Record<string, Shift> | null | undefined,
  teacher: string,
  periodIndex: number,
  periodCount?: number,
): boolean {
  const shift = shifts?.[teacher];
  if (!shift) return true;
  return shiftPeriods(shift, periodCount).indexOf(Number(periodIndex)) !== -1;
}

/** One canonical storage shape, whatever the caller wrote. */
export function normalizeShifts(
  shifts: Record<string, Shift> | null | undefined,
  periodCount?: number,
): Record<string, { allowedPeriodIndexes: number[]; note: string }> {
  const normalized: Record<string, { allowedPeriodIndexes: number[]; note: string }> =
    {};

  for (const teacher of Object.keys(shifts ?? {})) {
    const shift = shifts?.[teacher] ?? {};
    normalized[teacher] = {
      allowedPeriodIndexes: shiftPeriods(shift, periodCount),
      note: shift.note ?? "",
    };
  }

  return normalized;
}

/**
 * Shifts expressed as the `policyOverrides` shape `buildTeacherProfiles`
 * already understands, so `isAvailableByPolicy` does the enforcing.
 *
 * Full-day teachers are omitted — an override with no restriction is noise.
 */
export function shiftsToPolicyOverrides(
  shifts: Record<string, Shift> | null | undefined,
  periodCount?: number,
): Record<string, PolicyOverride> {
  const overrides: Record<string, PolicyOverride> = {};

  for (const teacher of Object.keys(shifts ?? {})) {
    const shift = shifts?.[teacher];
    if (isFullDayShift(shift, periodCount)) continue;
    overrides[teacher] = {
      availability: { allowedPeriodIndexes: shiftPeriods(shift, periodCount) },
    };
  }

  return overrides;
}

/* ------------------------------------------------------------- absences */

/**
 * An absence is one day — but not always the whole of one.
 *
 * Teachers leave after the fourth period for a hospital appointment, or arrive
 * at the fifth from one. Modelled as a whole day, those hours read as absent
 * while the teacher is standing in the staff room: the planner invents
 * vacancies nobody needs and refuses the cover this teacher could actually
 * give. Modelled as "not absent at all", the periods they really are away go
 * uncovered.
 *
 * So an absence carries the periods it applies to, and a whole day is simply
 * every period — which is why a bare list of names still means exactly what it
 * always did.
 */
export function normalizeAbsences(
  absences: AbsenceInput,
  periodCount?: number,
): AbsenceIndex {
  const count = periodCount || DEFAULT_PERIOD_COUNT;
  const wholeDay = Array.from({ length: count }, (_, index) => index);
  const normalized: AbsenceIndex = {};

  const add = (teacher: unknown, periods: number[] | true | null | undefined) => {
    const name = String(teacher ?? "").trim();
    if (!name) return;

    // `true`, `null` and a missing list all mean the whole day: every caller
    // that knows nothing about half days keeps working.
    const list =
      periods === true || periods == null
        ? wholeDay
        : toArray(periods)
            .map(Number)
            .filter((value) => Number.isInteger(value) && value >= 0 && value < count);

    const merged = new Set((normalized[name] ?? []).concat(list));
    normalized[name] = Array.from(merged).sort((a, b) => a - b);
  };

  if (Array.isArray(absences)) {
    for (const entry of absences) {
      if (typeof entry === "string") add(entry, wholeDay);
      else if (entry) add(entry.teacher ?? entry.name, entry.periods);
    }
  } else if (absences && typeof absences === "object") {
    for (const teacher of Object.keys(absences)) {
      const value = (absences as Record<string, unknown>)[teacher];
      const periods =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as { periods?: number[] }).periods
          : (value as number[] | true | null);
      add(teacher, periods);
    }
  }

  // An entry with no periods is not an absence. Dropped here so no caller has
  // to decide what an empty one would have meant.
  for (const teacher of Object.keys(normalized)) {
    if (!normalized[teacher].length) delete normalized[teacher];
  }

  return normalized;
}

/** Is this teacher away for this particular period? */
export function isAbsentAt(
  index: AbsenceIndex | null | undefined,
  teacher: string,
  periodIndex: number,
): boolean {
  const periods = index?.[teacher];
  return Boolean(periods) && periods!.indexOf(Number(periodIndex)) !== -1;
}

/** The names with an absence today, whole day or part of one. */
export function absentNames(index: AbsenceIndex | null | undefined): string[] {
  return Object.keys(index ?? {});
}

/* --------------------------------------------------- combining classes */

export function canCombine(
  classA: string | null | undefined,
  classB: string | null | undefined,
): boolean {
  if (!classA || !classB || classA === classB) return false;
  const a = extractGrade(classA);
  const b = extractGrade(classB);
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= MAX_GRADE_GAP;
}

export type MergeHost = {
  className: string;
  teacher: string | null;
  substituted?: boolean;
};

/**
 * Pick the class a stranded period should join.
 *
 * `hosts` is every class still being taught this period. Same grade first,
 * then a class with its own teacher over one already being covered — handing a
 * substitute a second room is how a plan starts falling over.
 */
export function chooseMergeHost(
  className: string,
  hosts: (MergeHost | null | undefined)[] | null | undefined,
): MergeHost | null {
  const grade = extractGrade(className);

  return (
    (hosts ?? [])
      .filter((host): host is MergeHost =>
        Boolean(host && host.teacher && canCombine(className, host.className)),
      )
      .slice()
      .sort((a, b) => {
        const sameA = extractGrade(a.className) === grade ? 0 : 1;
        const sameB = extractGrade(b.className) === grade ? 0 : 1;
        if (sameA !== sameB) return sameA - sameB;
        const subA = a.substituted ? 1 : 0;
        const subB = b.substituted ? 1 : 0;
        if (subA !== subB) return subA - subB;
        return String(a.className).localeCompare(String(b.className));
      })[0] ?? null
  );
}

/* -------------------------------------------------------------- profiles */

export function buildTeacherProfiles(input: {
  teacherDetails?: Record<string, TeacherDetail>;
  roster?: string[];
  policyOverrides?: Record<string, PolicyOverride>;
  reserveStaff?: string[];
  dutyStaff?: string[];
}): TeacherProfiles {
  const teacherDetails = input?.teacherDetails ?? {};
  const roster = input?.roster ?? Object.keys(teacherDetails);
  const overrides = input?.policyOverrides ?? {};
  const reserve = new Set(toArray(input?.reserveStaff));
  const dutyHolders = new Set(toArray(input?.dutyStaff));
  const profiles: TeacherProfiles = {};

  for (const teacher of roster.slice().sort((a, b) => a.localeCompare(b))) {
    const data = teacherDetails[teacher] ?? {};
    const override = overrides[teacher] ?? {};
    const subjects = new Set(
      toArray(data.subjects as Iterable<string>).map(canonicalSubject).filter(Boolean),
    );
    const grades = new Set<number>();

    // Which classes this teacher actually stands in front of, and how often.
    // Keeping only the grade number made "teaches Class 5" and "teaches some
    // other Class 5 stream" the same thing to the scorer, and "teaches this
    // class" unknowable.
    const classLoad: Record<string, number> = {};
    const classSubjects: Record<string, Set<string>> = {};

    for (const daySchedule of Object.values(data.schedule ?? {})) {
      for (const period of daySchedule ?? []) {
        if (!period) continue;
        if (period.subject) subjects.add(canonicalSubject(period.subject));
        const grade = extractGrade(period.className);
        if (grade) grades.add(grade);
        if (period.className) {
          classLoad[period.className] = (classLoad[period.className] ?? 0) + 1;
          if (!classSubjects[period.className]) {
            classSubjects[period.className] = new Set();
          }
          if (period.subject) {
            classSubjects[period.className].add(canonicalSubject(period.subject));
          }
        }
      }
    }

    for (const subject of toArray(override.canTeach)) {
      subjects.add(canonicalSubject(subject));
    }

    profiles[teacher] = {
      teacher,
      // Can be asked by a coordinator; never proposed by the planner.
      reserve: reserve.has(teacher),
      // Proposed by the planner, but only after everyone else. Reserve wins
      // the flag if somebody is somehow on both lists: "never automatic" is
      // the stricter promise of the two.
      lastResort: !reserve.has(teacher) && dutyHolders.has(teacher),
      subjects,
      canCover: new Set(toArray(override.canCover).map(canonicalSubject).filter(Boolean)),
      grades,
      classLoad,
      classSubjects,
      gradeBands: new Set(
        [
          ...Array.from(grades).map(gradeBand),
          ...toArray(override.gradeBands),
        ].filter(Boolean),
      ),
      schedule: data.schedule ?? {},
      availability: override.availability ?? null,
      maxAutoSubstitutions: Number.isFinite(override.maxAutoSubstitutions)
        ? override.maxAutoSubstitutions!
        : DEFAULT_MAX_AUTO_SUBSTITUTIONS,
    };
  }

  return profiles;
}

function isAvailableByPolicy(
  profile: TeacherProfile | undefined,
  periodIndex: number,
): boolean {
  const availability = profile?.availability;
  if (!availability) return true;
  if (Array.isArray(availability.allowedPeriodIndexes)) {
    return availability.allowedPeriodIndexes.includes(periodIndex);
  }
  if (Array.isArray(availability.blockedPeriodIndexes)) {
    return !availability.blockedPeriodIndexes.includes(periodIndex);
  }
  return true;
}

function normalizeAssignmentList(
  assignments: AssignmentLike[] | Record<string, AssignmentLike> | null | undefined,
): AssignmentLike[] {
  if (!assignments) return [];
  if (Array.isArray(assignments)) return assignments.filter(Boolean);
  return Object.keys(assignments)
    .map((slotId) => ({ slotId, ...assignments[slotId] }))
    .filter(Boolean);
}

function countTeacherAssignments(
  teacher: string,
  assignments: AssignmentLike[] | null | undefined,
): number {
  return normalizeAssignmentList(assignments).filter((item) => item.teacher === teacher)
    .length;
}

function isTeacherAssignedInPeriod(
  teacher: string,
  periodIndex: number,
  assignments: AssignmentLike[] | null | undefined,
  excludedSlotId: string | undefined,
): boolean {
  return normalizeAssignmentList(assignments).some(
    (item) =>
      item.teacher === teacher &&
      Number(item.periodIndex) === Number(periodIndex) &&
      item.slotId !== excludedSlotId,
  );
}

function getRegularBusyPeriods(
  profile: TeacherProfile | undefined,
  day: string,
  periodCount: number,
): boolean[] {
  const schedule = profile?.schedule?.[day] ?? [];
  return Array.from({ length: periodCount }, (_, index) => Boolean(schedule[index]));
}

function longestConsecutiveRun(flags: boolean[]): number {
  let longest = 0;
  let current = 0;
  for (const flag of flags) {
    current = flag ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

/**
 * How loaded a teacher is, measured over the day they are actually here for.
 *
 * `dayLength` is not always the eight periods on the bell schedule. A
 * part-time teacher is on site for four of them; a teacher who goes home after
 * the break is here for four more. Measured against eight, both look as though
 * they have hours of preparation time going spare, and the app would say
 * "would have no free period" about periods they are not in the building for —
 * a sentence a coordinator can see is false, on the screen where they are
 * deciding whether to believe the rest of it.
 *
 * So the periods a teacher is away or off shift for are not busy and not free:
 * they are not part of today at all. They also break a consecutive run,
 * because leaving the building is the longest break there is.
 */
function getLoadFacts(
  profile: TeacherProfile,
  day: string,
  periodIndex: number,
  assignments: AssignmentLike[] | null | undefined,
  periodCount: number,
  slotId: string | undefined,
  awayPeriods: number[] | undefined,
): LoadFacts {
  const away = awayPeriods ?? [];
  const here = Array.from(
    { length: periodCount },
    (_, index) => isAvailableByPolicy(profile, index) && away.indexOf(index) === -1,
  );
  const dayLength = here.filter(Boolean).length;
  const regular = getRegularBusyPeriods(profile, day, periodCount).map(
    (busy, index) => busy && here[index],
  );
  const planned = Array<boolean>(periodCount).fill(false);

  for (const item of normalizeAssignmentList(assignments)) {
    if (
      item.teacher === profile.teacher &&
      item.slotId !== slotId &&
      Number.isFinite(Number(item.periodIndex))
    ) {
      planned[Number(item.periodIndex)] = true;
    }
  }

  const substitutions = planned.filter(Boolean).length;
  const before = regular.map((busy, index) => busy || planned[index]);
  const after = before.slice();
  after[periodIndex] = true;
  const totalAfter = after.filter(Boolean).length;

  return {
    regular: regular.filter(Boolean).length,
    substitutions,
    totalAfter,
    dayLength,
    // Free periods left once this cover is taken. Preparation and marking time
    // is real: taking the last one is not the same as taking one of four.
    freeAfter: Math.max(0, dayLength - totalAfter),
    consecutiveBefore: longestConsecutiveRun(before),
    consecutiveAfter: longestConsecutiveRun(after),
  };
}

/* ------------------------------------------------------------- scoring */

export function candidateForTeacher(
  input: RankInput & { teacher?: string },
  teacher: string,
): Candidate | null {
  const profile = input.teacherProfiles?.[teacher];
  const vacancy = input.vacancy ?? ({} as Vacancy);
  const periodIndex = Number(vacancy.periodIndex);
  const periodCount = input.periodCount || DEFAULT_PERIOD_COUNT;
  const assignments = input.assignments ?? [];
  // Built once per ranking pass where there is one; `validateAssignment` calls
  // in alone, so it still normalises for itself.
  const absences =
    input.absenceIndex ?? normalizeAbsences(input.absentTeachers, periodCount);
  const blocked: BlockReason[] = [];
  const warnings: CoverWarning[] = [];

  if (!profile) return null;

  // Absent *now*, not absent today: a teacher who goes home after the fourth
  // period is an ordinary candidate for the first four.
  if (isAbsentAt(absences, teacher, periodIndex)) blocked.push("absent");
  if (profile.schedule?.[input.day]?.[periodIndex]) blocked.push("regular_class");
  if (isTeacherAssignedInPeriod(teacher, periodIndex, assignments, vacancy.slotId)) {
    blocked.push("double_booked");
  }
  if (!isAvailableByPolicy(profile, periodIndex)) blocked.push("unavailable");

  const targetSubject = canonicalSubject(vacancy.subject);
  const className = vacancy.className;
  const classPeriods = (className && profile.classLoad?.[className]) || 0;
  const teachesThisClass = classPeriods > 0;
  const teachesSubjectHere = Boolean(
    className && profile.classSubjects?.[className]?.has(targetSubject),
  );
  const teachesSubject = profile.subjects.has(targetSubject);

  // Familiarity with the class leads; subject qualification decides the order
  // among strangers to it. Reserve staff sit below all of it, and duty-holders
  // just above them.
  //
  // Neither climbs. A duty-holder who teaches the very class and subject would
  // otherwise rank top and be picked first, which is the opposite of what the
  // chart asks for — the star is about protecting their coordinator time, not
  // about what they are qualified to teach.
  let matchTier: MatchTier = profile.reserve
    ? "reserve"
    : profile.lastResort
      ? "last_resort"
      : "general";

  if (profile.reserve || profile.lastResort) {
    // No tier climbing: their duties, not their subjects, set the rank.
  } else if (teachesThisClass && (teachesSubjectHere || teachesSubject)) {
    matchTier = "class_subject";
  } else if (teachesThisClass) {
    matchTier = "class";
  } else if (teachesSubject) {
    matchTier = "exact";
  } else if (profile.canCover.has(targetSubject)) {
    matchTier = "approved";
  } else if (
    subjectGroup(targetSubject) &&
    Array.from(profile.subjects).some(
      (subject) => subjectGroup(subject) === subjectGroup(targetSubject),
    )
  ) {
    matchTier = "related";
  }

  if (matchTier === "reserve") warnings.push("reserve_staff");
  if (matchTier === "last_resort") warnings.push("duty_holder");
  if (matchTier === "class") warnings.push("class_not_subject");
  if (matchTier === "related") warnings.push("related_subject");
  if (matchTier === "general") warnings.push("subject_mismatch");

  const load = getLoadFacts(
    profile,
    input.day,
    periodIndex,
    assignments,
    periodCount,
    vacancy.slotId,
    absences[teacher],
  );

  if (load.substitutions >= profile.maxAutoSubstitutions) {
    warnings.push("over_substitution_limit");
  }
  // Against the day they are here for, not the one on the bell schedule.
  if (load.totalAfter >= load.dayLength) warnings.push("full_day");

  const maxConsecutive = input.policy?.maxConsecutive || DEFAULT_MAX_CONSECUTIVE;
  if (load.consecutiveAfter > Math.max(maxConsecutive, load.consecutiveBefore)) {
    warnings.push("excessive_consecutive");
  }

  const grade = extractGrade(vacancy.className);
  const exactGrade = grade != null && profile.grades.has(grade);
  const sameBand = grade != null && profile.gradeBands.has(gradeBand(grade));
  const recentCovers = Number(input.coverHistory?.[teacher]) || 0;

  // Everything that is not the tier. Clamped, so it can only reorder
  // candidates inside a tier — see the note on TIER_SCORE.
  let modifiers = 0;
  modifiers += Math.min(classPeriods * WEIGHTS.classPeriod, WEIGHTS.classPeriodMax);
  if (exactGrade) modifiers += WEIGHTS.sameGrade;
  else if (sameBand) modifiers += WEIGHTS.sameBand;
  modifiers += Math.max(0, (load.dayLength - load.regular) * WEIGHTS.lightDay);
  modifiers -= load.consecutiveAfter * WEIGHTS.consecutiveEach;
  modifiers -= Math.max(0, load.consecutiveAfter - maxConsecutive) * WEIGHTS.consecutiveOver;
  if (load.freeAfter === 0) modifiers -= WEIGHTS.lastFreePeriod;
  else if (load.freeAfter === 1) modifiers -= WEIGHTS.nearlyFullDay;
  modifiers -= load.substitutions * WEIGHTS.repeatToday;
  modifiers -= Math.min(recentCovers * WEIGHTS.historyEach, WEIGHTS.historyMax);

  const score = TIER_SCORE[matchTier] + clamp(modifiers, MODIFIER_CAP);

  const autoEligible =
    blocked.length === 0 &&
    !profile.reserve &&
    // Stated here as well as by tier, so the promise survives anyone later
    // adding `last_resort` to AUTO_TIERS by mistake.
    !profile.lastResort &&
    AUTO_TIERS.indexOf(matchTier) !== -1 &&
    !warnings.includes("over_substitution_limit") &&
    !warnings.includes("full_day") &&
    !warnings.includes("excessive_consecutive");

  return {
    teacher,
    score,
    matchTier,
    autoEligible,
    reserve: Boolean(profile.reserve),
    lastResort: Boolean(profile.lastResort),
    blocked,
    warnings,
    load,
    grade,
    exactGrade,
    sameBand,
    classPeriods,
    recentCovers,
    reasonKey: `sub.${matchTier}`,
  };
}

export function rankCandidates(input: RankInput): Candidate[] {
  const scoped: RankInput = input.absenceIndex
    ? input
    : {
        ...input,
        absenceIndex: normalizeAbsences(
          input.absentTeachers,
          input.periodCount || DEFAULT_PERIOD_COUNT,
        ),
      };

  return Object.keys(scoped.teacherProfiles ?? {})
    .map((teacher) => candidateForTeacher(scoped, teacher))
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((a, b) => {
      if (a.blocked.length !== b.blocked.length) return a.blocked.length - b.blocked.length;
      if (a.autoEligible !== b.autoEligible) return a.autoEligible ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.teacher.localeCompare(b.teacher);
    });
}

/* ------------------------------------------------------- min-cost flow */

type Edge = {
  to: number;
  rev: number;
  capacity: number;
  cost: number;
  metadata: { vacancy: PlacedVacancy; candidate: Candidate } | null;
  initialCapacity: number;
};

function addEdge(
  graph: Edge[][],
  from: number,
  to: number,
  capacity: number,
  cost: number,
  metadata: { vacancy: PlacedVacancy; candidate: Candidate } | null = null,
): Edge {
  const forward: Edge = {
    to,
    rev: graph[to].length,
    capacity,
    cost,
    metadata,
    initialCapacity: capacity,
  };
  const reverse: Edge = {
    to: from,
    rev: graph[from].length,
    capacity: 0,
    cost: -cost,
    metadata: null,
    initialCapacity: 0,
  };
  graph[from].push(forward);
  graph[to].push(reverse);
  return forward;
}

function minCostMaximumFlow(
  graph: Edge[][],
  source: number,
  sink: number,
): { flow: number; cost: number } {
  let flow = 0;
  let cost = 0;

  for (;;) {
    const distance = Array<number>(graph.length).fill(Infinity);
    const previousNode = Array<number>(graph.length).fill(-1);
    const previousEdge = Array<number>(graph.length).fill(-1);
    const inQueue = Array<boolean>(graph.length).fill(false);
    const queue = [source];
    distance[source] = 0;
    inQueue[source] = true;

    while (queue.length) {
      const node = queue.shift()!;
      inQueue[node] = false;
      graph[node].forEach((edge, edgeIndex) => {
        if (edge.capacity <= 0) return;
        const nextDistance = distance[node] + edge.cost;
        if (nextDistance >= distance[edge.to]) return;
        distance[edge.to] = nextDistance;
        previousNode[edge.to] = node;
        previousEdge[edge.to] = edgeIndex;
        if (!inQueue[edge.to]) {
          queue.push(edge.to);
          inQueue[edge.to] = true;
        }
      });
    }

    if (!Number.isFinite(distance[sink])) break;

    let node = sink;
    while (node !== source) {
      const parent = previousNode[node];
      const edge = graph[parent][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.rev].capacity += 1;
      node = parent;
    }

    flow += 1;
    cost += distance[sink];
  }

  return { flow, cost };
}

/**
 * How many covers the allocator may hand one teacher without a coordinator
 * confirming.
 *
 * `full_day` already refuses a single cover that would take a teacher's last
 * free period — but it is scored per candidate, against a plan that does not
 * yet include the flow's other choices. The flow decides several at once, so
 * on a day with two people away it could give somebody two automatic covers
 * and fill their day between them, each one having looked fine on its own.
 * That is the exact outcome the gate exists to prevent, so the flow has to
 * state it too: leave one free period, and let a coordinator be the one to
 * take it.
 *
 * Pinned periods are excluded from the free count rather than capped, because
 * a pin is already a decision somebody made on purpose.
 */
function autoCoverAllowance(
  profile: TeacherProfile,
  day: string,
  existingAssignments: AssignmentLike[],
  periodCount: number,
  awayPeriods: number[] | undefined,
): number {
  const away = awayPeriods ?? [];
  const schedule = profile?.schedule?.[day] ?? [];
  const pinned = normalizeAssignmentList(existingAssignments)
    .filter((item) => item.teacher === profile.teacher)
    .map((item) => Number(item.periodIndex));

  let free = 0;
  for (let index = 0; index < periodCount; index += 1) {
    if (!isAvailableByPolicy(profile, index)) continue;
    if (away.indexOf(index) !== -1) continue;
    if (schedule[index] || pinned.indexOf(index) !== -1) continue;
    free += 1;
  }

  return Math.max(0, free - 1);
}

export function generatePlan(
  input: EngineInput & {
    vacancies?: Vacancy[];
    existingAssignments?: AssignmentLike[];
  },
): PlanResult {
  const periodCount = input.periodCount || DEFAULT_PERIOD_COUNT;
  // One index for the whole allocation: the flow and the suggestion pass must
  // agree about who is in the building in which period.
  const absenceIndex =
    input.absenceIndex ?? normalizeAbsences(input.absentTeachers, periodCount);

  const vacancies: PlacedVacancy[] = (input.vacancies ?? []).map((vacancy, index) => ({
    ...vacancy,
    slotId:
      vacancy.slotId || `${input.day}|${vacancy.className}|${vacancy.periodIndex}|${index}`,
  }));

  const existingAssignments = normalizeAssignmentList(
    input.existingAssignments ?? input.assignments,
  );
  const teacherProfiles = input.teacherProfiles ?? {};
  const teachers = Object.keys(teacherProfiles).sort((a, b) => a.localeCompare(b));
  const candidateMatrix: Record<string, Candidate[]> = {};

  for (const vacancy of vacancies) {
    candidateMatrix[vacancy.slotId] = rankCandidates({
      ...input,
      absenceIndex,
      vacancy,
      assignments: existingAssignments,
      teacherProfiles,
    });
  }

  const source = 0;
  let nextNode = 1;
  const teacherNodes: Record<string, number> = {};
  const teacherPeriodNodes: Record<string, Record<number, number>> = {};

  for (const teacher of teachers) {
    teacherNodes[teacher] = nextNode++;
    teacherPeriodNodes[teacher] = {};
    for (let period = 0; period < periodCount; period += 1) {
      teacherPeriodNodes[teacher][period] = nextNode++;
    }
  }

  const vacancyNodes: Record<string, number> = {};
  for (const vacancy of vacancies) vacancyNodes[vacancy.slotId] = nextNode++;

  const sink = nextNode++;
  const graph: Edge[][] = Array.from({ length: nextNode }, () => []);
  const assignmentEdges: Edge[] = [];

  for (const teacher of teachers) {
    const profile = teacherProfiles[teacher];
    const used = countTeacherAssignments(teacher, existingAssignments);
    const capacity = Math.max(
      0,
      Math.min(
        profile.maxAutoSubstitutions - used,
        autoCoverAllowance(
          profile,
          input.day,
          existingAssignments,
          periodCount,
          absenceIndex[teacher],
        ),
      ),
    );

    // One unit-capacity edge per cover, each dearer than the last, so a
    // teacher's second period genuinely costs the optimiser more than their
    // first. A single edge of capacity 2 priced them the same, which is why
    // the load used to pile onto whoever scored highest. The step sits below
    // TIER_GAP: spreading reorders within a tier, it never overrides class
    // familiarity. Max flow is still maximised first, so this never covers
    // fewer periods.
    for (let unit = 0; unit < capacity; unit += 1) {
      addEdge(graph, source, teacherNodes[teacher], 1, (used + unit) * WEIGHTS.spreadStep);
    }

    for (let period = 0; period < periodCount; period += 1) {
      addEdge(graph, teacherNodes[teacher], teacherPeriodNodes[teacher][period], 1, 0);
    }
  }

  for (const vacancy of vacancies) {
    addEdge(graph, vacancyNodes[vacancy.slotId], sink, 1, 0);
    for (const candidate of candidateMatrix[vacancy.slotId].filter(
      (entry) => entry.autoEligible,
    )) {
      assignmentEdges.push(
        addEdge(
          graph,
          teacherPeriodNodes[candidate.teacher][vacancy.periodIndex],
          vacancyNodes[vacancy.slotId],
          1,
          -candidate.score,
          { vacancy, candidate },
        ),
      );
    }
  }

  const flowResult = minCostMaximumFlow(graph, source, sink);

  const generated: GeneratedAssignment[] = assignmentEdges
    .filter((edge) => edge.initialCapacity === 1 && edge.capacity === 0)
    .map((edge) => ({
      slotId: edge.metadata!.vacancy.slotId,
      periodIndex: edge.metadata!.vacancy.periodIndex,
      className: edge.metadata!.vacancy.className,
      subject: edge.metadata!.vacancy.subject,
      originalTeacher: edge.metadata!.vacancy.originalTeacher,
      teacher: edge.metadata!.candidate.teacher,
      matchTier: edge.metadata!.candidate.matchTier,
      warnings: edge.metadata!.candidate.warnings,
      load: edge.metadata!.candidate.load,
      classPeriods: edge.metadata!.candidate.classPeriods,
      recentCovers: edge.metadata!.candidate.recentCovers,
      reasonKey: edge.metadata!.candidate.reasonKey,
      source: "auto" as const,
    }))
    .sort(
      (a, b) => a.periodIndex - b.periodIndex || a.className.localeCompare(b.className),
    );

  const assignedSlotIds = new Set(generated.map((item) => item.slotId));
  const reviewSuggestions: GeneratedAssignment[] = [];
  const openSlots: PlacedVacancy[] = [];

  /*
   * Suggestions are made one at a time, each re-ranked against everything
   * already proposed. Reading them all off the matrix built before the flow
   * ran meant two vacancies in the same period could be offered the same
   * teacher — a double booking — and that one willing teacher collected every
   * leftover period, because the repetition penalty never saw the suggestions
   * being made alongside it.
   */
  const proposed: AssignmentLike[] = [...existingAssignments, ...generated];

  for (const vacancy of vacancies.filter((entry) => !assignedSlotIds.has(entry.slotId))) {
    const candidates = rankCandidates({
      ...input,
      absenceIndex,
      vacancy,
      assignments: proposed,
      teacherProfiles,
    })
      // Reserve staff have no timetable, so they read as free in every period
      // and would be suggested the moment every regular teacher is blocked.
      // "Never automatic" has to mean the suggestion path as well, or they
      // would quietly fill the hardest periods — exactly the ones a
      // coordinator wants to decide themselves.
      .filter((candidate) => candidate.blocked.length === 0 && !candidate.reserve);

    /*
     * Nobody takes a third period while somebody else can take a first. The
     * daily cap has to be a rule rather than a score: the repetition penalty
     * is clamped (so tier order stays guaranteed), which means past a few
     * covers it stops growing and a well-connected teacher would keep winning
     * every leftover period. Only when everyone under the cap is unavailable
     * do we go over.
     */
    const underCap = candidates.filter(
      (candidate) => !candidate.warnings.includes("over_substitution_limit"),
    );
    const suggestion = (underCap.length ? underCap : candidates)[0] ?? null;

    if (suggestion) {
      proposed.push({
        slotId: vacancy.slotId,
        teacher: suggestion.teacher,
        periodIndex: vacancy.periodIndex,
      });
      reviewSuggestions.push({
        ...vacancy,
        teacher: suggestion.teacher,
        matchTier: suggestion.matchTier,
        warnings: suggestion.warnings,
        load: suggestion.load,
        classPeriods: suggestion.classPeriods,
        recentCovers: suggestion.recentCovers,
        reasonKey: suggestion.reasonKey,
        source: "suggestion" as const,
      });
    } else {
      openSlots.push(vacancy);
    }
  }

  return {
    assignments: [...existingAssignments, ...generated],
    reviewSuggestions,
    openSlots,
    diagnostics: {
      vacancies: vacancies.length,
      autoAssigned: generated.length,
      reviewRequired: reviewSuggestions.length,
      open: openSlots.length,
      flow: flowResult.flow,
      objectiveCost: flowResult.cost,
    },
  };
}

export function validateAssignment(
  input: RankInput & { teacher: string },
): {
  valid: boolean;
  canOverride: boolean;
  errors: (BlockReason | "unknown_teacher")[];
  warnings: CoverWarning[];
  candidate?: Candidate;
} {
  const candidate = candidateForTeacher(input, input.teacher);

  if (!candidate) {
    return {
      valid: false,
      canOverride: false,
      errors: ["unknown_teacher"],
      warnings: [],
    };
  }

  return {
    valid: candidate.blocked.length === 0 && candidate.warnings.length === 0,
    canOverride: candidate.blocked.length === 0,
    errors: candidate.blocked,
    warnings: candidate.warnings,
    candidate,
  };
}

/**
 * Whether a saved plan still describes the timetable it was planned against.
 *
 * The original threw every stored plan away when the schedule version changed,
 * and the reason holds here: a plan built on last week's timetable names
 * periods that may no longer exist, and a cover sheet for a lesson nobody is
 * teaching is worse than no sheet. Plans are rows now, so this is a comparison
 * rather than a wipe — the planner says the plan is stale and offers to
 * regenerate it, which keeps the coordinator's pins visible while they decide.
 */
export function planIsStale(
  plan: { versionId: string } | null | undefined,
  publishedVersionId: string | null | undefined,
): boolean {
  if (!plan || !publishedVersionId) return false;
  return plan.versionId !== publishedVersionId;
}
