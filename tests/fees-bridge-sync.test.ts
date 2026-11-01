import { describe, expect, it, vi } from "vitest";
import { synchronizeGeneration, validateSnapshot, validateSyncOrigin, type BridgeSnapshot, type SyncClaim } from "@/modules/coexistence/domain/snapshot";

const at = new Date("2026-11-01T04:00:00.000Z");
const sessionId = "00000000-0000-4000-8000-000000000001";
const classId = "00000000-0000-4000-8000-000000000002";
const studentId = "00000000-0000-4000-8000-000000000003";
const leaseId = "00000000-0000-4000-8000-000000000004";
const snapshotId = "00000000-0000-4000-8000-000000000005";
const claim: SyncClaim = { leaseId, fence: "7", expiresAt: "2026-11-01T04:03:00.000Z", eventIds: [sessionId, studentId] };
const fixture = (): BridgeSnapshot => ({
  version: 1, snapshotId, sourceProjectRef: "vgqyilgstjvgohrsiwkb", revision: "7", complete: true,
  capturedAt: at.toISOString(), asOfDate: "2026-11-01", activeSessionLabel: "TEST-2026-27",
  sessions: [{ id: sessionId, session_label: "TEST-2026-27", status: "active", is_current: true }],
  classes: [{ id: classId, session_label: "TEST-2026-27", class_name: "Synthetic Class" }],
  students: [{ id: studentId, class_id: classId, session_label: "TEST-2026-27", full_name: "Synthetic Student" }],
  households: [], counts: { sessions: 1, classes: 1, students: 1, households: 0 },
});

describe("complete, fenced roster generation", () => {
  it("validates a consistent complete synthetic generation", () => expect(validateSnapshot(fixture(), claim, at)).toEqual(fixture()));
  it.each(["http://fees.vpps.co.in", "https://fees.vpps.co.in.attacker.invalid", "https://fees.vpps.co.in/", "https://other.invalid", undefined])(
    "refuses unknown destination %s", (url) => expect(() => validateSyncOrigin(url)).toThrow(),
  );
  it("accepts only the canonical exact destination", () => expect(validateSyncOrigin("https://fees.vpps.co.in")).toBe("https://fees.vpps.co.in"));
  it.each([
    ["wrong fence", (s: BridgeSnapshot) => { s.revision = "6"; }],
    ["row truncation", (s: BridgeSnapshot) => { s.counts.students = 2; }],
    ["duplicate student", (s: BridgeSnapshot) => { s.students.push(s.students[0]); s.counts.students = 2; }],
    ["missing class", (s: BridgeSnapshot) => { s.students[0].class_id = sessionId; }],
    ["cross-session reference", (s: BridgeSnapshot) => { s.students[0].session_label = "2026-27"; }],
    ["wrong calculation day", (s: BridgeSnapshot) => { s.asOfDate = "2026-10-31"; }],
    ["stale snapshot", (s: BridgeSnapshot) => { s.capturedAt = "2026-10-31T04:00:00.000Z"; }],
    ["future snapshot", (s: BridgeSnapshot) => { s.capturedAt = "2026-11-02T04:00:00.000Z"; }],
    ["unknown active session", (s: BridgeSnapshot) => { s.activeSessionLabel = "unknown"; }],
    ["empty wipe", (s: BridgeSnapshot) => { s.students = []; s.counts.students = 0; }],
  ] as const)("rejects %s before publishing", (_, mutate) => {
    const snapshot = fixture(); mutate(snapshot); expect(() => validateSnapshot(snapshot, claim, at)).toThrow();
  });
  it("uses IST date when UTC is still the previous day", () => {
    const snapshot = fixture(); snapshot.capturedAt = "2026-10-31T19:00:00.000Z";
    expect(validateSnapshot(snapshot, claim, new Date(snapshot.capturedAt)).asOfDate).toBe("2026-11-01");
  });
});

describe("durable processing order", () => {
  function setup() {
    const events: string[] = [];
    const deps = {
      claim: vi.fn(async () => { events.push("claim"); return claim; }),
      snapshot: vi.fn(async () => { events.push("snapshot"); return fixture(); }),
      apply: vi.fn(async () => { events.push("commit"); return { applied: true, replayed: false, revision: "7", snapshotId }; }),
      acknowledge: vi.fn(async () => { events.push("ack"); }), now: () => at,
    };
    return { deps, events };
  }
  it("commits a coherent target before acknowledging exact claimed IDs, including gaps", async () => {
    const { deps, events } = setup(); const result = await synchronizeGeneration(deps);
    expect(events).toEqual(["claim", "snapshot", "commit", "ack"]);
    expect(deps.acknowledge).toHaveBeenCalledWith(claim); expect(result.acknowledged).toBe(2);
  });
  it("never acknowledges a failed target commit", async () => {
    const { deps } = setup(); deps.apply.mockRejectedValue(new Error("database unavailable"));
    await expect(synchronizeGeneration(deps)).rejects.toThrow(); expect(deps.acknowledge).not.toHaveBeenCalled();
  });
  it("never applies incomplete data", async () => {
    const { deps } = setup(); const snapshot = fixture(); snapshot.counts.students = 20; deps.snapshot.mockResolvedValue(snapshot);
    await expect(synchronizeGeneration(deps)).rejects.toThrow(); expect(deps.apply).not.toHaveBeenCalled();
  });
  it("does not discard an unknown target outcome", async () => {
    const { deps } = setup(); deps.apply.mockResolvedValue({ applied: false, replayed: false, revision: "7", snapshotId });
    await expect(synchronizeGeneration(deps)).rejects.toThrow(); expect(deps.acknowledge).not.toHaveBeenCalled();
  });
  it("can acknowledge a proven same-generation replay after a lost response", async () => {
    const { deps } = setup(); deps.apply.mockResolvedValue({ applied: false, replayed: true, revision: "7", snapshotId });
    expect((await synchronizeGeneration(deps)).replayed).toBe(true); expect(deps.acknowledge).toHaveBeenCalledOnce();
  });
  it("supports a zero-event bootstrap or midnight refresh", async () => {
    const { deps } = setup(); deps.claim.mockResolvedValue({ ...claim, eventIds: [] });
    expect((await synchronizeGeneration(deps)).acknowledged).toBe(0); expect(deps.apply).toHaveBeenCalledOnce();
  });
  it("fails an expired lease without applying anything", async () => {
    const { deps } = setup(); deps.claim.mockResolvedValue({ ...claim, expiresAt: "2026-11-01T03:59:00.000Z" });
    await expect(synchronizeGeneration(deps)).rejects.toThrow("bridge_expired_lease"); expect(deps.apply).not.toHaveBeenCalled();
  });
  it("does not rewrite unchanged generations on every poll", async () => {
    const { deps } = setup(); deps.claim.mockResolvedValue({ ...claim, eventIds: [] });
    const release = vi.fn(async () => {});
    const result = await synchronizeGeneration({ ...deps, skipUnchanged: async () => true, release });
    expect(result).toHaveProperty("unchanged", true); expect(release).toHaveBeenCalledOnce();
    expect(deps.snapshot).not.toHaveBeenCalled(); expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.acknowledge).not.toHaveBeenCalled();
  });
  it("never skips a pending event even when today's generation exists", async () => {
    const { deps } = setup(); const release = vi.fn(async () => {});
    await synchronizeGeneration({ ...deps, skipUnchanged: async () => true, release });
    expect(deps.apply).toHaveBeenCalledOnce(); expect(release).not.toHaveBeenCalled();
  });
});
