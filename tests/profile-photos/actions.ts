import type { PhotoCredential } from "../../src/modules/collection/domain/profile-photo";
declare global { interface Window { photoCalls: { command: string; bytes: number; scope: string }[]; photoOutcome: "ok" | "unknown" | "stale" } }
export async function openPhotoEditorAction(credential: PhotoCredential, studentId?: string) {
  return { ok: true as const, credential, context: { scope: `synthetic:${JSON.stringify(credential)}`, studentId, currentId: null, currentUrl: null, proposalId: null, proposalUrl: null, decided: false, proposal: credential.kind === "task" || credential.kind === "request" } };
}
export async function saveProfilePhotoAction(_credential: PhotoCredential, form: FormData) {
  window.photoCalls.push({ command: String(form.get("commandId")), bytes: (form.get("photo") as File).size, scope: String(form.get("scope")) });
  return window.photoOutcome === "ok" ? { ok: true as const } : { ok: false as const, reason: window.photoOutcome };
}
export async function reviewPhotoAction() { return { ok: true as const }; }
export async function submitAnswersAction() { return {status:"saved",message:null}; }
