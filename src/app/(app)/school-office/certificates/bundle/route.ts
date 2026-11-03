import { certificatesByIds } from "@/modules/certificates/data/repo";
import { assertSessionVisible } from "@/platform/auth/test-session-access";
import { assertPermission } from "@/platform/auth/current-staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One file for the signing tray or a class batch. Each page is laid out from
 * that issue's frozen snapshot, exactly as its stored original; it allocates,
 * signs and records nothing.
 */
export async function GET(request: Request) {
  try {
    const staff = await assertPermission("certificates:view");
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
    const issues = (await certificatesByIds(ids)).filter((issue) => issue.artifact_state === "ready" && (issue.status === "prepared" || issue.status === "issued"));
    if (!issues.length) return new Response("Nothing to print", { status: 404 });
    for (const session of new Set(issues.map((issue) => issue.session_label))) await assertSessionVisible(staff, session);
    const { renderCertificateBundle } = await import("@/modules/certificates/ui/certificate-pdf");
    const bytes = await renderCertificateBundle(issues.map((issue) => issue.snapshot), `Certificates (${issues.length})`);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="certificates-${issues.length}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" } });
  } catch { return new Response("Certificates are unavailable for this account.", { status: 403 }); }
}
