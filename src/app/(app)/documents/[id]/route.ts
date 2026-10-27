import { redirect } from "next/navigation";

import {
  documentResponseHeaders,
  displayFileName,
  withExtension,
  type AllowedDocumentType,
} from "@/modules/collection/domain/document-files";
import { ALLOWED_DOCUMENT_TYPES } from "@/modules/collection/domain/review";
import { driveDocumentBytes } from "@/modules/collection/data/drive-documents";
import {
  openableDocument,
  signedDocumentUrl,
  type OpenableDocument,
} from "@/modules/collection/data/documents-repo";
import { DriveError } from "@/platform/google/drive";
import { vercelOidcToken } from "@/platform/google/vercel-oidc";
import { attachmentDisposition, inlineDisposition } from "@/platform/helpers/content-disposition";
import { logError } from "@/platform/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The stream runs at the reader's speed: 10 MB on a 1 Mbps phone link is
// about 80 seconds, so a minute would cut the file off part-way.
export const maxDuration = 300;

const DENIED = "/access-denied?permission=documents%3Aview";

/**
 * Open one document.
 *
 * `openableDocument()` reads the row **as the person asking**, so the
 * permission and the class scope are both the database's answer. A document
 * id copied out of a URL, a screenshot or a log is therefore no use to anyone
 * the listing would not have shown it to — and nothing else names the file.
 *
 * Under `(app)`, so the proxy has already established there is a session
 * before this runs at all.
 *
 * Two stores, two ways out (D-333):
 *
 *  - **Supabase bucket**: a redirect to a signed URL that lasts a minute.
 *    Supabase serves the file with range support, and streaming it through
 *    here would put a school's PDFs through a serverless function for no gain.
 *  - **Google Drive**: streamed through here. Drive has no signed URL that
 *    works without a Google account, and the files are shared with nobody but
 *    the school, so the bytes come through VPPS One with `private, no-store`.
 *    Vercel's 4.5 MB response cap does not apply to a streamed body.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let document: OpenableDocument | null;
  try {
    document = await openableDocument(id);
  } catch {
    redirect(DENIED);
  }
  // Same answer for "no such document", "not yours" and "the file has gone":
  // none is something the caller can act on, and telling them apart says more
  // about what exists than it needs to.
  if (!document) redirect(DENIED);

  if (document.provider === "supabase") {
    const url = await signedDocumentUrl(document);
    if (!url) redirect(DENIED);
    redirect(url);
  }

  if (!document.driveFileId || !(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(document.contentType)) {
    redirect(DENIED);
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  // The saved file's extension is the checked type's, whatever it was called
  // on upload: a "report.html" that is really a PDF is saved as report.pdf.
  const name = withExtension(displayFileName(document.fileName), document.contentType as AllowedDocumentType);

  let upstream: Response;
  try {
    upstream = await driveDocumentBytes(document.driveFileId, request.headers.get("range"), await vercelOidcToken(request));
  } catch (error) {
    logError("documents.drive.read-failed", {
      documentId: document.id,
      kind: error instanceof DriveError ? error.kind : "other",
      cause: error,
    });
    return new Response("This document cannot be opened right now. Try again in a minute.", {
      status: error instanceof DriveError && error.kind === "rate_limited" ? 429 : 503,
      headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "retry-after": "30" },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers: documentResponseHeaders({
      contentType: document.contentType as AllowedDocumentType,
      disposition: download ? attachmentDisposition(name, "document") : inlineDisposition(name),
      contentLength: upstream.headers.get("content-length"),
      contentRange: upstream.headers.get("content-range"),
    }),
  });
}
