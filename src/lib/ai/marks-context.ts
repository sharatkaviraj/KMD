import "server-only";

import { createHash } from "node:crypto";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { isAssignedTo } from "@/modules/assessments/data/assessments-repo";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { TEST_SESSION_LABEL } from "@/platform/auth/test-session-policy";
import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { paperById } from "@/vx/screens/exams/data";
import { previewRefusal } from "@/vx/screens/exams/guards";

import type { PhotoStudent } from "@/lib/ai/marks-review";

export async function marksPhotoContext(staff: CurrentStaff, paperId: string) {
  if (!staff.isTestAccount || !can(staff, "marks:write") || await previewRefusal()) return null;
  const session = await resolveSessionLabel();
  if (session !== TEST_SESSION_LABEL) return null;
  const paper = await paperById(paperId);
  if (!paper) return null;
  const db = createAdminClient();
  const [exam, assigned, locked] = await Promise.all([
    db.from("assessments").select("status").eq("id", paper.assessment_id)
      .eq("session_label", session).maybeSingle<{ status: string }>(),
    isAssignedTo({ staffProfileId: staff.id, sessionLabel: session, classId: paper.class_id, subjectId: paper.subject_id }),
    db.from("exam_class_locks").select("class_id").eq("assessment_id", paper.assessment_id)
      .eq("class_id", paper.class_id).maybeSingle(),
  ]);
  if (exam.error || locked.error) throw new Error("Could not verify marks paper");
  if (!assigned || !exam.data || exam.data.status !== "open" || locked.data || paper.entry_status !== "open") return null;
  const rule = { max: Number(paper.max_marks), step: Number(paper.mark_step) };
  if (!Number.isFinite(rule.max) || rule.max <= 0 || !Number.isFinite(rule.step) || rule.step <= 0) return null;
  return { paper, rule, session };
}

export type MarksPhotoContext = NonNullable<Awaited<ReturnType<typeof marksPhotoContext>>>;

export async function loadPhotoRoster({ paper, session, rule }: MarksPhotoContext) {
  const db = createAdminClient();
  const [roster, rolls] = await Promise.all([
    db.rpc("paper_roster", { p_paper: paper.id }),
    db.from("enrolments").select("student_id, roll_no")
      .eq("session_label", session).eq("class_id", paper.class_id)
      .returns<{ student_id: string; roll_no: string | null }[]>(),
  ]);
  if (roster.error || rolls.error || !Array.isArray(roster.data)) throw new Error("Could not verify marks roster");
  const ids = (roster.data as string[]).filter(Boolean);
  if (!ids.length || ids.length > 120) return null;
  const rollOf = new Map(rolls.data.map((s) => [s.student_id, s.roll_no]));
  // Check the student's own current class too: a mistaken TEST enrolment
  // must not put a real-session name into the pilot's provider request.
  const names = await fetchInChunks<{ id: string; full_name: string }>(
    ids, IN_FILTER_CHUNK_SIZE, (chunk) => db.schema(FEE_SCHEMA).from("students")
      .select("id, full_name, class:classes!students_class_id_fkey!inner(session_label)")
      .eq("class.session_label", session).in("id", chunk),
  );
  if (names.error) throw new Error("Could not verify student session");
  const nameOf = new Map(names.data.map((student) => [student.id, student.full_name]));
  if (ids.some((id) => !nameOf.get(id))) return null;
  const students: PhotoStudent[] = ids.map((id) => ({
    id, name: nameOf.get(id)!, roll: rollOf.get(id) ?? null,
  })).sort((a, b) => (Number(a.roll ?? Infinity) - Number(b.roll ?? Infinity)) || a.id.localeCompare(b.id));
  const stamp = createHash("sha256").update(JSON.stringify({ rule, students })).digest("hex");
  return { students, stamp };
}
