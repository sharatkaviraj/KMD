/** Persist ids and intent only: names, labels and record contents stay off disk. */
export type InboxScope = { accountId: string; sessionLabel: string; day: string };
export type InboxBeacon = (
  | { kind: "submissions"; submissionIds: string[]; accept: boolean }
  | { kind: "remind"; classIds: string[] }
  | { kind: "cover"; needKey: string; coveringStaffId: string; day: string; dayRevision: number }
) & { commandId: string };
export type PendingInboxDecision = { itemId: string; beacon: InboxBeacon; scope: InboxScope; readyAt: number; attempted: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const prefix = (s: InboxScope) => `vppsone:inbox:v1:${encodeURIComponent(s.accountId)}:${encodeURIComponent(s.sessionLabel)}:${s.day}:`;
const key = (d: PendingInboxDecision) => `${prefix(d.scope)}${d.beacon.commandId}`;
export function isInboxBeacon(value: unknown): value is InboxBeacon {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  if (typeof b.commandId !== "string" || !UUID.test(b.commandId)) return false;
  const ids = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= 1000 && v.every(x => typeof x === "string" && UUID.test(x));
  if (b.kind === "submissions") return ids(b.submissionIds) && typeof b.accept === "boolean";
  if (b.kind === "remind") return ids(b.classIds);
  return b.kind === "cover" && typeof b.needKey === "string" && b.needKey.length > 0 && b.needKey.length <= 512
    && typeof b.coveringStaffId === "string" && UUID.test(b.coveringStaffId) && typeof b.day === "string" && DAY.test(b.day)
    && Number.isInteger(b.dayRevision) && Number(b.dayRevision) >= 0;
}
export function storeInboxDecision(d: PendingInboxDecision): void {
  if (!isInboxBeacon(d.beacon)) throw new Error("Invalid decision");
  const payload = JSON.stringify({ itemId: d.itemId, beacon: d.beacon, scope: d.scope, readyAt: d.readyAt, attempted: d.attempted });
  if (payload.length > 48_000) throw new Error("Decision too large");
  localStorage.setItem(key(d), payload);
}
export function removeInboxDecision(d: PendingInboxDecision): void { localStorage.removeItem(key(d)); }
function readAccountDecisions(scope: InboxScope): PendingInboxDecision[] {
  const pending: PendingInboxDecision[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i); if (!k?.startsWith(`vppsone:inbox:v1:${encodeURIComponent(scope.accountId)}:`)) continue;
    try {
      const raw = localStorage.getItem(k); if (!raw || raw.length > 48_000) continue;
      const d = JSON.parse(raw) as PendingInboxDecision;
      if (d.scope.accountId !== scope.accountId || typeof d.scope.sessionLabel !== "string" || !DAY.test(d.scope.day)
        || typeof d.itemId !== "string" || !Number.isFinite(d.readyAt) || typeof d.attempted !== "boolean" || !isInboxBeacon(d.beacon) || key(d) !== k) continue;
      pending.push(d);
    } catch { /* A corrupt entry must never be sent. */ }
  }
  return pending;
}
export function readInboxDecisions(scope: InboxScope): PendingInboxDecision[] {
  return readAccountDecisions(scope).filter(d => d.scope.sessionLabel === scope.sessionLabel && d.scope.day === scope.day);
}
export function readEarlierInboxDecisions(scope: InboxScope): PendingInboxDecision[] {
  return readAccountDecisions(scope).filter(d => d.scope.sessionLabel !== scope.sessionLabel || d.scope.day !== scope.day);
}
