import { allCertificateTemplates } from "@/modules/certificates/data/repo";
import { certificateKinds, offeredExtras, requiredExtras } from "@/modules/certificates/domain/certificate";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the certificate sheet may offer: active kinds and the few things each asks at the counter. */
export async function GET() {
  try {
    const templates = await allCertificateTemplates();
    const kinds = certificateKinds.flatMap((kind) => {
      const template = templates[kind];
      return template?.active ? [{ kind, titleEn: template.titleEn, titleHi: template.titleHi, language: template.language, required: requiredExtras(template, "historical"), offered: offeredExtras(template), purpose: kind === "study" || kind === "character" }] : [];
    });
    return Response.json({ kinds }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "unavailable" }, { status: 403 }); }
}
