import { describe, expect, it } from "vitest";
import { planTasks, taskIdentity, taskProgress, mayWorkTask, mergeTaskSummaries, type TaskStudent, type TaskOwner } from "@/modules/teacher-tasks/domain/tasks";

const students: TaskStudent[] = [
  { id: "a", name: "Test A", classId: "c1", classLabel: "Class 1", house: "Red", routeId: "r1", values: {}, hasPhoto: false },
  { id: "b", name: "Test B", classId: "c1", classLabel: "Class 1", house: null, routeId: "r2", values: {}, hasPhoto: true },
  { id: "c", name: "Test C", classId: "c2", classLabel: "Class 2", house: "Blue", routeId: null, values: {}, hasPhoto: false },
];
const owners: TaskOwner[] = [
  { id: "t1", name: "Test Teacher 1", active: true, classIds: ["c1"], houses: ["Red"], routeIds: ["r1"], subjects: [{ classId: "c1", subjectId: "s1" }] },
  { id: "t2", name: "Test Teacher 2", active: true, classIds: ["c2"], houses: ["Blue"], routeIds: ["r2"], subjects: [{ classId: "c2", subjectId: "s1" }] },
];
describe("teacher task scope planning", () => {
  it("makes one selected list for a chosen active teacher, without needing a phone", () => {
    const p = planTasks(students, owners, { mode: "common", teacherId: "t2", selectedIds: ["a", "b", "a"] });
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0]).toMatchObject({ teacherId: "t2", studentIds: ["a", "b"] });
    expect(p.blocked).toEqual([]);
  });
  it.each([ ["class", 2, 0], ["house", 2, 1], ["route", 2, 1], ["subject", 2, 0] ] as const)("partitions %s without silently dropping children", (mode, groups, missing) => {
    const p = planTasks(students, owners, { mode, subjectId: "s1" });
    expect(p.groups).toHaveLength(groups);
    expect(p.unassigned).toHaveLength(missing);
    expect(p.groups.flatMap(g => g.studentIds).length + p.unassigned.length).toBe(3);
  });
  it("blocks ambiguous responsibility until explicitly selected", () => {
    const choices = [...owners, { ...owners[0], id: "t3" }];
    expect(planTasks(students, choices, { mode: "class" }).blocked[0].reason).toBe("ambiguous");
    expect(planTasks(students, choices, { mode: "class", overrides: { "class:c1": "t3" } }).groups[0].teacherId).toBe("t3");
  });
  it("blocks missing/inactive/non-owner choices in automatic modes", () => {
    expect(planTasks(students, [], { mode: "class" }).blocked[0].reason).toBe("missing-owner");
    expect(planTasks(students, owners, { mode: "class", overrides: { "class:c1": "t2" } }).blocked[0].reason).toBe("not-owner");
    expect(planTasks(students, owners.map(o => ({ ...o, active: false })), { mode: "common", teacherId: "t1" }).blocked[0].reason).toBe("inactive");
  });
  it("rejects stale selected ids instead of quietly shrinking the preview", () => {
    expect(() => planTasks(students, owners, { mode: "common", teacherId: "t1", selectedIds: ["gone"] })).toThrow();
  });
});
describe("canonical identity and current authority", () => {
  it("deduplicates cross-entry collection requests independently of order and deadline", () => {
    const a = { kind: "collection" as const, session: "test", studentIds: ["b", "a"], fieldIds: ["f2", "f1"] };
    expect(taskIdentity(a)).toBe(taskIdentity({ ...a, studentIds: ["a", "b", "a"], fieldIds: ["f1", "f2"] }));
    expect(taskIdentity(a)).not.toBe(taskIdentity({ ...a, fieldIds: ["f1"] }));
    expect(taskIdentity({ kind: "marks", session: "test", paperId: "p" })).toBe("marks:test:p");
  });
  it("derives submitted and approved separately, while marks and registers use canonical saved state", () => {
    expect(taskProgress({ kind: "collection", expected: 2, answered: 2, approved: 0 })).toBe("to-approve");
    expect(taskProgress({ kind: "collection", expected: 2, answered: 2, approved: 2 })).toBe("complete");
    expect(taskProgress({ kind: "marks", submitted: true })).toBe("complete");
    expect(taskProgress({ kind: "attendance", revision: 1 })).toBe("complete");
  });
  it("rejects revoked, inactive, mismatched or reassigned scope on either entry path", () => {
    const task = { teacherId: "t1", revoked: false, scope: { kind: "class" as const, value: "c1" } };
    expect(mayWorkTask(task, owners[0])).toBe(true);
    expect(mayWorkTask({ ...task, revoked: true }, owners[0])).toBe(false);
    expect(mayWorkTask(task, { ...owners[0], active: false })).toBe(false);
    expect(mayWorkTask(task, owners[1])).toBe(false);
    expect(mayWorkTask(task, { ...owners[0], classIds: [] })).toBe(false);
    expect(mayWorkTask({ ...task, scope: { kind: "common", value: "selected" } }, { ...owners[0], classIds: [] })).toBe(true);
  });
  it("treats a rejected proposal as reviewed, without claiming it was approved", () => {
    expect(taskProgress({kind:"collection",expected:2,answered:2,approved:1,rejected:1})).toBe("complete");
  });
  it("prefers the current task over an older revoked task", () => {
    expect(mergeTaskSummaries([{id:"old",sourceKey:"marks:p",state:"revoked"},{id:"new",sourceKey:"marks:p",state:"waiting"}])[0].id).toBe("new");
  });
  it("the hub keeps one canonical source when legacy and task entries overlap", () => {
    const rows = [{ id: "task", sourceKey: "marks:p" }, { id: "legacy", sourceKey: "marks:p" }, { id: "other", sourceKey: "collection:r" }];
    expect(mergeTaskSummaries(rows).map(r => r.id)).toEqual(["task", "other"]);
  });
});
