import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { schoolToday } from "@/vx/format";
import { childBasics } from "@/vx/screens/teach/students";

import { authorsOf, childChoices, noteViewer, repliesFor, visibleNotes, visiblePlans } from "./data";
import type { AddStep } from "./ui/parts";
import type { NotesFocus, NotesProps, NotesScope } from "./ui/workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NotesSearch = { note?: string; plan?: string; student?: string; view?: string; sheet?: string; step?: string; tab?: string };

const STEPS: AddStep[] = ["add", "listening", "review", "saved"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Read the notes screens' URL into what they show; every design state is a link. */
export function notesSearch(raw: Record<string, string | string[] | undefined>): NotesSearch {
  return { note: one(raw.note), plan: one(raw.plan), student: one(raw.student), view: one(raw.view), sheet: one(raw.sheet), step: one(raw.step), tab: one(raw.tab) };
}

/**
 * Everything the notes list and board need for one request: the notes and
 * plans this reader may see, the children she may write about, and the
 * focused note, plan or child named in the URL.
 */
export async function loadNotes(staff: CurrentStaff, search: NotesSearch): Promise<(NotesProps & { classes: { id: string; label: string }[]; teachers: { id: string; name: string }[] }) | null> {
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return null;
  const viewer = await noteViewer(staff, sessionLabel);
  const [notes, plans, kids, labels] = await Promise.all([
    visibleNotes(viewer, sessionLabel),
    visiblePlans(viewer, sessionLabel),
    viewer.canWrite ? childChoices(viewer, sessionLabel) : Promise.resolve([]),
    classLabelMap(sessionLabel),
  ]);

  // `?student=` scopes the board to one child (from Student 360's "All
  // notes"). It narrows what this reader already sees and never widens it.
  // The child's name is read only for someone who may open the child's card
  // anyway (`students:view`), so the scope can say whose notes these are.
  const studentId = search.student && UUID.test(search.student) ? search.student : null;
  let scope: NotesScope = null;
  if (studentId) {
    const kid = kids.find((k) => k.id === studentId);
    const seen = notes.find((n) => n.studentId === studentId);
    let name = kid?.name ?? seen?.studentName ?? null;
    if (!name && can(staff, "students:view")) {
      name = (await childBasics([studentId]).catch(() => null))?.get(studentId)?.fullName ?? null;
    }
    scope = { studentId, name, classLabel: kid?.classLabel ?? seen?.classLabel ?? null };
  }

  let focus: NotesFocus = null;
  if (search.note) {
    const note = notes.find((n) => n.id === search.note);
    if (note) focus = search.view === "plan" && !note.planId ? { kind: "new-plan", note } : { kind: "note", note, replies: await repliesFor(note.id).catch(() => []) };
  } else if (search.plan) {
    const plan = plans.find((pl) => pl.id === search.plan);
    if (plan) focus = { kind: "plan", plan };
  } else if (search.student) {
    const mine = notes.filter((n) => n.studentId === search.student);
    const kid = kids.find((k) => k.id === search.student);
    const first = mine[0];
    if (kid || first) {
      focus = {
        kind: "student",
        studentId: search.student,
        name: kid?.name ?? first?.studentName ?? "—",
        classLabel: kid?.classLabel ?? first?.classLabel ?? "—",
        notes: mine,
        plans: plans.filter((pl) => pl.studentId === search.student),
      };
    }
  }

  const classIds = viewer.readsEveryClass || viewer.correctsAttendance ? [...labels.keys()] : [...viewer.classIds];
  return {
    notes,
    plans,
    kids,
    viewer: {
      id: viewer.id,
      name: staff.displayName,
      readsEveryClass: viewer.readsEveryClass,
      correctsAttendance: viewer.correctsAttendance,
      heldClassIds: [...viewer.heldClassIds],
      canWrite: viewer.canWrite,
    },
    today: schoolToday(),
    school: "",
    focus,
    scope,
    initialSheet: search.sheet === "add" && viewer.canWrite ? "add" : null,
    initialStep: STEPS.includes(search.step as AddStep) ? (search.step as AddStep) : "add",
    initialStudent: search.student ?? null,
    classes: classIds.map((id) => ({ id, label: labels.get(id) ?? "—" })),
    teachers: authorsOf(notes),
  };
}
