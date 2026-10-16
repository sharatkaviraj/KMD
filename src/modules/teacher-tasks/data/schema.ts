import "server-only";
/** Only an absent additive table means the feature is not installed yet.
 * Other database/permission/network errors must remain visible. */
export function taskSchemaMissing(error: {code?:string;message?:string}|null):boolean {
  return Boolean(error && ["42P01","PGRST205"].includes(error.code??"") && error.message?.includes("teacher_tasks"));
}
