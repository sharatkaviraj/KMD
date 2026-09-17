import { redirect } from "next/navigation";

import { signedDocumentUrl } from "@/modules/collection/data/documents-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open one document.
 *
 * A redirect to a signed URL that lasts a minute, minted **after** a
 * permission check — which lives inside `signedDocumentUrl()` rather than
 * here, because that is the function that hands out the capability and a
 * capability minted without a check is the whole risk, whatever the route
 * above it believed.
 *
 * Under `(app)`, so the proxy has already established there is a session
 * before this runs at all.
 *
 * The redirect rather than proxying the bytes: Supabase serves the file from
 * storage with the right headers and range support, and streaming it through
 * here would put a school's PDFs through a serverless function for no gain.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const url = await signedDocumentUrl(id);

  // Same answer for "no such document" and "the storage object has gone":
  // neither is something the caller can act on, and telling them apart says
  // more about what exists than it needs to.
  if (!url) redirect("/access-denied?permission=documents%3Aview");

  redirect(url);
}
