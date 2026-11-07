import "server-only";
import { createHash } from "node:crypto";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionWritable, assertStudentVisible } from "@/platform/auth/test-session-access";
import { can } from "@/platform/auth/permissions";
import { schoolProfile } from "@/platform/config/school";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { getSiteUrl } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { assertNotPreviewing } from "@/vx/view-as";
import { cleanProfile } from "@/vx/screens/settings/domain/settings";
import { certificateCommandSchema, type CertificateFacts, type CertificateIssue, type CertificateResult, type CertificateSchool } from "../domain/certificate";
import { cleanIdentity } from "../domain/identity";
import { executeCertificateIssue } from "../domain/issue-flow";
import { CERTIFICATES_BUCKET, currentCertificateTemplate } from "./repo";
import { IDENTITY_KEY } from "./identity";
import { recordCertificateAttention, clearCertificateAttention } from "./attention";

/**
 * The letterhead and signatory to freeze into a new issue, read at reservation
 * time. The letterhead lines come from Certificate settings, whose defaults are
 * the school's official letterhead (D-540); the name and logo stay with
 * Settings → School profile. Under the school's default policy the snapshot
 * names the receipts' signature and the school seal (D-541) rather than
 * embedding them: the renderer reads both files.
 */
async function schoolForSnapshot(db: ReturnType<typeof createAdminClient>): Promise<CertificateSchool> {
  const [profile, identityRow] = await Promise.all([
    db.from("school_settings").select("value").eq("key", "profile").maybeSingle(),
    db.from("school_settings").select("value").eq("key", IDENTITY_KEY).maybeSingle(),
  ]);
  if (profile.error || identityRow.error) throw new Error("School letterhead unavailable");
  const school = cleanProfile(profile.data?.value, { nameEn: schoolProfile.name, nameHi: "", address: schoolProfile.address, phone: schoolProfile.phone, affiliation: "", footer: "", logo: null, signature: null });
  const identity = cleanIdentity(identityRow.data?.value);
  const signed = identity.signaturePolicy === "facsimile";
  return {
    name: school.nameEn, nameHi: identity.nameHi || school.nameHi, address: identity.address || school.address, phone: identity.phone || school.phone,
    email: identity.email || schoolProfile.email, website: identity.website, logo: school.logo, affiliation: school.affiliation,
    place: identity.place, udiseCode: identity.udiseCode, pspCode: identity.pspCode, recognitionNo: identity.recognitionNo,
    registrationNo: identity.registrationNo, recognisedBy: identity.recognisedBy, trust: identity.trust,
    principalName: identity.principalName, principalDesignation: identity.principalDesignation, principalDesignationHi: identity.principalDesignationHi,
    signaturePolicy: signed ? "facsimile" : "manual", signature: null,
    ...(signed ? { signatureAsset: "principal-2026" as const, seal: "school-seal-2026" as const } : {}),
    layout: identity.layout, offsetX: identity.offsetX, offsetY: identity.offsetY,
    verifyBase: getSiteUrl(),
  };
}

export async function issueCertificate(input: unknown): Promise<CertificateResult> {
  const staff = await assertPermission("certificates:issue");
  await assertNotPreviewing();
  const parsed = certificateCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const command = parsed.data;
  const kind = command.kind ?? "study";
  if (!can(staff, "certificates:view") || (command.supersedes && (!can(staff, "certificates:manage") || !command.reason))) return { ok: false, code: "forbidden" };
  await assertSessionWritable(staff, command.sessionLabel);
  // Reprints deliberately remain available through a source outage. New issues
  // additionally check the current student before the database reserves them.
  const db = createAdminClient();
  const confined = isConfinedDeployment();
  const hash = createHash("sha256").update(JSON.stringify({ student: command.studentId, session: command.sessionLabel, kind, purpose: command.purpose ?? null, extras: command.extras ?? {}, new: !!command.newIssue, supersedes: command.supersedes ?? null, reason: command.reason ?? null, resumeIssue: command.resumeIssue ?? null })).digest("hex");
  const bucket = db.storage.from(CERTIFICATES_BUCKET);
  const result = await executeCertificateIssue(command, {
    async replay() {
      const { data, error } = await db.from("school_certificate_commands").select("issue_id,actor_id,request_hash").eq("command_id", command.commandId).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      if (data.actor_id !== staff.id || data.request_hash !== hash) throw new Error("Certificate command already used");
      const response = await db.from("school_certificate_issues").select("*").eq("id", data.issue_id).eq("student_id", command.studentId).eq("session_label", command.sessionLabel).single<CertificateIssue>();
      if (response.error) throw response.error;
      return response.data;
    },
    async currentIssue() {
      // Record even a reprint command so a delayed retry cannot allocate a new
      // serial after the original document has since been cancelled.
      const { data, error } = await db.rpc("school_certificate_current_v2", { p_actor: staff.id, p_student: command.studentId, p_session: command.sessionLabel, p_kind: kind, p_command: command.commandId, p_request_hash: hash, p_confined: confined, p_issue: command.resumeIssue ?? null });
      if (error) throw error;
      return data as CertificateIssue | null;
    },
    template: () => currentCertificateTemplate(kind),
    async facts() {
      await assertStudentVisible(staff, command.studentId);
      const { data, error } = await db.rpc("school_certificate_facts_v2", { p_actor: staff.id, p_student: command.studentId, p_session: command.sessionLabel, p_kind: kind, p_confined: confined });
      if (error || !data) throw new Error("Certificate facts unavailable");
      return data as CertificateFacts;
    },
    async reserve(_, facts, template) {
      const school = await schoolForSnapshot(db);
      const { data, error } = await db.rpc("school_certificate_reserve_v2", { p_actor: staff.id, p_student: command.studentId, p_session: command.sessionLabel, p_kind: kind, p_command: command.commandId, p_request_hash: hash, p_expected_facts: facts,
        p_school: school, p_expected_template: template.version, p_purpose: command.purpose ?? null, p_extras: command.extras ?? {}, p_new: command.newIssue ?? false, p_supersedes: command.supersedes ?? null, p_reason: command.reason ?? null, p_confined: confined });
      if (error || !data) throw new Error("Certificate reservation unavailable");
      return data as { issue: CertificateIssue; existing: boolean };
    },
    async readArtifact(path) {
      const { data, error } = await bucket.download(path);
      if (error) {
        if (String(error.message).toLowerCase().includes("not found") || String(error.message).toLowerCase().includes("not_found")) return null;
        throw new Error("Certificate storage unavailable");
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    async render(snapshot) {
      const { renderCertificatePdf } = await import("../ui/certificate-pdf");
      return new Uint8Array(await renderCertificatePdf(snapshot));
    },
    async storeArtifact(path, bytes) {
      const { error } = await bucket.upload(path, bytes, { contentType: "application/pdf", upsert: false, cacheControl: "0" });
      if (error) throw new Error("Certificate storage unavailable");
    },
    async finish(issue, path, bytes) {
      const { error } = await db.rpc("school_certificate_finish", { p_actor: staff.id, p_issue: issue.id, p_path: path, p_sha256: createHash("sha256").update(bytes).digest("hex"), p_bytes: bytes.byteLength, p_confined: confined });
      if (error) throw new Error("Certificate completion unavailable");
    },
    async failed(issueId) {
      await db.from("school_certificate_issues").update({ artifact_state: "failed" }).eq("id", issueId).neq("artifact_state", "ready");
    },
  });
  // The Today attention card follows study certificates, the routine document.
  if (kind === "study") {
    if (result.ok) await clearCertificateAttention(staff, command);
    else if (result.code === "blocked" && result.blockers) await recordCertificateAttention(staff, command, result.blockers);
  }
  return result;
}

/** Kept for callers written before kinds existed. */
export const issueStudyCertificate = issueCertificate;
