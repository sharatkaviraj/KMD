"use server";
import { revalidatePath } from "next/cache";
import { executeBoardCommand } from "@/modules/official-results/data/commands";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertNotPreviewing } from "@/vx/view-as";
async function save(kind: "cycle" | "candidate" | "readiness" | "result", input: unknown, evidence?: File) {
 try {
  const receipt = await executeBoardCommand(kind, input, evidence);
  revalidatePath("/exam-office/board"); revalidatePath("/exam-office/official-results"); revalidatePath("/calendar");
  return { ok: true as const, receipt };
 } catch { return { ok: false as const }; }
}
export async function saveBoardCycleAction(input: unknown) {
 await assertPermission("outcomes:manage"); await assertNotPreviewing();
 return save("cycle", input);
}
export async function saveBoardCandidateAction(input: unknown) {
 await assertPermission("outcomes:manage"); await assertNotPreviewing();
 return save("candidate", input);
}
export async function saveBoardReadinessAction(input: unknown) {
 await assertPermission("outcomes:manage"); await assertNotPreviewing();
 return save("readiness", input);
}
export async function saveOfficialResultAction(form: FormData) {
 await assertPermission("outcomes:manage"); await assertNotPreviewing();
 let input: unknown; try { input = JSON.parse(String(form.get("input"))); } catch { return { ok: false as const }; }
 const file = form.get("evidence");
 return save("result", input, file instanceof File ? file : undefined);
}
