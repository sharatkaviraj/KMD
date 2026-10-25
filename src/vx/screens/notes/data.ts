import "server-only";

import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { heldClassIds, ownClassIds } from "@/modules/attendance/data/teaching-repo";
import { enrolmentForStudent } from "@/modules/students/data/student-repo";
import { tellApartWithin } from "@/vx/domain/tell-apart";
import type { Pair } from "@/vx/text";
import { childBasics, enrolledIn, staffNames } from "@/vx/screens/teach/students";
import {
  canSeeNote,
  copiesNoteWords,
  isSensitiveNote,
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
  isAdmin: boolean;
  readsEveryClass: boolean;
  correctsAttendance: boolean;
  classIds: Set<string>;
  heldClassIds: Set<string>;
  canWrite: boolean;
};

/**
 * Who may add a note. Coordinators hold notes:view and no notes:write, and
 * the board's "Add a note" is theirs too (docs/ui/DECISIONS.md).
 */
export function canWriteNotes(staff: CurrentStaff): boolean {
  return can(staff, "notes:write") || (can(staff, "notes:view") && readsEveryClass(staff));
}

export async function noteViewer(staff: CurrentStaff, sessionLabel: string): Promise<NoteViewer> {
  const [own, held] = await Promise.all([ownClassIds(staff.id, sessionLabel), heldClassIds(staff.id, sessionLabel)]);
  return {
    id: staff.id,
    isAdmin: staff.role === "admin",
    readsEveryClass: readsEveryClass(staff),
    correctsAttendance: can(staff, "attendance:correct"),
    classIds: new Set(own),
    heldClassIds: new Set(held),
    canWrite: canWriteNotes(staff),
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

/** A row's tags, or its old kind's for a note written before tags existed. */
function tagsOf(r: Pick<NoteRow, "tags" | "note_kinds">) {
  const tags = (r.tags ?? []).filter(isTag);
  return tags.length ? tags : tagsFromKind(r.note_kinds?.code);
}

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
  // Two children of one class who share a name, both with notes, get their
  // SR number and father under the name (smoke 20 Oct, dev.groups[11]).
  const children = new Map<string, { id: string; classId: string; name: string; admissionNo: string | null; fatherName: string | null }>();
  for (const r of rows) {
    const kid = r.student_id ? kids.get(r.student_id) : undefined;
    if (kid) children.set(kid.id, { id: kid.id, classId: r.class_id ?? "", name: kid.fullName, admissionNo: kid.admissionNo, fatherName: kid.fatherName });
  }
  const apart = tellApartWithin([...children.values()], (k) => k.classId);

  return rows.map((r) => {
    const tags = (r.tags ?? []).filter(isTag);
    return {
      id: r.id,
      studentId: r.student_id,
      // Empty for a note about a whole class (no child) or a child whose
      // record is gone: noteSubject() says which, in the reader's language.
      studentName: r.student_id ? (kids.get(r.student_id)?.fullName ?? "") : "",
      studentHint: r.student_id ? (apart.get(r.student_id) ?? null) : null,
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
export async function visibleNotes(viewer: NoteViewer, sessionLabel: string, opts: { studentId?: string; noteId?: string; limit?: number } = {}): Promise<BoardNote[]> {
  const admin = createAdminClient();
  const limit = opts.limit ?? 600;
  const base = () => {
    let q = admin.from("notes").select(COLUMNS).eq("session_label", sessionLabel);
    if (opts.studentId) q = q.eq("student_id", opts.studentId);
    if (opts.noteId) q = q.eq("id", opts.noteId);
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
        tags: tagsOf(r),
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
  // A plan made from a health or family note is read only by who reads that
  // note (D-264): its goal and steps are about the same thing.
  const fromNotes = [...new Set(rows.map((r) => r.note_id).filter((id): id is string => Boolean(id)))];
  if (fromNotes.length) {
    const { data: sources, error: sourceError } = await fetchInChunks<Pick<NoteRow, "id" | "tags" | "visibility" | "written_by" | "follow_up_staff_id" | "class_id" | "note_kinds" | "body">>(fromNotes, IN_FILTER_CHUNK_SIZE, (chunk) =>
      createAdminClient()
        .from("notes")
        .select("id, tags, visibility, written_by, follow_up_staff_id, class_id, body, note_kinds(code)")
        .in("id", chunk)
        .returns<Pick<NoteRow, "id" | "tags" | "visibility" | "written_by" | "follow_up_staff_id" | "class_id" | "note_kinds" | "body">[]>(),
    );
    if (sourceError) throw new Error("Could not read the support plans.");
    const sourceIds = new Set(sources.map((source) => source.id));
    if (fromNotes.some((id) => !sourceIds.has(id))) throw new Error("Could not read the support plans.");
    const hidden = new Set(
      sources
        .filter((n) => {
          const tags = tagsOf(n);
          if (!isSensitiveNote({ tags })) return false;
          // The note's own visibility: an Only me health note's plan is the author's alone.
          return !canSeeNote({ visibility: n.visibility === "private" ? "private" : "team", writtenBy: n.written_by, followUpStaffId: n.follow_up_staff_id, classId: n.class_id, tags }, viewer);
        })
        .map((n) => n.id),
    );
    // A plan whose goal still repeats an Only me note's words (made before
    // R01 stopped the copy) is its author's alone, like the note.
    const privateBody = new Map(sources.filter((n) => n.visibility === "private" && n.written_by !== viewer.id).map((n) => [n.id, n.body]));
    rows = rows.filter((r) => {
      if (r.created_by === viewer.id || !r.note_id) return true;
      if (hidden.has(r.note_id)) return false;
      const body = privateBody.get(r.note_id);
      return body === undefined || !copiesNoteWords(r.goal ?? "", body);
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
        ownerStaffId: s.owner_staff_id,
        whenLabel: s.due_label,
        done: s.done_at !== null,
        sortOrder: s.sort_order,
      })),
  }));
}

/* ----------------------------------------------------- choosing a child */

/** `hint`: SR number and father, only for a child who shares a name with another in her class. */
export type ChildChoice = { id: string; name: string; classId: string; classLabel: string; rollNo?: string | null; hint?: Pair | null };

/** The children a note may be about: the viewer's classes, or every class for the school-wide roles. */
export async function childChoices(viewer: NoteViewer, sessionLabel: string): Promise<ChildChoice[]> {
  const labels = await classLabelMap(sessionLabel);
  const classIds = viewer.readsEveryClass || viewer.correctsAttendance ? [...labels.keys()] : [...viewer.classIds];
  const enrolled = await enrolledIn(classIds, sessionLabel);
  const kids = await childBasics(enrolled.map((e) => e.studentId));
  const order = new Map([...labels.keys()].map((id, i) => [id, i]));
  // Same-named children in one class: SR number and father (smoke 20 Oct).
  const apart = tellApartWithin(
    enrolled.map((e) => ({ id: e.studentId, classId: e.classId, name: kids.get(e.studentId)?.fullName ?? "", admissionNo: kids.get(e.studentId)?.admissionNo ?? null, fatherName: kids.get(e.studentId)?.fatherName ?? null })),
    (k) => k.classId,
  );
  return enrolled
    .map((e) => ({ id: e.studentId, name: kids.get(e.studentId)?.fullName ?? "—", classId: e.classId, classLabel: labels.get(e.classId) ?? "—", rollNo: e.rollNo, hint: apart.get(e.studentId) ?? null }))
    .sort((a, b) => (order.get(a.classId) ?? 0) - (order.get(b.classId) ?? 0) || a.name.localeCompare(b.name));
}

/* ------------------------------------------------- who follows a note up */

/**
 * The people a follow-up can go to, by name, so the screens can say "Class
 * teacher · Mr. Choudhary" rather than a role: each class's current class
 * teacher, and the coordinator and admin `followUpStaff()` in actions.ts
 * would pick (the first active one by created_at). Names, plus those two ids
 * so a screen says "you" by who the viewer is, never by their role (B09).
 */
export type NotesPeople = { classTeachers: Record<string, string>; coordinator: string | null; admin: string | null; coordinatorId?: string | null; adminId?: string | null };

export async function notesPeople(sessionLabel: string, day: string, reader?: { id: string; role: string }): Promise<NotesPeople> {
  const admin = createAdminClient();
  const [held, coord, head] = await Promise.all([
    admin
      .from("class_teachers")
      .select("class_id, staff_profile_id, role, effective_from, effective_to")
      .eq("session_label", sessionLabel)
      .returns<{ class_id: string; staff_profile_id: string; role: string; effective_from: string | null; effective_to: string | null }[]>(),
    admin.from("staff_profiles").select("id").eq("role", "academic_coordinator").eq("is_active", true).order("created_at").limit(1).returns<{ id: string }[]>(),
    admin.from("staff_profiles").select("id").eq("role", "admin").eq("is_active", true).order("created_at").limit(1).returns<{ id: string }[]>(),
  ]);
  const byClass = new Map<string, { staff: string; role: string }>();
  for (const row of held.data ?? []) {
    if (row.effective_from && row.effective_from > day) continue;
    if (row.effective_to && row.effective_to < day) continue;
    const cur = byClass.get(row.class_id);
    if (!cur || (cur.role !== "class_teacher" && row.role === "class_teacher")) byClass.set(row.class_id, { staff: row.staff_profile_id, role: row.role });
  }
  // A coordinator reading the notes is "the coordinator" on her own screens:
  // with two coordinators, the first by created_at was named on every note
  // and plan (smoke 20 Oct). followUpStaff() in actions.ts picks the same.
  const coordId = reader?.role === "academic_coordinator" ? reader.id : (coord.data?.[0]?.id ?? null);
  const adminId = head.data?.[0]?.id ?? null;
  const names = await staffNames([...[...byClass.values()].map((v) => v.staff), coordId ?? "", adminId ?? ""]);
  return {
    classTeachers: Object.fromEntries([...byClass].map(([classId, v]) => [classId, names.get(v.staff) ?? "—"])),
    coordinator: coordId ? (names.get(coordId) ?? null) : null,
    admin: adminId ? (names.get(adminId) ?? null) : null,
    coordinatorId: coordId,
    adminId,
  };
}

/** A child's admission number and father's name, for the one-child notes page. Read only for a reader who may open the child's card. */
export async function childFacts(studentId: string): Promise<{ sr: string | null; father: string | null } | null> {
  const { data, error } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("students")
    .select("admission_no, father_name")
    .eq("id", studentId)
    .maybeSingle<{ admission_no: string | null; father_name: string | null }>();
  if (error || !data) return null;
  return { sr: data.admission_no, father: data.father_name };
}

/** Teachers who wrote notes, for the board's teacher filter. */
export function authorsOf(notes: readonly BoardNote[]): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const n of notes) m.set(n.writtenBy, n.writtenByName);
  return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
