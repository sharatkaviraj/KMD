import { classifyViewAsRequest, VIEW_AS_READ_ONLY, VIEW_AS_REFUSAL_CODE } from "@/platform/auth/view-as-requests";

/**
 * Set on `<html>` while an administrator sees One as a chosen person (D-544),
 * by the amber frame the shell draws round the screen then.
 */
export const VIEW_AS_DOCUMENT_FLAG = "data-vx-view-as";

/**
 * The browser clients' half of the look-only rule. Almost every save goes
 * through the server, whose clients refuse it (`view-as-guard.ts`); the few
 * that go straight from the browser are file uploads (a voice note, a
 * student's photo, a picture for the AI helper). While the flag is on, those
 * are refused here before they leave the phone, so looking at somebody's
 * screens never leaves a file behind in their name. Reads, sign-in and
 * realtime are untouched.
 */
export function viewAsBrowserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof document !== "undefined" && document.documentElement.hasAttribute(VIEW_AS_DOCUMENT_FLAG)) {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
    const url = request ? request.url : input.toString();
    if (classifyViewAsRequest(url, init?.method ?? request?.method) === "write") {
      // `new Response`, not `Response.json`: the static one is missing on older iPhones.
      const body = JSON.stringify({ code: VIEW_AS_REFUSAL_CODE, message: VIEW_AS_READ_ONLY.en, error: VIEW_AS_READ_ONLY.en, statusCode: "403" });
      return Promise.resolve(new Response(body, { status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }));
    }
  }
  return fetch(input, init);
}
