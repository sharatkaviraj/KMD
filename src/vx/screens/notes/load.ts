import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { schoolNow } from "@/platform/auth/qa-clock";
import { schoolToday } from "@/vx/format";
import { childBasics } from "@/vx/screens/teach/students";
import { readParentSwitches } from "@/vx/screens/settings/parent-switches";

import { authorsOf, childChoices, childFacts, notesPeople, noteViewer, repliesFor, visibleNotes, visiblePlans } from "./data";
import type { AddStep } from "./ui/parts";
import type { NotesFocus, NotesProps, NotesScope } from "./ui/workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NotesSearch = { note?: string; plan?: string; student?: string; view?: string; sheet?: string; step?: string; tab?: string; saved?: string; class?: string };

const STEPS: AddStep[] = ["add", "listening", "review", "saved"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Read the notes screens' URL into what they show; every design state is a link. */
export function notesSearch(raw: Record<string, string | string[] | undefined>): NotesSearch {
  // `?add=1` is the quick-actions menu's link to "Add a note" (nav.ts).
  const sheet = one(raw.sheet) ?? (one(raw.add) ? "add" : undefined);
  return { note: one(raw.note), plan: one(raw.plan), student: one(raw.student), view: one(raw.view), sheet, step: one(raw.step), tab: one(raw.tab), saved: one(raw.saved), class: one(raw.class) };
}

/**
 * Everything the notes list and board need for one request: the notes and
 * plans this reader may see, the children she may write about, and the
 * focused note, plan or child named in the URL.
 */
export async function loadNotes(staff: CurrentStaff, search: NotesSearch): Promise<(NotesProps & { classes: { id: string; label: string }[]; teachers: { id: string; name: string }[] }) | null> {
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return null;
  // The reader's clock (the lab clock on a test seat), as Academics Today uses,
  // so the board and Today judge "due" against the same day (smoke 20 Oct).
  const today = schoolToday(await schoolNow(staff));
  const viewer = await noteViewer(staff, sessionLabel);
  const [notes, plans, kids, labels, people, parentSwitches] = await Promise.all([
    visibleNotes(viewer, sessionLabel),
    visiblePlans(viewer, sessionLabel),
    viewer.canWrite ? childChoices(viewer, sessionLabel) : Promise.resolve([]),
    classLabelMap(sessionLabel),
    notesPeople(sessionLabel, today, { id: staff.id, role: staff.role }).catch(() => ({ classTeachers: {}, coordinator: null, admin: null })),
    readParentSwitches(),
  ]);

  // `?student=` opens one child's notes (from Student 360's "All notes"). It
  // narrows what this reader already sees and never widens it. The child's
  // name, admission number and father are read only for someone who may open
  // the child's card anyway (`students:view`).
  const studentId = search.student && UUID.test(search.student) ? search.student : null;
  let scope: NotesScope = null;
  if (studentId) {
    const kid = kids.find((k) => k.id === studentId);
    const seen = notes.find((n) => n.studentId === studentId);
    let name = kid?.name ?? seen?.studentName ?? null;
    const mayRead = can(staff, "students:view");
    if (!name && mayRead) {
      name = (await childBasics([studentId]).catch(() => null))?.get(studentId)?.fullName ?? null;
    }
    const facts = mayRead ? await childFacts(studentId).catch(() => null) : null;
    const classId = kid?.classId ?? seen?.classId ?? null;
    scope = { studentId, name, classLabel: kid?.classLabel ?? seen?.classLabel ?? null, classId, sr: facts?.sr ?? null, father: facts?.father ?? null, profile: mayRead, photo: kid?.photo ?? seen?.studentPhoto ?? null };
  }

  let focus: NotesFocus = null;
  if (search.note) {
    const note = notes.find((n) => n.id === search.note);
    if (note) focus = search.view === "plan" && !note.planId ? { kind: "new-plan", note } : { kind: "note", note, replies: await repliesFor(note.id).catch(() => []) };
  } else if (search.plan) {
    const plan = plans.find((pl) => pl.id === search.plan);
    if (plan) focus = { kind: "plan", plan };
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
      isAdmin: viewer.isAdmin,
      isCoordinator: staff.role === "academic_coordinator",
      parentNotes: parentSwitches.note,
      parentPlans: parentSwitches.supportPlan,
    },
    today,
    school: "",
    focus,
    scope,
    people,
    initialSheet: search.sheet === "add" && viewer.canWrite ? "add" : null,
    initialStep: STEPS.includes(search.step as AddStep) ? (search.step as AddStep) : "add",
    initialStudent: search.student ?? null,
    initialClass: search.class && UUID.test(search.class) ? search.class : null,
    savedId: search.saved && UUID.test(search.saved) ? search.saved : null,
    testSession: isTestSessionLabel(sessionLabel),
    classes: classIds.map((id) => ({ id, label: labels.get(id) ?? "—" })),
    teachers: authorsOf(notes),
  };
}
