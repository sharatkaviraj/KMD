import { z } from "zod";

export const FEES_SOURCE_REF = "vgqyilgstjvgohrsiwkb";
export const FEES_ORIGIN = "https://fees.vpps.co.in";
export const SYNC_PATH = "/api/one/v1/sync";
const uuid = z.string().uuid();
const label = z.string().min(1).max(64);
const nullableText = z.string().nullable().optional();
const revision = z.string().regex(/^[1-9][0-9]{0,17}$/);

export const claimSchema = z.object({
  leaseId: uuid,
  fence: revision,
  expiresAt: z.string().datetime({ offset: true }),
  eventIds: z.array(uuid).max(500),
});

export const snapshotSchema = z.object({
  version: z.literal(1),
  snapshotId: uuid,
  sourceProjectRef: z.literal(FEES_SOURCE_REF),
  revision,
  complete: z.literal(true),
  capturedAt: z.string().datetime({ offset: true }),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  activeSessionLabel: label,
  sessions: z.array(z.object({
    id: uuid, session_label: label, status: nullableText, is_current: z.boolean(),
  }).passthrough()).min(1).max(100),
  classes: z.array(z.object({
    id: uuid, session_label: label, class_name: z.string().min(1),
    section: nullableText, stream_name: nullableText, sort_order: z.number().int().nullable().optional(),
  }).passthrough()).min(1).max(5000),
  students: z.array(z.object({
    id: uuid, class_id: uuid, session_label: label, full_name: z.string().min(1),
    admission_no: nullableText, status: nullableText, roll_no: nullableText,
  }).passthrough()).min(1).max(20000),
  households: z.array(z.object({
    id: z.string().regex(/^(family|student):[0-9a-f-]{36}$/), session_label: label,
  }).passthrough()).max(20000),
  counts: z.object({
    sessions: z.number().int().nonnegative(), classes: z.number().int().nonnegative(),
    students: z.number().int().nonnegative(), households: z.number().int().nonnegative(),
  }).strict(),
});
export type BridgeSnapshot = z.infer<typeof snapshotSchema>;
export type SyncClaim = z.infer<typeof claimSchema>;

export function schoolDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}

/** Checks that a complete generation is safe to publish, not only well-shaped. */
export function validateSnapshot(input: unknown, claim: SyncClaim, now = new Date()): BridgeSnapshot {
  const snapshot = snapshotSchema.parse(input);
  if (snapshot.revision !== claim.fence) throw new Error("bridge_wrong_fence");
  const captured = new Date(snapshot.capturedAt);
  if (captured.getTime() > now.getTime() + 60_000 || captured.getTime() < now.getTime() - 600_000) {
    throw new Error("bridge_stale_snapshot");
  }
  if (snapshot.asOfDate !== schoolDate(captured)) throw new Error("bridge_wrong_calculation_day");
  for (const kind of ["sessions", "classes", "students", "households"] as const) {
    if (snapshot[kind].length !== snapshot.counts[kind]) throw new Error("bridge_incomplete_snapshot");
    const ids = new Set(snapshot[kind].map((row) => kind === "households" ? `${row.id}:${row.session_label}` : row.id));
    if (ids.size !== snapshot[kind].length) throw new Error("bridge_duplicate_identity");
  }
  const sessions = new Set(snapshot.sessions.map((row) => row.session_label));
  if (sessions.size !== snapshot.sessions.length || !sessions.has(snapshot.activeSessionLabel)) {
    throw new Error("bridge_invalid_session");
  }
  const classes = new Map(snapshot.classes.map((row) => [row.id, row.session_label]));
  for (const row of snapshot.classes) {
    if (!sessions.has(row.session_label)) throw new Error("bridge_orphan_class");
  }
  for (const row of snapshot.students) {
    if (classes.get(row.class_id) !== row.session_label) throw new Error("bridge_orphan_student");
  }
  for (const row of snapshot.households) {
    if (!sessions.has(row.session_label)) throw new Error("bridge_orphan_household");
  }
  return snapshot;
}

export function validateSyncOrigin(raw: string | undefined): string {
  if (raw !== FEES_ORIGIN) throw new Error("bridge_invalid_origin");
  return raw;
}

export type ApplyResult = { applied: boolean; replayed: boolean; revision: string; snapshotId: string };

export type SyncDependencies = {
  claim: () => Promise<SyncClaim>;
  snapshot: (claim: SyncClaim) => Promise<unknown>;
  apply: (snapshot: BridgeSnapshot) => Promise<ApplyResult>;
  acknowledge: (claim: SyncClaim) => Promise<void>;
  skipUnchanged?: (claim: SyncClaim) => Promise<boolean>;
  release?: (claim: SyncClaim) => Promise<void>;
  now?: () => Date;
};

/** Source ack is deliberately after target commit. Failures retain source work. */
export async function synchronizeGeneration(deps: SyncDependencies) {
  const claim = claimSchema.parse(await deps.claim());
  const now = deps.now?.() ?? new Date();
  if (new Date(claim.expiresAt).getTime() <= now.getTime()) throw new Error("bridge_expired_lease");
  if (claim.eventIds.length === 0 && deps.skipUnchanged && deps.release && await deps.skipUnchanged(claim)) {
    await deps.release(claim);
    return { unchanged: true as const, revision: claim.fence, acknowledged: 0, replayed: false };
  }
  const snapshot = validateSnapshot(await deps.snapshot(claim), claim, deps.now?.() ?? new Date());
  const result = await deps.apply(snapshot);
  if (result.revision !== claim.fence || result.snapshotId !== snapshot.snapshotId
    || (!result.applied && !result.replayed)) throw new Error("bridge_unconfirmed_apply");
  await deps.acknowledge(claim);
  return { revision: claim.fence, snapshotId: snapshot.snapshotId, capturedAt: snapshot.capturedAt,
    counts: snapshot.counts, acknowledged: claim.eventIds.length, replayed: result.replayed };
}
