import { z } from "zod";

/*
 * Linking and unlinking brothers and sisters through Fees (schoolfees
 * docs/one-bridge/family-commands.md, 8 Nov 2026). Fees runs the engine its
 * own student page uses, as the signed-in admin, and decides; these shapes
 * only carry the request and what One draws. Inputs are strict, because Fees
 * refuses any other field, and ids are sorted and de-duplicated the way Fees
 * stores them, so a retry is byte-identical.
 *
 * One's TEST copy answers in the same shapes (students-fees/vx/family-change).
 */

const text = z.string();
const amount = z.number().finite();
const count = z.number().int().nonnegative();
const uuid = z.uuid();
const session = z.string().regex(/^(?:(?:TEST|UAT|DEMO)-)?\d{4}-\d{2}$/);

export const MAX_FAMILY_LINK = 20;
export const MAX_FAMILY_HOUSEHOLD = 100;

/** Distinct, lower-case, sorted. */
export function familyIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))].sort();
}
const idSet = (min: number, max: number) => z.array(uuid).transform(familyIds).pipe(z.array(uuid).min(min).max(max));

/** What a link or unlink would do. A link names the children; an unlink names one child and the family. */
export const familyPreviewRequestSchema = z.discriminatedUnion("operation", [
  z.object({ sessionLabel: session, operation: z.literal("link"), studentIds: idSet(2, MAX_FAMILY_LINK) }).strict(),
  z.object({ sessionLabel: session, operation: z.literal("unlink"), studentId: uuid, familyGroupId: uuid }).strict(),
]);
export type FamilyPreviewRequest = z.input<typeof familyPreviewRequestSchema>;

const previewMoney = z.object({ yearFees: amount, feesPending: amount, lateFeePending: amount });

export const familyPreviewChildSchema = z.object({
  studentId: uuid,
  fullName: text,
  admissionNo: text,
  classLabel: text,
  status: text,
  /** False for a brother or sister enrolled in another year: linked, but counted for nothing this year. */
  inThisYear: z.boolean(),
  hasPhoto: z.boolean(),
  familyGroupId: uuid.nullable(),
  staffChild: z.boolean(),
  thirdChildNow: z.boolean(),
  /** The class's full tuition this year, before any discount. */
  baseTuition: amount.nullable(),
  /**
   * False when another discount this child holds (RTE, Staff Child) already
   * makes tuition no higher than the 3rd Child Policy would, so getting or
   * losing it leaves the fees as they are. Absent when not known (and from a
   * Fees answer that does not send it): the screen then says fees move.
   */
  thirdChildChangesFees: z.boolean().optional(),
  /** Fees only, the late fee apart. Null when no money row was read. */
  money: previewMoney.nullable(),
});
export type FamilyPreviewChild = z.infer<typeof familyPreviewChildSchema>;

export const familyPreviewSchema = z.object({
  sessionLabel: session,
  operation: z.enum(["link", "unlink"]),
  studentIds: z.array(uuid),
  familyGroupId: uuid.nullable(),
  /** The household the change will lock. Sent back unchanged with the change. */
  expectedMemberIds: z.array(uuid).min(1).max(MAX_FAMILY_HOUSEHOLD),
  /** Families that become one by linking (two or more means a merge). */
  familiesNow: count,
  children: z.array(familyPreviewChildSchema),
  after: z.object({ family: z.array(uuid), alone: z.array(uuid) }),
  thirdChild: z.object({
    policyConfigured: z.boolean(),
    eligibleCount: count,
    recipientAfter: uuid.nullable(),
    outrankedByStaffChildStudentId: uuid.nullable(),
    recipientTuition: amount.nullable(),
    gains: z.array(uuid),
    loses: z.array(uuid),
  }),
});
export type FamilyPreview = z.infer<typeof familyPreviewSchema>;

export const familyLinkRequestSchema = z.object({
  commandId: uuid,
  sessionLabel: session,
  studentIds: idSet(2, MAX_FAMILY_LINK),
  expectedMemberIds: idSet(2, MAX_FAMILY_HOUSEHOLD),
}).strict();
export type FamilyLinkRequest = z.input<typeof familyLinkRequestSchema>;

export const familyUnlinkRequestSchema = z.object({
  commandId: uuid,
  sessionLabel: session,
  studentId: uuid,
  familyGroupId: uuid,
  expectedMemberIds: idSet(1, MAX_FAMILY_HOUSEHOLD),
}).strict();
export type FamilyUnlinkRequest = z.input<typeof familyUnlinkRequestSchema>;

export const familyCommandResultSchema = z.object({
  commandId: uuid,
  kind: z.enum(["family_link", "family_unlink"]),
  status: z.literal("completed"),
  sessionLabel: session,
  studentIds: z.array(uuid),
  /** Null when an unlink left fewer than two and the family ended. */
  familyGroupId: uuid.nullable(),
  memberStudentIds: z.array(uuid),
  remainingStudentIds: z.array(uuid),
  createdNewGroup: z.boolean(),
  mergedGroupCount: count,
  changedBy: text.nullable(),
  completedAt: text,
  after: z.object({
    /** False: saved, but the 3rd Child Policy or dues step needs the same command again. */
    settled: z.boolean(),
    thirdChild: z.object({
      policyConfigured: z.boolean(),
      recipientStudentId: uuid.nullable(),
      outrankedByStaffChildStudentId: uuid.nullable(),
      eligibleCount: count,
      withdrawnFrom: z.array(uuid),
    }).nullable(),
    dues: z.object({ prepared: count, needAttention: count }).nullable(),
  }),
});
export type FamilyCommandResult = z.infer<typeof familyCommandResultSchema>;
