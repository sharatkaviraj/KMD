import { z } from "zod";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionVisible } from "@/platform/auth/test-session-access";
import { createClient } from "@/platform/supabase/server";
import { readOfficeArtifact, hashBytes } from "@/modules/government-records/data/repo";
import { boardCycle } from "@/modules/official-results/data/repo";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
 try {
  const staff = await assertPermission("outcomes:view"), { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  const { data, error } = await (await createClient()).from("school_official_results").select("cycle_id,evidence_path,evidence_sha256,evidence_type").eq("id", id).maybeSingle();
  if (error) return new Response(null, { status: 503 });
  if (!data?.evidence_path) return new Response(null, { status: 404 });
  const cycle = await boardCycle(data.cycle_id); if (!cycle) return new Response(null, { status: 404 });
  await assertSessionVisible(staff, cycle.session_label);
  if (!data.evidence_path.startsWith(`board/${cycle.id}/`)) return new Response(null, { status: 404 });
  const bytes = await readOfficeArtifact(data.evidence_path);
  if (!bytes || hashBytes(bytes) !== data.evidence_sha256 || !["application/pdf", "image/png", "image/jpeg"].includes(data.evidence_type)) return new Response(null, { status: 503 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": data.evidence_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="official-result-${id}.${data.evidence_type === "application/pdf" ? "pdf" : data.evidence_type === "image/png" ? "png" : "jpg"}"` } });
 } catch { return new Response(null, { status: 404 }); }
}
