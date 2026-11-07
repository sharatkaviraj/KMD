import "server-only";

import { cookies } from "next/headers";

import { insideStaffResolution } from "@/platform/auth/staff-resolution-context";
import { verifiedActorInContext } from "@/platform/auth/verified-actor-context";
import { readViewAsPerson, VIEW_AS_PERSON_COOKIE } from "@/platform/auth/view-as-cookie";
import { READ_ONLY_FUNCTIONS } from "@/platform/auth/view-as-read-only-functions";
import {
  classifyViewAsRequest,
  VIEW_AS_HEADER,
  VIEW_AS_READ_ONLY,
  VIEW_AS_REFUSAL_CODE,
} from "@/platform/auth/view-as-requests";
import { rethrowNextSignal } from "@/platform/helpers/next-signals";
import { flat, type Language } from "@/platform/i18n/language";

type Options = {
  /**
   * The view-as cookie of the request this client serves, when the client
   * already holds that request's cookie store (the signed-in person's own
   * client). Without it the cookie is read only when a save needs deciding.
   */
  cookie?: () => string | null | undefined;
  /**
   * Draw reads as the chosen person: send `x-vx-view-as` so the database's
   * row security answers as them (`vppsone.view_as_subject_id()`). Only for
   * the signed-in person's own client; the service role is not row-secured.
   */
  drawAsChosen?: boolean;
};

/**
 * The data clients' half of "see One as a person" (D-544): while an
 * administrator is looking at One as somebody else, nothing is saved.
 *
 * `assertNotPreviewing()` refuses at the top of a write with a clear message,
 * and the screens hide their buttons; this is the lock underneath both, on
 * every Supabase client the server makes — One's own and the fee module's, the
 * signed-in person's and the service role — so a save that forgot to ask is
 * refused all the same. Reads pass (`platform/auth/view-as-requests.ts` says
 * which requests are reads); a save is refused only once the request's staff
 * resolution confirms the view is really on, so a cookie that outlived its
 * view, or belongs to somebody else, changes nothing.
 *
 * Nobody else pays for it: a request that is not a save goes straight through
 * on the service role, and the signed-in person's client reads one cookie it
 * already holds.
 *
 * `underlying` is called, never captured as `globalThis.fetch` here, for the
 * reason given in `guarded-fetch.ts`.
 */
export function createViewAsGuardedFetch(underlying: typeof fetch, options: Options = {}): typeof fetch {
  return async function viewAsGuardedFetch(input, init) {
    if (insideStaffResolution() || verifiedActorInContext()) return underlying(input, init);

    const request = input instanceof Request ? input : null;
    const url = request ? request.url : input.toString();
    const kind = classifyViewAsRequest(url, init?.method ?? request?.method, READ_ONLY_FUNCTIONS);
    if (kind === "auth" || kind === "control") return underlying(input, init);

    if (kind === "read") {
      if (!options.drawAsChosen || !options.cookie) return underlying(input, init);
      const chosen = readViewAsPerson(readCookie(options.cookie));
      if (!chosen) return underlying(input, init);
      const headers = new Headers(init?.headers ?? request?.headers);
      headers.set(VIEW_AS_HEADER, chosen.subjectId);
      return underlying(input, { ...init, headers });
    }

    const raw = options.cookie ? readCookie(options.cookie) : await requestCookie();
    if (!readViewAsPerson(raw)) return underlying(input, init);
    const viewing = await viewingAsLanguage();
    if (viewing === false) return underlying(input, init);
    return refusal(viewing);
  };
}

function readCookie(read: () => string | null | undefined): string | null {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}

/** The cookie, or null outside a request (a cron, a cached scope, a script). */
async function requestCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(VIEW_AS_PERSON_COOKIE)?.value ?? null;
  } catch (error) {
    rethrowNextSignal(error);
    return null;
  }
}

/**
 * The administrator's language while the view is really on; false when it is
 * not. A failure to tell refuses: the cookie is there, and a save that cannot
 * prove it is the administrator's own is not made.
 */
async function viewingAsLanguage(): Promise<Language | false> {
  try {
    const { getCurrentStaff } = await import("@/platform/auth/current-staff");
    const staff = await getCurrentStaff();
    return staff?.viewedBy ? staff.viewedBy.language : false;
  } catch (error) {
    rethrowNextSignal(error);
    return "both";
  }
}

function refusal(language: Language): Response {
  return Response.json(
    { code: VIEW_AS_REFUSAL_CODE, message: flat(VIEW_AS_READ_ONLY, language), details: null, hint: null },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
