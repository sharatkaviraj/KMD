import { createHash } from "node:crypto";
import { certificateForViewer, CERTIFICATES_BUCKET } from "@/modules/certificates/data/repo";
import { validCertificatePdf } from "@/modules/certificates/domain/issue-flow";
import { createAdminClient } from "@/platform/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Always the stored original; a GET cannot issue a new certificate or sign it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const issue = await certificateForViewer((await params).id);
    if (!issue) return new Response("Not found", { status: 404 });
    if (issue.artifact_state !== "ready" || !issue.storage_path || !issue.artifact_sha256) return new Response("Certificate is not ready. Retry from its register entry.", { status: 409 });
    const { data, error } = await createAdminClient().storage.from(CERTIFICATES_BUCKET).download(issue.storage_path);
    if (error || !data) return new Response("Certificate storage is unavailable. Try again.", { status: 503 });
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (!validCertificatePdf(bytes) || createHash("sha256").update(bytes).digest("hex") !== issue.artifact_sha256) return new Response("Certificate integrity check failed.", { status: 503 });
    const name = issue.serial.replace(/[^a-z0-9-]/gi, "_");
    return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${new URL(request.url).searchParams.has("download") ? "attachment" : "inline"}; filename="${name}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" } });
  } catch { return new Response("Certificate is unavailable for this account.", { status: 403 }); }
}
