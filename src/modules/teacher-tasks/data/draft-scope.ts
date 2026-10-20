import "server-only";
import { createHash } from "node:crypto";

export function assignedRequestGeneration(actorId: string, requestId: string, requestToken: string) {
  return createHash("sha256").update(JSON.stringify(["assigned-request",actorId,requestId,requestToken])).digest("hex");
}

export function collectionDraftScope(input: { requestId: string; actorId: string | null; taskToken: string | null; requestToken: string; session: string; studentIds: string[]; fieldIds: string[] }) {
  return createHash("sha256").update(JSON.stringify([
    "collection", input.requestId, input.actorId ?? "public", input.taskToken,
    input.requestToken, input.session, [...input.studentIds].sort(), [...input.fieldIds].sort(),
  ])).digest("hex");
}

/** Opaque browser namespace; never expose the capability in signed-in props. */
export function academicDraftScope(input: { taskId: string; actorId: string | null; token: string; session: string; scope: unknown; studentIds: string[] }) {
  return createHash("sha256").update(JSON.stringify([
    input.taskId, input.actorId ?? "public", input.token, input.session,
    input.scope, [...input.studentIds].sort(),
  ])).digest("hex");
}
