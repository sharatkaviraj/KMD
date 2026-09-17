import { t, type Localized } from "@/platform/i18n/language";
import {
  chooseRecipient,
  describeScope,
  hasPhone,
  noOwnerMessage,
  type Owner,
  type RecipientChoice,
  type Scope,
  type ScopeKind,
} from "@/modules/collection/domain/ownership";

/**
 * Turning one round into N links.
 *
 * A request is one token, one frozen roster, one recipient — that shape is
 * load-bearing and is not changing. This is what turns "ask every class for
 * phone numbers" into nineteen of them and keeps them together afterwards.
 *
 * **Who gets left out is first class.** House is recorded for about a third of
 * a school and bus route for about half, so grouping a house-wise send by
 * house silently drops every child with no house on record — and that is the
 * single worst thing this can do: the office believes it asked about everyone,
 * the missing children are exactly the ones whose records are thinnest, and
 * nobody finds out. So `unassigned` is **returned alongside** the groups,
 * never derived from a discrepancy between two totals, and the preview states
 * it in words before anything is created.
 *
 * Ported from SamPark `830548c` (`src/lib/fanout.ts`). Pure, no database.
 */

/** Only what the plan needs, so this is callable from a test with a literal. */
export type PlannableStudent = {
  studentId: string;
  fullName: string;
  classId: string;
  classLabel: string;
  house: string | null;
  routeId: string | null;
};

export type FanOutGroup = {
  scope: Scope;
  studentIds: string[];
  choice: RecipientChoice;
};

export type BlockedGroup = FanOutGroup & {
  reason: "many-owners" | "no-owner" | "no-phone";
  message: Localized;
};

export type ReadyGroup = FanOutGroup & {
  ownerId: string;
  ownerName: string;
};

export type UnassignedStudent = {
  studentId: string;
  fullName: string;
  classLabel: string;
  reason: "no-house" | "no-route";
};

export type FanOutPlan = {
  ready: ReadyGroup[];
  blocked: BlockedGroup[];
  /** Children in the audience that no group could place. */
  unassigned: UnassignedStudent[];
  totals: {
    /** Links that would be created right now. */
    links: number;
    /** Children those links would cover. */
    students: number;
    /** Children in the audience no link would reach. */
    skipped: number;
  };
};

/**
 * Who the links go to, and therefore how the audience is cut into groups.
 *
 * One value rather than a mode plus a separate "group by": a round is resumed
 * days later from its stored row, and two columns that must agree is a way for
 * them to disagree.
 */
export const recipientModes = [
  "class_teacher",
  "house_incharge",
  "route_incharge",
] as const;

export type RecipientMode = (typeof recipientModes)[number];

const KIND_BY_MODE: Record<RecipientMode, ScopeKind> = {
  class_teacher: "class",
  house_incharge: "house",
  route_incharge: "route",
};

export function isRecipientMode(value: string): value is RecipientMode {
  return (recipientModes as readonly string[]).includes(value);
}

export function scopeKindFor(mode: RecipientMode): ScopeKind {
  return KIND_BY_MODE[mode];
}

/**
 * Cut the audience into groups and find each one's recipient.
 *
 * In `class_teacher` mode a group is a **class**, whatever the audience
 * filtered on — "Chetak house across classes 6 to 8" becomes three links, each
 * to a class teacher, each carrying only her own house children. Nobody is
 * dropped, because every child on the roll has a class.
 *
 * In the in-charge modes a group is the house or the route itself, and a child
 * with neither on record cannot be placed. That is what `unassigned` is for.
 */
export function planFanOut(
  students: readonly PlannableStudent[],
  owners: readonly Owner[],
  mode: RecipientMode,
  labelOf: (kind: ScopeKind, value: string) => string = (_, value) => value,
): FanOutPlan {
  const kind = KIND_BY_MODE[mode];

  const buckets = new Map<string, string[]>();
  const order: string[] = [];
  const unassigned: UnassignedStudent[] = [];

  for (const student of students) {
    const value =
      kind === "class"
        ? student.classId
        : kind === "house"
          ? student.house
          : student.routeId;

    if (!value) {
      unassigned.push({
        studentId: student.studentId,
        fullName: student.fullName,
        classLabel: student.classLabel,
        reason: kind === "house" ? "no-house" : "no-route",
      });
      continue;
    }

    if (!buckets.has(value)) {
      buckets.set(value, []);
      // Insertion order, which for classes is the school order the caller
      // resolved them in (D-130). Sorting labels as text here is what put
      // Class 10 between Class 1 and Class 2 on four screens (B-06).
      order.push(value);
    }

    buckets.get(value)!.push(student.studentId);
  }

  const ready: ReadyGroup[] = [];
  const blocked: BlockedGroup[] = [];

  for (const value of order) {
    const scope: Scope = { kind, value, label: labelOf(kind, value) };
    const studentIds = buckets.get(value) ?? [];
    const choice = chooseRecipient(owners, scope);
    const group: FanOutGroup = { scope, studentIds, choice };

    if (choice.kind === "many") {
      blocked.push({ ...group, reason: "many-owners", message: choice.message });
      continue;
    }

    if (choice.kind === "none") {
      blocked.push({ ...group, reason: "no-owner", message: choice.message });
      continue;
    }

    const owner = owners.find((row) => row.id === choice.ownerId);

    // `chooseRecipient` picked this id out of the same list, so this cannot
    // happen — and if it ever does, the group is blocked rather than dropped.
    // A group that disappears is the one failure mode this module exists to
    // prevent.
    if (!owner) {
      blocked.push({
        ...group,
        reason: "no-owner",
        message: noOwnerMessage(scope),
      });
      continue;
    }

    // **A link nobody can be sent is a roster frozen for nothing.** Caught
    // here so the preview can offer a box to type a number into, rather than
    // at insert time when the links already exist.
    if (!hasPhone(owner.phone)) {
      blocked.push({
        ...group,
        reason: "no-phone",
        message: t(
          `${owner.displayName} का नंबर दर्ज नहीं है — ${describeScope(scope).hi} के लिए एक नंबर लिखिए।`,
          `No number is saved for ${owner.displayName}. Type one for ${describeScope(scope).en}.`,
        ),
      });
      continue;
    }

    ready.push({ ...group, ownerId: owner.id, ownerName: owner.displayName });
  }

  const covered = ready.reduce((sum, group) => sum + group.studentIds.length, 0);
  const blockedCount = blocked.reduce(
    (sum, group) => sum + group.studentIds.length,
    0,
  );

  return {
    ready,
    blocked,
    unassigned,
    totals: {
      links: ready.length,
      students: covered,
      skipped: blockedCount + unassigned.length,
    },
  };
}

/**
 * The cap, so nobody fans out per-child by accident and mints five hundred
 * tokens.
 *
 * Nineteen classes is the real ceiling today; sixty leaves room for houses and
 * routes together without being close enough to be a trap.
 */
export const MAX_GROUPS = 60;

/** Whether this plan is safe to run as it stands. */
export function isTooBig(plan: FanOutPlan): boolean {
  return plan.ready.length > MAX_GROUPS;
}

/** The scope key the unique index is on, so Resume can tell what exists. */
export function scopeKey(scope: Pick<Scope, "kind" | "label">): string {
  return `${scope.kind}|${scope.label}`;
}

/**
 * The groups a round still needs, given the links it already has.
 *
 * **This is Resume.** A fan-out is deliberately not one transaction: if link
 * seven of eleven fails, the first six are *kept*, because six live tokens
 * with frozen rosters are six classes the office can send to right now.
 * Deleting them to satisfy an all-or-nothing aesthetic destroys real work and
 * buys nothing, because the office would simply do it again.
 */
export function groupsStillNeeded(
  ready: readonly ReadyGroup[],
  existing: readonly { kind: string; label: string }[],
): ReadyGroup[] {
  const have = new Set(existing.map((row) => `${row.kind}|${row.label}`));
  return ready.filter((group) => !have.has(scopeKey(group.scope)));
}
