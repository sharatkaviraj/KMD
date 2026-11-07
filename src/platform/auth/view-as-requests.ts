/**
 * Which database requests may run while an administrator sees One as a chosen
 * member of staff (D-544), and which are refused because they would save
 * something. Pure, so the rule is pinned by tests rather than read out of a
 * fetch wrapper (`platform/supabase/view-as-guard.ts` applies it).
 *
 *  - auth     `/auth/v1/*`: the administrator's own session (refresh, claims,
 *             sign-out). Always passes, never drawn as anybody else.
 *  - control  the two functions that start and end the view. They act only on
 *             the administrator's own grant row (`auth.uid()`), so they pass.
 *  - read     a GET or HEAD; a call to a function the database runs read-only
 *             (STABLE or IMMUTABLE), or to one of the two checked to write
 *             nothing — when the caller passes that list; signing or listing
 *             stored files. Reads pass, and on the signed-in person's own
 *             client they carry `x-vx-view-as` so row security answers as the
 *             chosen person.
 *  - write    everything else: a table insert, update or delete, every other
 *             function, an upload. Refused while the view is on.
 *
 * Anything this does not recognise is a write. A read that is missed only
 * shows an error while somebody is being looked at; a write that is missed
 * would be saved under the administrator's name while they look at somebody
 * else, which is the thing this exists to prevent.
 */

import { viewAsPersonBelongsTo } from "@/platform/auth/view-as-cookie";

export type ViewAsRequestKind = "auth" | "control" | "read" | "write";

/** The header the database reads (`vppsone.view_as_subject_id()`). */
export const VIEW_AS_HEADER = "x-vx-view-as";

/** What a refused save says, in the administrator's language. */
export const VIEW_AS_READ_ONLY = {
  en: "Nothing was saved. You are seeing One as another person, so changes are switched off. Go back to your own view to make changes.",
  hi: "कुछ सहेजा नहीं गया। आप One को किसी और की नज़र से देख रहे हैं, इसलिए बदलाव बंद हैं। बदलाव करने के लिए अपने व्यू पर लौटें।",
} as const;

/** The code a refused request carries, so a caller can tell it from a fault. */
export const VIEW_AS_REFUSAL_CODE = "VXV01";


const NO_FUNCTIONS: ReadonlySet<string> = new Set();

/** Start and end the view: the administrator's own grant row, nobody else's. */
export const VIEW_AS_CONTROL_FUNCTIONS: ReadonlySet<string> = new Set(["view_as_begin", "view_as_end"]);

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** `/storage/v1/object/sign/…` (a signed link to read) and `/object/list/…`. */
function storageRead(path: string): boolean {
  return /^\/storage\/v1\/object\/(sign|list)\//.test(path) || path === "/storage/v1/object/sign";
}

/**
 * `readOnlyFunctions` is `READ_ONLY_FUNCTIONS` on the server
 * (`view-as-read-only-functions.ts`). The browser passes nothing: the list
 * stays out of every page's JavaScript, and a page has no function calls to
 * make while somebody is being looked at, so every one of them is a write.
 */
export function classifyViewAsRequest(
  url: string | URL,
  method: string | undefined,
  readOnlyFunctions: ReadonlySet<string> = NO_FUNCTIONS,
): ViewAsRequestKind {
  let path: string;
  try {
    path = (typeof url === "string" ? new URL(url) : url).pathname;
  } catch {
    return "write";
  }
  if (path.startsWith("/auth/v1/")) return "auth";
  const verb = (method ?? "GET").toUpperCase();
  const fn = /^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)\/?$/.exec(path)?.[1];
  if (fn && VIEW_AS_CONTROL_FUNCTIONS.has(fn)) return "control";
  if (READ_METHODS.has(verb)) return "read";
  if (verb !== "POST") return "write";
  if (fn) return readOnlyFunctions.has(fn) ? "read" : "write";
  if (storageRead(path)) return "read";
  return "write";
}

/**
 * The proxy's half: a request refused before any handler runs while the view
 * is on. Pages and server actions go on — some actions only read, and those
 * that save refuse themselves (`assertNotPreviewing()`, then the data
 * clients' lock). What is refused here is every other kind of save: a file
 * upload, an AI call, a command posted to an API route. The cookie must
 * belong to the person signed in, so a cookie left on a shared computer by
 * somebody else stops nobody.
 */
export function refusedWhileViewingAs(input: {
  method: string;
  pathname: string;
  serverAction: boolean;
  cookie: string | null | undefined;
  userId: string | null | undefined;
}): boolean {
  if (READ_METHODS.has(input.method.toUpperCase()) || input.serverAction) return false;
  if (!(input.pathname.startsWith("/api/") || input.pathname.startsWith("/documents/"))) return false;
  return viewAsPersonBelongsTo(input.cookie, input.userId);
}
