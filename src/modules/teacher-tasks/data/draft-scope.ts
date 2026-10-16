import "server-only";
import { createHash } from "node:crypto";

/** Opaque browser namespace; never expose the capability in signed-in props. */
export function academicDraftScope(input: { taskId: string; actorId: string | null; token: string; session: string; scope: unknown; studentIds: string[] }) {
  return createHash("sha256").update(JSON.stringify([
    input.taskId, input.actorId ?? "public", input.token, input.session,
    input.scope, [...input.studentIds].sort(),
  ])).digest("hex");
}
