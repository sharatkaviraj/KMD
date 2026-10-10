import "server-only";

import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { heldClassIds, ownClassIds } from "@/modules/attendance/data/teaching-repo";
import { enrolmentForStudent } from "@/modules/students/data/student-repo";
import { childBasics, enrolledIn, staffNames } from "@/vx/screens/teach/students";
import {
  canSeeNote,
  isTag,
  tagsFromKind,
  type BoardNote,
  type FollowOwner,
  type NoteStatus,
  type PlanStatus,
  type PlanStep,
  type Visibility,
} from "./domain/notes";

/*
 * Notes on children, read for the vx screens. Read with the service role and
 * filtered by `canSeeNote()` — the same rule as the `notes_select_scoped`
 * policy — because the board joins notes to fee-side names and to replies
 * and plans, which one RLS read cannot do. Every function asks `notes:view`
 * first.
 */

export type NoteViewer = {
  id: string;
  readsEveryClass: boolean;
  correctsAttendance: boolean;
  classIds: Set<string>;
  heldClassIds: Set<string>;
  canWrite: boolean;
};

export async function noteViewer(staff: CurrentStaff, sessionLabel: string): Promise<NoteViewer> {
  const [own, held] = await Promise.all([ownClassIds(staff.id, sessionLabel), heldClassIds(staff.id, sessionLabel)]);
  return {
    id: staff.id,
    readsEveryClass: readsEveryClass(staff),
    correctsAttendance: can(staff, "attendance:correct"),
    classIds: new Set(own),
    heldClassIds: new Set(held),
    // Coordinators hold notes:view and no notes:write, and the board's "Add a
    // note" is theirs too (docs/ui/DECISIONS.md).
    canWrite: can(staff, "notes:write") || (can(staff, "notes:view") && readsEveryClass(staff)),
  };
}

type NoteRow = {
  id: string;
  session_label: string;
  student_id: string | null;
  class_id: string | null;
  body: string;
  tags: string[] | null;
  source: string | null;
  status: string | null;
  visibility: string | null;
  needs_follow_up: boolean | null;
  follow_up_on: string | null;
  follow_up_owner: string | null;
  follow_up_staff_id: string | null;
  tell_parents: boolean | null;
  written_by: string;
  author_relation: string | null;
  subject_code: string | null;
  created_at: string;
  note_kinds: { code: string } | null;
};

const COLUMNS =
  "id, session_label, student_id, class_id, body, tags, source, status, visibility, needs_follow_up, follow_up_on, " +
  "follow_up_owner, follow_up_staff_id, tell_parents, written_by, author_relation, subject_code, created_at, note_kinds(code)";

async function enrich(rows: NoteRow[], sessionLabel: string): Promise<BoardNote[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [labels, kids, names, replies, plans] = await Promise.all([
    classLabelMap(sessionLabel),
    childBasics(rows.map((r) => r.student_id ?? "")),
    staffNames(rows.flatMap((r) => [r.written_by, r.follow_up_staff_id ?? ""])),
    fetchInChunks<{ note_id: string }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) => createAdminClient().from("note_replies").select("note_id").in("note_id", chunk)),
    fetchInChunks<{ id: string; note_id: string | null; status: string }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
      createAdminClient().from("support_plans").select("id, note_id, status").in("note_id", chunk),
    ),
  ]);
  const replyCount = new Map<string, number>();
  for (const r of replies.data) replyCount.set(r.note_id, (replyCount.get(r.note_id) ?? 0) + 1);
  const planOf = new Map<string, string>();
  for (const p of plans.data) if (p.note_id) planOf.set(p.note_id, p.id);

  return rows.map((r) => {
    const tags = (r.tags ?? []).filter(isTag);
    return {
      id: r.id,
      studentId: r.student_id,
      studentName: r.student_id ? (kids.get(r.student_id)?.fullName ?? "—") : "—",
      classId: r.class_id,
      classLabel: r.class_id ? (labels.get(r.class_id) ?? "—") : "—",
      body: r.body,
      tags: tags.length ? tags : tagsFromKind(r.note_kinds?.code),
      source: r.source === "voice" ? "voice" : "typed",
      status: (r.status === "working" || r.status === "done" ? r.status : "open") as NoteStatus,
      visibility: (r.visibility === "private" ? "private" : "team") as Visibility,
      needsFollowUp: Boolean(r.needs_follow_up),
      followUpOn: r.follow_up_on,
      followUpOwner: (r.follow_up_owner as FollowOwner | null) ?? null,
      followUpStaffId: r.follow_up_staff_id,
      followUpName: r.follow_up_staff_id ? (names.get(r.follow_up_staff_id) ?? null) : null,
      tellParents: Boolean(r.tell_parents),
      writtenBy: r.written_by,
      writtenByName: names.get(r.written_by) ?? "—",
      authorRelation: r.author_relation,
      subjectCode: r.subject_code,
      createdAt: r.created_at,
      replies: replyCount.get(r.id) ?? 0,
      planId: planOf.get(r.id) ?? null,
    };
  });
}

/**
 * Every note this viewer may see this session, newest first.
 *
 * A teacher's are read by who wrote them, who follows them up, and her own
 * classes; the school-wide roles read the session. `studentId` narrows to
 * one child.
 */
export async function visibleNotes(viewer: NoteViewer, sessionLabel: string, opts: { studentId?: string; limit?: number } = {}): Promise<BoardNote[]> {
  const admin = createAdminClient();
  const limit = opts.limit ?? 600;
  const base = () => {
    let q = admin.from("notes").select(COLUMNS).eq("session_label", sessionLabel);
    if (opts.studentId) q = q.eq("student_id", opts.studentId);
    return q;
  };

  let rows: NoteRow[] = [];
  if (viewer.readsEveryClass || viewer.correctsAttendance) {
    const { data, error } = await base().order("created_at", { ascending: false }).limit(limit).returns<NoteRow[]>();
    if (error) throw new Error(`Could not read the notes: ${error.message}`);
    rows = data;
  } else {
    const [mine, followed, classes] = await Promise.all([
      base().eq("written_by", viewer.id).order("created_at", { ascending: false }).limit(limit).returns<NoteRow[]>(),
      base().eq("follow_up_staff_id", viewer.id).order("created_at", { ascending: false }).limit(limit).returns<NoteRow[]>(),
      viewer.classIds.size
        ? fetchInChunks<NoteRow>([...viewer.classIds], IN_FILTER_CHUNK_SIZE, (chunk) =>
            base().eq("visibility", "team").in("class_id", chunk).order("created_at", { ascending: false }).limit(limit).returns<NoteRow[]>(),
          )
        : Promise.resolve({ data: [] as NoteRow[], error: null }),
    ]);
    if (mine.error || followed.error || classes.error) throw new Error("Could not read the notes.");
    const byId = new Map<string, NoteRow>();
    for (const r of [...mine.data, ...followed.data, ...classes.data]) byId.set(r.id, r);
    rows = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }

  const seen = rows.filter((r) =>
    canSeeNote(
      {
        visibility: r.visibility === "private" ? "private" : "team",
        writtenBy: r.written_by,
        followUpStaffId: r.follow_up_staff_id,
        classId: r.class_id,
      },
      viewer,
    ),
  );
  return enrich(seen, sessionLabel);
}

/**
 * One child's notes, for the Student 360 notes tab: the notes the signed-in
 * reader may see about this child this session, newest first. Refuses a
 * child outside the reader's classes rather than returning an empty list.
 */
export async function notesForStudent(studentId: string): Promise<BoardNote[]> {
  const staff = await assertPermission("notes:view");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return [];
  const viewer = await noteViewer(staff, sessionLabel);
  if (!viewer.readsEveryClass && !viewer.correctsAttendance) {
    const placement = await enrolmentForStudent(studentId, sessionLabel);
    if (!placement || !viewer.classIds.has(placement.classId)) {
      // A note a teacher wrote or was asked to follow up is still hers.
      const all = await visibleNotes(viewer, sessionLabel, { studentId });
      return all.filter((n) => n.writtenBy === viewer.id || n.followUpStaffId === viewer.id);
    }
  }
  return visibleNotes(viewer, sessionLabel, { studentId });
}

export type NoteReply = { id: string; body: string; source: "typed" | "voice" | "system"; writtenByName: string; writtenBy: string; createdAt: string };

export async function repliesFor(noteId: string): Promise<NoteReply[]> {
  const { data, error } = await createAdminClient()
    .from("note_replies")
    .select("id, body, source, written_by, created_at")
    .eq("note_id", noteId)
    .order("created_at")
    .returns<{ id: string; body: string; source: string; written_by: string; created_at: string }[]>();
  if (error) throw new Error(`Could not read the replies: ${error.message}`);
  const names = await staffNames(data.map((r) => r.written_by));
  return data.map((r) => ({
    id: r.id,
    body: r.body,
    source: r.source === "voice" || r.source === "system" ? r.source : "typed",
    writtenBy: r.written_by,
    writtenByName: names.get(r.written_by) ?? "—",
    createdAt: r.created_at,
  }));
}

/* ------------------------------------------------------------ support plans */

export type SupportPlan = {
  id: string;
  studentId: string;
  studentName: string;
  classId: string | null;
  classLabel: string;
  noteId: string | null;
  goal: string;
  status: PlanStatus;
  tellParents: boolean;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  steps: PlanStep[];
};

type PlanRow = {
  id: string;
  student_id: string;
  class_id: string | null;
  note_id: string | null;
  goal: string | null;
  status: string;
  tell_parents: boolean | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type StepRow = {
  id: string;
  plan_id: string;
  text: string;
  owner_role: string | null;
  owner_staff_id: string | null;
  due_label: string | null;
  sort_order: number;
  done_at: string | null;
  removed_at: string | null;
};

/**
 * Support plans this viewer may see: the plans on children in her classes
 * and the ones she made; every plan for the school-wide roles.
 */
export async function visiblePlans(viewer: NoteViewer, sessionLabel: string, opts: { studentId?: string; planId?: string } = {}): Promise<SupportPlan[]> {
  let q = createAdminClient()
    .from("support_plans")
    .select("id, student_id, class_id, note_id, goal, status, tell_parents, created_by, created_at, updated_at")
    .eq("session_label", sessionLabel)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (opts.studentId) q = q.eq("student_id", opts.studentId);
  if (opts.planId) q = q.eq("id", opts.planId);
  const { data, error } = await q.returns<PlanRow[]>();
  if (error) throw new Error(`Could not read the support plans: ${error.message}`);

  let rows = data;
  if (!viewer.readsEveryClass && !viewer.correctsAttendance) {
    // A plan made before class_id was recorded is placed by the child's enrolment.
    const unplaced = rows.filter((r) => !r.class_id).map((r) => r.student_id);
    const placed = new Map<string, string>();
    if (unplaced.length) {
      const { data: enr } = await fetchInChunks<{ student_id: string; class_id: string }>(unplaced, IN_FILTER_CHUNK_SIZE, (chunk) =>
        createAdminClient().from("enrolments").select("student_id, class_id").eq("session_label", sessionLabel).in("student_id", chunk),
      );
      for (const e of enr) placed.set(e.student_id, e.class_id);
    }
    rows = rows.filter((r) => {
      const cls = r.class_id ?? placed.get(r.student_id) ?? null;
      return r.created_by === viewer.id || (cls !== null && viewer.classIds.has(cls));
    });
  }
  if (rows.length === 0) return [];

  const [labels, kids, steps] = await Promise.all([
    classLabelMap(sessionLabel),
    childBasics(rows.map((r) => r.student_id)),
    fetchInChunks<StepRow>(
      rows.map((r) => r.id),
      IN_FILTER_CHUNK_SIZE,
      (chunk) =>
        createAdminClient()
          .from("support_plan_steps")
          .select("id, plan_id, text, owner_role, owner_staff_id, due_label, sort_order, done_at, removed_at")
          .in("plan_id", chunk)
          .is("removed_at", null)
          .order("sort_order"),
    ),
  ]);
  const names = await staffNames([...rows.map((r) => r.created_by), ...steps.data.map((s) => s.owner_staff_id ?? "")]);

  return rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: kids.get(r.student_id)?.fullName ?? "—",
    classId: r.class_id,
    classLabel: r.class_id ? (labels.get(r.class_id) ?? "—") : "—",
    noteId: r.note_id,
    goal: r.goal ?? "",
    status: (["draft", "active", "done", "closed"].includes(r.status) ? r.status : "active") as PlanStatus,
    tellParents: Boolean(r.tell_parents),
    createdBy: r.created_by,
    createdByName: names.get(r.created_by) ?? "—",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    steps: steps.data
      .filter((s) => s.plan_id === r.id)
      .map((s) => ({
        id: s.id,
        body: s.text,
        ownerRole: s.owner_role,
        ownerName: s.owner_staff_id ? (names.get(s.owner_staff_id) ?? null) : null,
        whenLabel: s.due_label,
        done: s.done_at !== null,
        sortOrder: s.sort_order,
      })),
  }));
}

/* ----------------------------------------------------- choosing a child */

export type ChildChoice = { id: string; name: string; classId: string; classLabel: string };

/** The children a note may be about: the viewer's classes, or every class for the school-wide roles. */
export async function childChoices(viewer: NoteViewer, sessionLabel: string): Promise<ChildChoice[]> {
  const labels = await classLabelMap(sessionLabel);
  const classIds = viewer.readsEveryClass || viewer.correctsAttendance ? [...labels.keys()] : [...viewer.classIds];
  const enrolled = await enrolledIn(classIds, sessionLabel);
  const kids = await childBasics(enrolled.map((e) => e.studentId));
  const order = new Map([...labels.keys()].map((id, i) => [id, i]));
  return enrolled
    .map((e) => ({ id: e.studentId, name: kids.get(e.studentId)?.fullName ?? "—", classId: e.classId, classLabel: labels.get(e.classId) ?? "—" }))
    .sort((a, b) => (order.get(a.classId) ?? 0) - (order.get(b.classId) ?? 0) || a.name.localeCompare(b.name));
}

/** Teachers who wrote notes, for the board's teacher filter. */
export function authorsOf(notes: readonly BoardNote[]): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const n of notes) m.set(n.writtenBy, n.writtenByName);
  return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
