import "server-only";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionVisible } from "@/platform/auth/test-session-access";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import { certificateKinds, templateSchema, verifyCodePattern, type CertificateEvent, type CertificateIssue, type CertificateKind, type CertificateStatus, type CertificateTemplate } from "../domain/certificate";

export const CERTIFICATES_BUCKET = "vppsone-certificates";
const PAGE = 30;

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

export type RegisterOptions = { studentId?: string; query?: string; status?: string; kind?: string; page?: number };
export async function listCertificates(sessionLabel: string, options: RegisterOptions = {}) {
  const staff = await assertPermission("certificates:view");
  await assertSessionVisible(staff, sessionLabel);
  let query = (await createClient()).from("school_certificate_issues").select("*", { count: "exact" }).eq("session_label", sessionLabel).order("issued_at", { ascending: false });
  if (options.studentId) query = query.eq("student_id", options.studentId);
  if (["prepared", "issued", "superseded", "cancelled"].includes(options.status ?? "")) query = query.eq("status", options.status!);
  if ((certificateKinds as readonly string[]).includes(options.kind ?? "")) query = query.eq("kind", options.kind!);
  const search = (options.query ?? "").replace(/[^\p{L}\p{N} /-]/gu, "").trim().slice(0, 80);
  if (search) query = query.or(`serial.ilike.%${search}%,student_name.ilike.%${search}%,admission_no.ilike.%${search}%`);
  const page = Math.max(1, Math.min(10000, Math.floor(options.page || 1)));
  const { data, error, count } = await query.range((page - 1) * PAGE, page * PAGE - 1);
  if (error) throw new Error("Certificate register unavailable");
  return { rows: (data ?? []) as CertificateIssue[], count: count ?? 0, page };
}

/** Prepared, stored, not yet signed and handed over: the principal's pile. */
export async function signingTray(sessionLabel: string): Promise<CertificateIssue[]> {
  const staff = await assertPermission("certificates:view");
  await assertSessionVisible(staff, sessionLabel);
  const { data, error } = await (await createClient()).from("school_certificate_issues").select("*")
    .eq("session_label", sessionLabel).eq("status", "prepared").eq("artifact_state", "ready").order("issued_at", { ascending: true }).limit(200);
  if (error) throw new Error("Signing tray unavailable");
  return (data ?? []) as CertificateIssue[];
}

export type DeskCounts = { today: number; tray: number; handedThisMonth: number; total: number };
export async function deskCounts(sessionLabel: string, todayIso: string): Promise<DeskCounts> {
  const staff = await assertPermission("certificates:view");
  await assertSessionVisible(staff, sessionLabel);
  const db = await createClient();
  const start = `${todayIso}T00:00:00+05:30`, month = `${todayIso.slice(0, 7)}-01T00:00:00+05:30`;
  const base = () => db.from("school_certificate_issues").select("id", { count: "exact", head: true }).eq("session_label", sessionLabel);
  const [today, tray, handed, total] = await Promise.all([
    base().gte("issued_at", start).in("status", ["prepared", "issued"] satisfies CertificateStatus[]),
    base().eq("status", "prepared").eq("artifact_state", "ready"),
    base().eq("status", "issued").gte("issued_at", month),
    base().in("status", ["prepared", "issued"] satisfies CertificateStatus[]),
  ]);
  if (today.error || tray.error || handed.error || total.error) throw new Error("Certificate counts unavailable");
  return { today: today.count ?? 0, tray: tray.count ?? 0, handedThisMonth: handed.count ?? 0, total: total.count ?? 0 };
}

/** Issues the caller may see, by id, for a merged print. */
export async function certificatesByIds(ids: readonly string[]): Promise<CertificateIssue[]> {
  await assertPermission("certificates:view");
  const wanted = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 60);
  if (!wanted.length) return [];
  const { data, error } = await (await createClient()).from("school_certificate_issues").select("*").in("id", wanted);
  if (error) throw new Error("Certificates unavailable");
  const order = new Map(wanted.map((id, index) => [id, index]));
  return ((data ?? []) as CertificateIssue[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function currentCertificateTemplate(kind: CertificateKind = "study"): Promise<CertificateTemplate> {
  await assertPermission("certificates:view");
  const { data, error } = await (await createClient()).from("school_certificate_templates").select("template,active").eq("kind", kind).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) throw new Error("Certificate template unavailable");
  return templateSchema.parse({ ...data.template, active: data.active, kind });
}

/** The newest template of every kind, for the sheet and the settings screen. */
export async function allCertificateTemplates(): Promise<Partial<Record<CertificateKind, CertificateTemplate>>> {
  await assertPermission("certificates:view");
  const { data, error } = await (await createClient()).from("school_certificate_templates").select("kind,version,template,active").order("version", { ascending: false });
  if (error) throw new Error("Certificate templates unavailable");
  const out: Partial<Record<CertificateKind, CertificateTemplate>> = {};
  for (const row of data ?? []) {
    const kind = row.kind as CertificateKind;
    if (out[kind]) continue;
    const parsed = templateSchema.safeParse({ ...row.template, active: row.active, kind });
    if (parsed.success) out[kind] = parsed.data;
  }
  return out;
}

export type PublicCheck = { status: CertificateStatus; serial: string; kind: CertificateKind; issuedOn: string; studentName: string; school: string; supersededBy: string | null };
/** The QR check. Unauthenticated by design; the database function returns only these fields. */
export async function publicCertificateCheck(code: string): Promise<PublicCheck | null> {
  if (!verifyCodePattern.test(code)) return null;
  const { data, error } = await createAdminClient().rpc("school_certificate_verify", { p_code: code });
  if (error) throw new Error("Verification unavailable");
  return (data as PublicCheck | null) ?? null;
}

export type RosterStudent = { studentId: string; studentName: string; admissionNo: string; classId: string; classLabel: string };
/** Enrolled children for a class batch; the issue command rechecks everything per child. */
export async function certificateRoster(sessionLabel: string): Promise<RosterStudent[]> {
  const staff = await assertPermission("certificates:issue");
  await assertSessionVisible(staff, sessionLabel);
  const { isConfinedDeployment } = await import("@/platform/deployment/confinement");
  const { data, error } = await createAdminClient().rpc("school_certificate_roster", { p_actor: staff.id, p_session: sessionLabel, p_confined: isConfinedDeployment() });
  if (error || !Array.isArray(data)) throw new Error("Class roster unavailable");
  return data as RosterStudent[];
}
