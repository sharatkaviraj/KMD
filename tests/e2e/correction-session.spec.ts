import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db, ownClassOf, signIn, unrecordedSchoolDays } from "./support/harness";

test("the correction queue shows only the selected academic session", async ({ page }) => {
  const scene = await ownClassOf("teacher");
  const [day] = await unrecordedSchoolDays(scene.classId, scene.sessionLabel, 1, 50);
  const run = randomUUID();
  const registerIds = [randomUUID(), randomUUID()];
  const currentReason = `QA current session ${run}`;
  const otherReason = `QA different session ${run}`;
  const { data: child, error: childError } = await db().from("enrolments")
    .select("student_id").eq("class_id", scene.classId).eq("session_label", scene.sessionLabel)
    .eq("status", "enrolled").limit(1).single();
  if (childError) throw new Error(childError.message);

  try {
    const { error: registerError } = await db().from("attendance_registers").insert(registerIds.map((id, index) => ({
      id, class_id: scene.classId, day,
      session_label: index === 0 ? scene.sessionLabel : `QA-${run}`,
    })));
    if (registerError) throw new Error(registerError.message);
    const { error: correctionError } = await db().from("attendance_corrections").insert(registerIds.map((id, index) => ({
      register_id: id, student_id: child.student_id,
      from_status: "present", to_status: "absent", requested_by: scene.staffProfileId,
      reason: index === 0 ? currentReason : otherReason,
    })));
    if (correctionError) throw new Error(correctionError.message);

    await signIn(page, "office", "/teach/corrections");
    await expect(page.getByText(currentReason, { exact: true })).toBeVisible();
    await expect(page.getByText(otherReason, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(currentReason, { exact: true })).toBeVisible();
    await expect(page.getByText(otherReason, { exact: true })).toHaveCount(0);
  } finally {
    // Deleting only this run's registers cascades its correction rows.
    const { error } = await db().from("attendance_registers").delete().in("id", registerIds);
    if (error) throw new Error(`Could not clean up correction session fixtures: ${error.message}`);
  }
});
