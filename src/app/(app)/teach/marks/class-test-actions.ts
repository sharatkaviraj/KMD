"use server";

import { revalidatePath } from "next/cache";

import { isAssignedTo } from "@/modules/assessments/data/assessments-repo";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { schoolToday } from "@/platform/dates";
import { assertClassVisible, assertSessionWritable, passesFence } from "@/platform/auth/test-session-access";
import { createAdminClient } from "@/platform/supabase/admin";
import { p, type Pair } from "@/vx/text";
import { classesFor, listExams, papersOf, studentsByIds } from "@/vx/screens/exams/data";
import { classTestById } from "@/vx/screens/exams/class-tests-data";
import { classSubjectTargets, defaultTitle, NEW_TEST_PROBLEM, newTestProblem, type ClassTest, type NewTestInput } from "@/vx/screens/exams/domain/class-tests";
import { isManager, previewRefusal } from "@/vx/screens/exams/guards";
import { refusal } from "@/vx/screens/exams/marks-save";
import type { ActionResult, SaveOutcome, SavePayload } from "@/vx/screens/exams/save-types";

/*
 * Class tests (D-609): make one, save its marks, say which school exam it
 * counts in, take it off the list. Each checks the permission, then that an
 * administrator is not previewing, then that the test is this person's:
 * whoever made it, a teacher of that class and subject, or the exam office.
 * `save_class_test_marks` checks the roll, the marks and the counts again in
 * the transaction that writes.
 */

const NOT_YOURS: Pair = p("This test is not yours — its subject teacher enters these marks.", "यह टेस्ट आपका नहीं है — इसके अंक विषय-अध्यापक भरेंगे।");

const TEST_REFUSALS: Record<string, Pair> = {
  paper_submitted: p("This test is finished. Tap “Change marks” first.", "यह टेस्ट पूरा हो चुका है। पहले “अंक बदलें” दबाएँ।"),
  not_on_roster: p("That child is not in this class on the test day.", "यह बच्चा टेस्ट के दिन इस कक्षा में नहीं है।"),
  not_found: p("This test was not found. It may have been removed.", "यह टेस्ट नहीं मिला। शायद हटा दिया गया है।"),
  incomplete: p("Some children still have no mark. Enter a mark or tap Absent.", "कुछ बच्चों के अंक अभी नहीं भरे। अंक भरें या “अनुपस्थित” दबाएँ।"),
};

const words = (reason: string): Pair => TEST_REFUSALS[reason] ?? refusal(reason);

function refreshScreens() {
  revalidatePath("/teach", "layout");
  revalidatePath("/exams");
}

async function mayEnterTest(staff: CurrentStaff, test: ClassTest): Promise<boolean> {
  // The test's own session first (Phase 3 fence): test accounts stay in the TEST year.
  if (!(await passesFence(() => assertSessionWritable(staff, test.sessionLabel)))) return false;
  if (isManager(staff)) return true;
  if (test.createdBy === staff.id) return true;
  return isAssignedTo({ staffProfileId: staff.id, sessionLabel: test.sessionLabel, classId: test.classId, subjectId: test.subjectId });
}

/** The exams this class-subject's tests may count in, by the shared rule. */
async function targetsFor(sessionLabel: string, classId: string, subjectId: string) {
  const exams = await listExams(sessionLabel);
  const papers = await papersOf(exams.map((e) => e.id));
  return classSubjectTargets(exams, papers, classId, subjectId);
}

export async function createClassTestAction(input: NewTestInput): Promise<ActionResult> {
  const staff = await assertPermission("marks:write");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { ok: false, message: p("No session is set up yet.", "अभी कोई सत्र नहीं है।") };
  const today = schoolToday();
  const problem = newTestProblem(input, today);
  if (problem) return { ok: false, message: NEW_TEST_PROBLEM[problem] };
  // The class's own session, not only the resolved one: a test account never makes a test on a real class.
  if (!(await passesFence(() => assertClassVisible(staff, input.classId)))) return { ok: false, message: NEW_TEST_PROBLEM.pick_class };

  if (!isManager(staff) && !(await isAssignedTo({ staffProfileId: staff.id, sessionLabel, classId: input.classId, subjectId: input.subjectId }))) {
    return { ok: false, message: p("You do not teach this subject in this class.", "आप इस कक्षा में यह विषय नहीं पढ़ाते।") };
  }

  const db = createAdminClient();
  const [classes, subject] = await Promise.all([
    classesFor(sessionLabel),
    db.from("subjects").select("code").eq("id", input.subjectId).maybeSingle<{ code: string }>(),
  ]);
  const klass = classes.find((c) => c.id === input.classId);
  if (!klass || !subject.data) return { ok: false, message: NEW_TEST_PROBLEM.pick_class };

  let countsIn: string | null = null;
  if (input.countsIn) {
    const targets = await targetsFor(sessionLabel, input.classId, input.subjectId);
    if (!targets.some((t) => t.id === input.countsIn)) return { ok: false, message: p("That exam cannot take class tests.", "उस परीक्षा में कक्षा टेस्ट नहीं जुड़ सकते।") };
    countsIn = input.countsIn;
  }

  const heldOn = input.heldOn ?? today;
  const title = (input.title ?? "").trim() || defaultTitle(heldOn);
  const { data, error } = await db
    .from("class_tests")
    .insert({
      session_label: sessionLabel,
      class_id: klass.id,
      class_label: klass.label,
      subject_id: input.subjectId,
      subject_code: subject.data.code,
      title,
      held_on: heldOn,
      max_marks: input.maxMarks,
      mark_step: Number.isInteger(input.maxMarks) ? 1 : 0.5,
      counts_in: countsIn,
      created_by: staff.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return { ok: false, message: p("The test was not made. Try again.", "टेस्ट नहीं बना। फिर से कोशिश करें।") };
  refreshScreens();
  return { ok: true, data: { id: data.id } };
}

export async function saveClassTestMarksAction(payload: SavePayload): Promise<SaveOutcome> {
  const staff = await assertPermission("marks:write");
  const preview = await previewRefusal();
  if (preview) return { ok: false, reason: "preview", message: preview };

  const test = await classTestById(payload.paperId).catch(() => null);
  if (!test) return { ok: false, reason: "not_found", message: words("not_found") };
  if (!(await mayEnterTest(staff, test))) return { ok: false, reason: "not_permitted", message: NOT_YOURS };

  // A correction to a finished test is "Change marks" then finish again: one path, not two.
  const kind = payload.kind === "correction" ? "submit" : payload.kind;
  const { data, error } = await createAdminClient().rpc("save_class_test_marks", {
    p: {
      actor_staff_id: staff.id,
      test_id: test.id,
      kind,
      entries: payload.entries.map((e) => ({ student_id: e.studentId, state: e.state === "exempt" ? "blank" : e.state, value: e.state === "value" ? e.value : null })),
    },
  });
  if (error) return { ok: false, reason: "failed", message: refusal("failed") };
  const row = data as {
    ok: boolean;
    reason?: string;
    student_id?: string;
    blank?: string[];
    revision?: number;
    entry_status?: "open" | "submitted";
    saved_at?: string;
    changed?: number;
    counts?: { entered: number; absent: number; exempt: number; blank: number; total: number };
  };
  if (!row.ok) {
    const reason = row.reason ?? "failed";
    const ids = row.blank ?? (row.student_id ? [row.student_id] : []);
    const names = ids.length ? await studentsByIds(ids).catch(() => new Map()) : new Map();
    return { ok: false, reason, message: words(reason), who: ids.map((id) => names.get(id)?.name ?? "—") };
  }
  refreshScreens();
  return {
    ok: true,
    revision: Number(row.revision),
    entryStatus: row.entry_status ?? "open",
    savedAt: row.saved_at ?? new Date().toISOString(),
    actorName: staff.displayName,
    changed: row.changed ?? 0,
    counts: row.counts ?? null,
  };
}

/** Which school exam a test counts in, or none ("progress only"). */
export async function setClassTestCountAction(input: { testId: string; countsIn: string | null }): Promise<ActionResult> {
  const staff = await assertPermission("marks:write");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  const test = await classTestById(input.testId).catch(() => null);
  if (!test) return { ok: false, message: words("not_found") };
  if (!(await mayEnterTest(staff, test))) return { ok: false, message: NOT_YOURS };
  if (input.countsIn) {
    const targets = await targetsFor(test.sessionLabel, test.classId, test.subjectId);
    if (!targets.some((t) => t.id === input.countsIn)) return { ok: false, message: p("That exam cannot take class tests.", "उस परीक्षा में कक्षा टेस्ट नहीं जुड़ सकते।") };
  }
  const { error } = await createAdminClient().from("class_tests").update({ counts_in: input.countsIn }).eq("id", test.id).is("removed_at", null);
  if (error) return { ok: false, message: p("Not saved. Try again.", "सहेजा नहीं गया। फिर से कोशिश करें।") };
  refreshScreens();
  return { ok: true };
}

/** Take a test off the lists. The test and its marks stay on record. */
export async function removeClassTestAction(testId: string): Promise<ActionResult> {
  const staff = await assertPermission("marks:write");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  const test = await classTestById(testId).catch(() => null);
  if (!test) return { ok: false, message: words("not_found") };
  if (!(await passesFence(() => assertSessionWritable(staff, test.sessionLabel)))) return { ok: false, message: NOT_YOURS };
  if (test.createdBy !== staff.id && !isManager(staff)) return { ok: false, message: p("Only the teacher who made this test can take it off the list.", "यह टेस्ट केवल बनाने वाले अध्यापक ही सूची से हटा सकते हैं।") };
  const { error } = await createAdminClient()
    .from("class_tests")
    .update({ removed_at: new Date().toISOString(), removed_by: staff.id })
    .eq("id", test.id)
    .is("removed_at", null);
  if (error) return { ok: false, message: p("Not removed. Try again.", "हटाया नहीं गया। फिर से कोशिश करें।") };
  refreshScreens();
  return { ok: true };
}
