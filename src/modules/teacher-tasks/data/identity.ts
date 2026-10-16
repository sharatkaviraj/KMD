import "server-only";
import { createHash } from "node:crypto";
/** Mirrors create_teacher_tasks; the full immutable roster remains in members. */
export function collectionTaskSourceKey(session:string,studentIds:readonly string[],fieldIds:readonly string[]):string {
  const list=(ids:readonly string[])=>[...new Set(ids.map(id=>id.toLowerCase()))].sort().join(",");
  return `collection:${session}:${createHash("md5").update(`${list(studentIds)}:${list(fieldIds)}`).digest("hex")}`;
}
