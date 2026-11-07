import { z } from "zod";
import { listCertificates } from "@/modules/certificates/data/repo";
import { certificateSigned } from "@/modules/certificates/domain/certificate";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = z.object({ student: z.uuid(), session: z.string().regex(/^(?:TEST-)?\d{4}-\d{2}$/) }).safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    const data = await listCertificates(parsed.data.session, { studentId: parsed.data.student });
    return Response.json({ rows: data.rows.map(({ id, serial, status, kind, issued_at, artifact_state, snapshot }) => ({ id, serial, status, kind: kind ?? "study", issuedAt: issued_at, ready: artifact_state === "ready", signed: certificateSigned(snapshot) })), count: data.count }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "unavailable" }, { status: 403 }); }
}
