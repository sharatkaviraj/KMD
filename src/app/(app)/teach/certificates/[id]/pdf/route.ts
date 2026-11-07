import { requestDocumentBytes } from "@/modules/certificates/data/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed original behind an approved request, for the teacher who asked
 * (or an approver). Always the stored bytes, checked against their recorded
 * hash; a GET can never issue, sign or re-render a certificate.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await requestDocumentBytes((await params).id);
    if ("code" in result) {
      const status = result.code === "not_ready" ? 409 : result.code === "unavailable" ? 503 : result.code === "invalid" ? 404 : 403;
      return new Response(status === 409 ? "This certificate is not ready yet." : status === 503 ? "Certificate storage is unavailable. Try again." : "Certificate is unavailable for this account.", { status });
    }
    const name = result.serial.replace(/[^a-z0-9-]/gi, "_");
    return new Response(result.bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${new URL(request.url).searchParams.has("download") ? "attachment" : "inline"}; filename="${name}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" } });
  } catch { return new Response("Certificate is unavailable for this account.", { status: 403 }); }
}
