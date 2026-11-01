import "server-only";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionVisible } from "@/platform/auth/test-session-access";
import { createClient } from "@/platform/supabase/server";
import { templateSchema, type CertificateEvent, type CertificateIssue, type CertificateTemplate } from "../domain/certificate";

export const CERTIFICATES_BUCKET = "vppsone-certificates";

export async function certificateForViewer(id: string): Promise<CertificateIssue | null> {
  const staff = await assertPermission("certificates:view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await createClient();
  const { data, error } = await db.from("school_certificate_issues").select("*").eq("id", id).maybeSingle<CertificateIssue>();
  if (error) throw new Error("Certificate unavailable");
  if (data) await assertSessionVisible(staff, data.session_label);
  return data;
}

export async function certificateEvents(id: string): Promise<CertificateEvent[]> {
  if (!(await certificateForViewer(id))) return [];
  const { data, error } = await (await createClient()).from("school_certificate_events").select("id,kind,created_at,actor_id,reason").eq("issue_id", id).order("created_at");
  if (error) throw new Error("Certificate history unavailable");
  return data ?? [];
}

export async function listCertificates(sessionLabel: string, options: { studentId?: string; query?: string; status?: string; page?: number } = {}) {
  const staff = await assertPermission("certificates:view");
  await assertSessionVisible(staff, sessionLabel);
  let query = (await createClient()).from("school_certificate_issues").select("*", { count: "exact" }).eq("session_label", sessionLabel).order("issued_at", { ascending: false });
  if (options.studentId) query = query.eq("student_id", options.studentId);
  if (["prepared", "issued", "superseded", "cancelled"].includes(options.status ?? "")) query = query.eq("status", options.status!);
  const search = (options.query ?? "").replace(/[^\p{L}\p{N} /-]/gu, "").trim().slice(0, 80);
  if (search) query = query.or(`serial.ilike.%${search}%,student_name.ilike.%${search}%,admission_no.ilike.%${search}%`);
  const page = Math.max(1, Math.min(10000, Math.floor(options.page || 1)));
  const { data, error, count } = await query.range((page - 1) * 30, page * 30 - 1);
  if (error) throw new Error("Certificate register unavailable");
  return { rows: (data ?? []) as CertificateIssue[], count: count ?? 0, page };
}

export async function currentCertificateTemplate(): Promise<CertificateTemplate> {
  await assertPermission("certificates:view");
  const { data, error } = await (await createClient()).from("school_certificate_templates").select("template,active").order("version", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) throw new Error("Certificate template unavailable");
  return templateSchema.parse({ ...data.template, active: data.active });
}
