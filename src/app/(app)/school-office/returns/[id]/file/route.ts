import { hashBytes, readOfficeArtifact, returnBatchForViewer } from "@/modules/government-records/data/repo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const batch = await returnBatchForViewer((await params).id) as (Awaited<ReturnType<typeof returnBatchForViewer>> & { content_type?: string; evidence_sha256?: string; evidence_name?: string; evidence_content_type?: string });
    if (!batch) return new Response("Not found", { status: 404 });
    const evidence = new URL(request.url).searchParams.has("evidence"), path = evidence ? batch.evidence_path : batch.file_path;
    const expected = evidence ? batch.evidence_sha256 : batch.file_sha256;
    if (!path || !expected) return new Response("File is not ready", { status: 409 });
    const bytes = await readOfficeArtifact(path);
    if (!bytes || hashBytes(bytes) !== expected) return new Response("File unavailable or integrity check failed", { status: 503 });
    const name = (evidence ? batch.evidence_name : batch.file_name) || "school-office-file";
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": (evidence ? batch.evidence_content_type : batch.content_type) || "application/octet-stream", "Content-Disposition": `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" } });
  } catch { return new Response("File is unavailable for this account", { status: 403 }); }
}
