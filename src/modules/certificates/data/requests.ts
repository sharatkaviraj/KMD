import "server-only";
import { createHash } from "node:crypto";
import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { assertSessionVisible, assertSessionWritable } from "@/platform/auth/test-session-access";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { createAdminClient } from "@/platform/supabase/admin";
import { assertNotPreviewing } from "@/vx/view-as";
import type { CertificateBlocker, CertificateTemplate } from "../domain/certificate";
import { templateSchema } from "../domain/certificate";
import { validCertificatePdf } from "../domain/issue-flow";
import {
  approvalCommandSeed, requestCreateSchema, requestDeclineSchema, requestDownloadSchema, requestErrorCode, requestIdSchema, requestKinds,
  requestPurposeKinds, uuidFromDigest, type CertificateRequestRow, type RequestErrorCode, type RequestKind,
} from "../domain/request";
import { issueCertificate } from "./issue";
import { CERTIFICATES_BUCKET } from "./repo";

/**
 * Certificate requests (D-542): a teacher asks, an approver signs, the teacher
 * downloads. Every rule is in the database functions
 * (`20261107172553_certificate_requests.sql`); this file authorizes the
 * request, names the actor and turns refusals into codes the screens explain.
 */

type Failure = { ok: false; code: RequestErrorCode; blockers?: CertificateBlocker[] };
type DocumentRef = { issueId: string; serial: string; storagePath: string; sha256: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function asker(): Promise<CurrentStaff> {
  const staff = await assertPermission("certificates:request");
  await assertNotPreviewing();
  return staff;
}

async function approver(): Promise<CurrentStaff> {
  const staff = await assertPermission("certificates:approve");
  await assertNotPreviewing();
  return staff;
}

/** The session a request belongs to, read before any write so the TEST rule is checked by the app too. */
async function requestSession(requestId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from("school_certificate_requests").select("session_label").eq("id", requestId).maybeSingle();
  if (error) throw new Error("Certificate request unavailable");
  return (data?.session_label as string | undefined) ?? null;
}

export async function createCertificateRequest(input: unknown): Promise<{ ok: true; requestId: string; existing: boolean } | Failure> {
  const staff = await asker();
  const parsed = requestCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const value = parsed.data;
  await assertSessionWritable(staff, value.sessionLabel);
  const { data, error } = await createAdminClient().rpc("school_certificate_request_create", {
    p_actor: staff.id, p_student: value.studentId, p_session: value.sessionLabel, p_kind: value.kind, p_command: value.commandId,
    p_purpose: value.purpose ?? null, p_extras: value.conduct ? { conduct: value.conduct } : {}, p_note: value.note ?? null, p_confined: isConfinedDeployment(),
  });
  if (error || !data) return { ok: false, code: requestErrorCode(error?.message) };
  const result = data as { request: { id: string }; existing: boolean };
  return { ok: true, requestId: result.request.id, existing: result.existing };
}

export async function withdrawCertificateRequest(input: unknown): Promise<{ ok: true } | Failure> {
  const staff = await asker();
  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const session = await requestSession(parsed.data.requestId);
  if (!session) return { ok: false, code: "forbidden" };
  await assertSessionWritable(staff, session);
  const { error } = await createAdminClient().rpc("school_certificate_request_withdraw", { p_actor: staff.id, p_request: parsed.data.requestId, p_confined: isConfinedDeployment() });
  return error ? { ok: false, code: requestErrorCode(error.message) } : { ok: true };
}

export async function declineCertificateRequest(input: unknown): Promise<{ ok: true } | Failure> {
  const staff = await approver();
  const parsed = requestDeclineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const session = await requestSession(parsed.data.requestId);
  if (!session) return { ok: false, code: "forbidden" };
  await assertSessionWritable(staff, session);
  const { error } = await createAdminClient().rpc("school_certificate_request_decline", { p_actor: staff.id, p_request: parsed.data.requestId, p_reason: parsed.data.reason, p_confined: isConfinedDeployment() });
  return error ? { ok: false, code: requestErrorCode(error.message) } : { ok: true };
}

/**
 * "Approve and sign": issue the document under the approver's own name — so
 * it carries the printed signature and the seal the school's policy puts on
 * every new certificate — then link the request to it. The issue command is
 * derived from the request and the approver, so a retry after a lost
 * response replays the same document rather than numbering a second one.
 */
export async function approveCertificateRequest(input: unknown): Promise<{ ok: true; issueId: string; serial: string } | Failure> {
  const staff = await approver();
  if (!can(staff, "certificates:issue") || !can(staff, "certificates:view")) return { ok: false, code: "forbidden" };
  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const db = createAdminClient();
  const { data: request, error } = await db.from("school_certificate_requests")
    .select("id,student_id,session_label,kind,purpose,extras,state,issue_id").eq("id", parsed.data.requestId).maybeSingle();
  if (error) return { ok: false, code: "unavailable" };
  if (!request) return { ok: false, code: "forbidden" };
  await assertSessionWritable(staff, request.session_label as string);
  if (request.state === "approved" && request.issue_id) {
    const { data: issue } = await db.from("school_certificate_issues").select("id,serial").eq("id", request.issue_id).maybeSingle();
    return { ok: true, issueId: request.issue_id as string, serial: (issue?.serial as string | undefined) ?? "" };
  }
  if (request.state !== "waiting") return { ok: false, code: "decided" };
  const kind = request.kind as RequestKind;
  const conduct = (request.extras as { conduct?: string } | null)?.conduct;
  const commandId = uuidFromDigest(createHash("sha256").update(approvalCommandSeed(request.id as string, staff.id)).digest("hex"));
  const issued = await issueCertificate({
    studentId: request.student_id, sessionLabel: request.session_label, kind, commandId, newIssue: true,
    ...(request.purpose ? { purpose: request.purpose } : {}), ...(conduct ? { extras: { conduct } } : {}),
  });
  if (!issued.ok) return { ok: false, code: issued.code, blockers: issued.blockers };
  const { error: linkError } = await db.rpc("school_certificate_request_approve", { p_actor: staff.id, p_request: request.id, p_issue: issued.issueId, p_confined: isConfinedDeployment() });
  if (linkError) return { ok: false, code: requestErrorCode(linkError.message) };
  return { ok: true, issueId: issued.issueId, serial: issued.serial ?? "" };
}

/** Requests for one screen: the asker's own, one child's, or the approver's queue. */
export async function listCertificateRequests(scope: "mine" | "student" | "approver", sessionLabel: string, studentId?: string): Promise<CertificateRequestRow[]> {
  const staff = await assertPermission(scope === "approver" ? "certificates:approve" : "certificates:request");
  await assertSessionVisible(staff, sessionLabel);
  if (scope === "student" && !UUID.test(studentId ?? "")) return [];
  const { data, error } = await createAdminClient().rpc("school_certificate_requests_list", {
    p_actor: staff.id, p_session: sessionLabel, p_scope: scope, p_student: scope === "student" ? studentId : null, p_confined: isConfinedDeployment(),
  });
  if (error) throw new Error(requestErrorCode(error.message) === "forbidden" ? "Certificate requests forbidden" : "Certificate requests unavailable");
  return (Array.isArray(data) ? data : []) as CertificateRequestRow[];
}

/** How many requests wait for this approver; null when they cannot approve or it cannot be read. */
export async function waitingRequestCount(staff: CurrentStaff, sessionLabel: string): Promise<number | null> {
  if (!can(staff, "certificates:approve") || !can(staff, "certificates:issue")) return null;
  try {
    const rows = await listCertificateRequests("approver", sessionLabel);
    return rows.filter((row) => row.state === "waiting").length;
  } catch { return null; }
}

/**
 * What the request sheet offers: the three documents a teacher may ask for,
 * each only while its template is switched on, with the language its purpose
 * line is printed in.
 */
export async function requestableKinds(): Promise<{ kind: RequestKind; language: CertificateTemplate["language"]; purpose: boolean }[]> {
  await assertPermission("certificates:request");
  const { data, error } = await createAdminClient().from("school_certificate_templates").select("kind,version,template,active").order("version", { ascending: false });
  if (error) throw new Error("Certificate templates unavailable");
  const newest = new Map<string, CertificateTemplate>();
  for (const row of data ?? []) {
    if (newest.has(row.kind as string)) continue;
    const parsed = templateSchema.safeParse({ ...(row.template as object), active: row.active, kind: row.kind });
    if (parsed.success) newest.set(row.kind as string, parsed.data);
  }
  return requestKinds.flatMap((kind) => {
    const template = newest.get(kind);
    return template?.active ? [{ kind, language: template.language, purpose: requestPurposeKinds.includes(kind) }] : [];
  });
}

async function documentRef(staff: CurrentStaff, requestId: string, commandId: string | null): Promise<DocumentRef | Failure> {
  const { data, error } = await createAdminClient().rpc("school_certificate_request_document", { p_actor: staff.id, p_request: requestId, p_command: commandId, p_confined: isConfinedDeployment() });
  if (error || !data) return { ok: false, code: requestErrorCode(error?.message) };
  return data as DocumentRef;
}

/** Record that the person who asked (or an approver) took the signed copy. Idempotent per command. */
export async function recordRequestDownload(input: unknown): Promise<{ ok: true; serial: string } | Failure> {
  const staff = await assertPermission("certificates:request");
  await assertNotPreviewing();
  const parsed = requestDownloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const ref = await documentRef(staff, parsed.data.requestId, parsed.data.commandId);
  return "ok" in ref ? ref : { ok: true, serial: ref.serial };
}

/** The stored original behind an approved request, checked against its recorded hash. Never renders. */
export async function requestDocumentBytes(requestId: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; serial: string } | Failure> {
  const staff = await assertPermission("certificates:request");
  if (!UUID.test(requestId)) return { ok: false, code: "invalid" };
  const ref = await documentRef(staff, requestId, null);
  if ("ok" in ref) return ref;
  const { data, error } = await createAdminClient().storage.from(CERTIFICATES_BUCKET).download(ref.storagePath);
  if (error || !data) return { ok: false, code: "unavailable" };
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!validCertificatePdf(bytes) || !ref.sha256 || createHash("sha256").update(bytes).digest("hex") !== ref.sha256) return { ok: false, code: "unavailable" };
  return { bytes, serial: ref.serial };
}
