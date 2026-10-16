import "server-only";
import { m } from "@/messages";
import { rollForRequest } from "@/modules/collection/data/requests-repo";
import { recordAnswers, type IncomingAnswer } from "@/modules/collection/data/submissions-repo";
import { validateField } from "@/modules/collection/domain/fields";
import type { CollectionRequest } from "@/modules/collection/domain/requests";
import type { LinkState } from "@/modules/collection/domain/link-state";
/** Caller resolves either the current session assignment or the scoped public token. */
export async function submitCollectionPayload(request: CollectionRequest, payload: unknown): Promise<LinkState> {
  if (!Array.isArray(payload) || payload.length > 40000) return { status: "error", message: m.notSaved };
  const roll = await rollForRequest(request);
  const onRoll = new Map(roll.map(r => [r.studentId, r]));
  const fields = new Map(request.fields.map(f => [f.key, f]));
  const answers = new Map<string, IncomingAnswer>();
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") return { status: "error", message: m.notSaved };
    const { studentId, key, value } = entry;
    const row = onRoll.get(studentId); const field = fields.get(key);
    if (!row || !field || (typeof value !== "string" && value !== null)) return { status: "error", message: m.notSaved };
    const checked = validateField(field, value ?? "");
    if (!checked.ok) return { status: "error", message: checked.error };
    answers.set(`${studentId}:${field.id}`, { studentId, fieldId: field.id, value: checked.value, previousValue: row.current[field.key] ?? null });
  }
  try { await recordAnswers(request, [...answers.values()]); } catch { return { status: "error", message: m.notSaved }; }
  return { status: "saved", message: m.linkSaved };
}
