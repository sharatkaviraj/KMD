import "server-only";

import { randomBytes } from "node:crypto";

import { isAssignedTo } from "@/modules/assessments/data/assessments-repo";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { createAdminClient } from "@/platform/supabase/admin";
import { p, type Pair } from "@/vx/text";
import { assertNotPreviewing } from "@/vx/view-as";

import type { PaperRow } from "./data";

/*
 * The checks the exam screens make after the permission and before a write.
 * The database makes the marks checks again; these are what turn a refusal
 * into words a person can act on.
 */

export const PREVIEW_REFUSAL: Pair = p(
  "You are seeing the app as another role. Switch back to make changes.",
  "आप ऐप किसी और भूमिका से देख रहे हैं। बदलाव के लिए वापस अपनी भूमिका पर आएँ।",
);

/** `assertNotPreviewing()`, answered as words rather than a thrown error. */
export async function previewRefusal(): Promise<Pair | null> {
  try {
    await assertNotPreviewing();
    return null;
  } catch {
    return PREVIEW_REFUSAL;
  }
}

export function isManager(staff: CurrentStaff): boolean {
  return can(staff, "assessments:manage");
}

/** Whether this person may enter this paper: the exam office, or its subject teacher. */
export async function mayEnterPaper(staff: CurrentStaff, paper: PaperRow, sessionLabel: string): Promise<boolean> {
  if (isManager(staff)) return true;
  if (!can(staff, "marks:write")) return false;
  return isAssignedTo({ staffProfileId: staff.id, sessionLabel, classId: paper.class_id, subjectId: paper.subject_id });
}

/** The classes this person is class teacher of this session. */
export async function classTeacherOf(staffId: string, sessionLabel: string): Promise<string[]> {
  const { data, error } = await createAdminClient()
    .from("class_teachers")
    .select("class_id")
    .eq("session_label", sessionLabel)
    .eq("staff_profile_id", staffId)
    .eq("role", "class_teacher")
    .is("effective_to", null)
    .returns<{ class_id: string }[]>();
  if (error) throw new Error(`Could not read your class: ${error.message}`);
  return [...new Set(data.map((r) => r.class_id))];
}

/** A marks-link token: 16 random bytes, URL-safe. */
export function newToken(): string {
  return randomBytes(16).toString("base64url");
}

export const NOT_YOURS: Pair = p(
  "This paper is not yours — its subject teacher enters these marks.",
  "यह पेपर आपका नहीं है — इसके अंक विषय-अध्यापक भरेंगे।",
);
