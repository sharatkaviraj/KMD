export type TaskKind = "collection" | "marks" | "attendance";
export type TaskCreationResult = { ok: true; tasks: { id: string; reused: boolean; teacherId: string }[] }
  | { ok: false; reason: "scope_changed"; taskId: string }
  | { ok: false; reason: "recipient_changed" };
export type AssignmentMode = "common" | "class" | "house" | "route" | "subject";
export type TaskScope = { kind: AssignmentMode; value: string; subjectId?: string };
export type TaskStudent = { id: string; name: string; classId: string; classLabel: string; house: string | null; routeId: string | null; values: Record<string, string | null>; hasPhoto: boolean };
export type TaskOwner = { id: string; name: string; active: boolean; classIds: string[]; houses: string[]; routeIds: string[]; subjects: { classId: string; subjectId: string }[] };
export type PlanInput = { mode: AssignmentMode; teacherId?: string; selectedIds?: string[]; subjectId?: string; overrides?: Record<string, string> };
export type TaskGroup = { key: string; label: string; scope: TaskScope; studentIds: string[]; teacherId: string; teacherName: string };
export type TaskPlan = { groups: TaskGroup[]; blocked: { key: string; label: string; studentIds: string[]; candidates: string[]; reason: "ambiguous" | "missing-owner" | "not-owner" | "inactive" }[]; unassigned: string[] };
export function ownsScope(owner: TaskOwner, scope: TaskScope): boolean {
  if (!owner.active) return false;
  switch (scope.kind) {
    case "common": return true;
    case "class": return owner.classIds.includes(scope.value);
    case "house": return owner.houses.includes(scope.value);
    case "route": return owner.routeIds.includes(scope.value);
    case "subject": return owner.subjects.some(s => s.classId === scope.value && s.subjectId === scope.subjectId);
  }
}
export function planTasks(students: readonly TaskStudent[], owners: readonly TaskOwner[], input: PlanInput): TaskPlan {
  const selected = input.selectedIds ? new Set(input.selectedIds) : null;
  if (selected && [...selected].some(id => !students.some(s => s.id === id))) throw new Error("selection_changed");
  const rows = students.filter(s => !selected || selected.has(s.id));
  const buckets = new Map<string, { scope: TaskScope; label: string; ids: string[] }>();
  const plan: TaskPlan = { groups: [], blocked: [], unassigned: [] };
  for (const s of rows) {
    const value = input.mode === "common" ? "selected" : input.mode === "house" ? s.house : input.mode === "route" ? s.routeId : s.classId;
    if (!value || (input.mode === "subject" && !input.subjectId)) { plan.unassigned.push(s.id); continue; }
    const key = `${input.mode}:${value}`;
    const bucket = buckets.get(key) ?? { scope: { kind: input.mode, value, ...(input.mode === "subject" ? { subjectId: input.subjectId } : {}) }, label: input.mode === "class" || input.mode === "subject" ? s.classLabel : value, ids: [] };
    if (!bucket.ids.includes(s.id)) bucket.ids.push(s.id);
    buckets.set(key, bucket);
  }
  for (const [key, bucket] of buckets) {
    const candidates = owners.filter(o => ownsScope(o, bucket.scope));
    const chosen = input.mode === "common" ? input.teacherId : input.overrides?.[key] ?? (candidates.length === 1 ? candidates[0].id : undefined);
    const owner = owners.find(o => o.id === chosen);
    if (!owner || !ownsScope(owner, bucket.scope)) {
      plan.blocked.push({ key, label: bucket.label, studentIds: bucket.ids, candidates: candidates.map(o => o.id), reason: chosen ? (!owner?.active ? "inactive" : "not-owner") : candidates.length > 1 ? "ambiguous" : "missing-owner" });
      continue;
    }
    plan.groups.push({ key, label: bucket.label, scope: bucket.scope, studentIds: bucket.ids, teacherId: owner.id, teacherName: owner.name });
  }
  return plan;
}
export type SourceIdentity = { kind: TaskKind; session: string; studentIds?: string[]; fieldIds?: string[]; paperId?: string; classId?: string; day?: string };
const ordered = (ids?: string[]) => [...new Set(ids ?? [])].sort().join(",");
export function taskIdentity(s: SourceIdentity): string {
  return s.kind === "marks" ? `marks:${s.session}:${s.paperId}` : s.kind === "attendance" ? `attendance:${s.session}:${s.classId}:${s.day}` : `collection:${s.session}:${ordered(s.studentIds)}:${ordered(s.fieldIds)}`;
}
export type TaskState = "to-assign" | "waiting" | "to-approve" | "complete" | "revoked";
export function taskProgress(source: { kind: "collection"; expected: number; answered: number; approved: number; rejected?: number } | { kind: "marks"; submitted: boolean } | { kind: "attendance"; revision: number }): TaskState {
  if (source.kind === "marks") return source.submitted ? "complete" : "waiting";
  if (source.kind === "attendance") return source.revision > 0 ? "complete" : "waiting";
  if (source.expected <= 0 || source.answered < source.expected) return "waiting";
  return source.approved + (source.rejected ?? 0) >= source.expected ? "complete" : "to-approve";
}
export function mayWorkTask(task: { teacherId: string; revoked: boolean; scope: TaskScope }, owner: TaskOwner): boolean {
  return !task.revoked && task.teacherId === owner.id && ownsScope(owner, task.scope);
}
export type TaskSummary = { id: string; sourceKey: string; kind: TaskKind; title: string; teacherId: string | null; teacherName: string | null; dueDate: string | null; state: TaskState; expected: number; answered: number; rejected?: number; href: string; openedAt: string | null;
  /** The office's own read adds these (D-520): which press of "Give work" made it, and for which children. */
  approved?: number; createdAt?: string | null; students?: number; scope?: TaskScope; classId?: string | null };
export function mergeTaskSummaries<T extends { sourceKey: string; state?: string }>(rows: readonly T[]): T[] {
  const sources = new Map<string,T>();
  for (const row of rows) {
    const old = sources.get(row.sourceKey);
    if (!old || (old.state === "revoked" && row.state !== "revoked")) sources.set(row.sourceKey,row);
  }
  return [...sources.values()];
}
