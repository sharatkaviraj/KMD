import { listCertificateRequests, requestableKinds } from "@/modules/certificates/data/requests";
import { requestListSchema } from "@/modules/certificates/domain/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The asker's certificate requests: `?scope=mine&session=` for Today, or
 * `?scope=student&session=&student=` for one child, with the documents the
 * request sheet may offer. Read in the browser after the page has drawn, so
 * a slow read never holds up the teacher's screen.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = requestListSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  try {
    const [rows, kinds] = await Promise.all([
      listCertificateRequests(parsed.data.scope, parsed.data.session, parsed.data.student),
      parsed.data.scope === "student" ? requestableKinds() : Promise.resolve([]),
    ]);
    return Response.json({ rows: rows.map((row) => ({ ...row, fatherName: null, dateOfBirth: null })), kinds }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "unavailable" }, { status: 403 }); }
}
