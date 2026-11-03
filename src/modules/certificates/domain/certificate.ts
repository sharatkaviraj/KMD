import { z } from "zod";

export const certificateFields = ["studentName", "admissionNo", "classLabel", "sessionLabel", "enrolledOn", "leftOn", "dateOfBirth", "fatherName", "motherName"] as const;
export type CertificateField = (typeof certificateFields)[number];
const substitutions = new Set<string>([...certificateFields, "schoolName", "schoolAddress", "serial", "issueDate"]);
const placeholders = (body: string) => [...body.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
const wording = z.string().trim().min(10).max(4000).refine((body) => placeholders(body).every((key) => substitutions.has(key)), "Unknown certificate placeholder");
export const templateSchema = z.object({
  version: z.number().int().positive(), active: z.boolean(), titleEn: z.string().trim().min(1).max(120), titleHi: z.string().trim().min(1).max(150),
  bodyEn: wording, bodyHi: wording, historicalBodyEn: wording, historicalBodyHi: wording,
  requiredFields: z.array(z.enum(certificateFields)).max(certificateFields.length),
  language: z.enum(["en", "hi", "both"]), prefix: z.string().regex(/^[A-Z0-9][A-Z0-9/-]{0,39}$/).refine((s) => !s.includes("//") && !s.endsWith("/")),
  signaturePolicy: z.literal("manual"),
});
export type CertificateTemplate = z.infer<typeof templateSchema>;

export const defaultStudyTemplate: CertificateTemplate = {
  version: 1, active: true, titleEn: "Study Certificate", titleHi: "अध्ययन प्रमाण पत्र",
  bodyEn: "This is to certify that {studentName}, admission/SR number {admissionNo}, is enrolled in Class {classLabel} for academic session {sessionLabel} at {schoolName}.",
  bodyHi: "प्रमाणित किया जाता है कि {studentName}, प्रवेश/एसआर संख्या {admissionNo}, शैक्षणिक सत्र {sessionLabel} में {schoolName} की कक्षा {classLabel} में अध्ययनरत हैं।",
  historicalBodyEn: "This is to certify that {studentName}, admission/SR number {admissionNo}, was enrolled in Class {classLabel} during academic session {sessionLabel} at {schoolName}.",
  historicalBodyHi: "प्रमाणित किया जाता है कि {studentName}, प्रवेश/एसआर संख्या {admissionNo}, शैक्षणिक सत्र {sessionLabel} के दौरान {schoolName} की कक्षा {classLabel} में अध्ययनरत थे।",
  requiredFields: ["studentName", "admissionNo", "classLabel", "sessionLabel"], language: "en", prefix: "VPPS/STUDY", signaturePolicy: "manual",
};

export type CertificateFacts = {
  studentId: string; enrolmentId: string; classId: string; studentName: string; admissionNo: string; classLabel: string; sessionLabel: string;
  status: "current" | "historical"; enrolledOn: string | null; leftOn: string | null; dateOfBirth: string | null; fatherName: string | null; motherName: string | null;
  identityVerified: boolean; sourceCurrent: boolean; sourceRevision: string; checkedAt: string;
};
export type CertificateSchool = { name: string; nameHi?: string; address: string; phone: string; email: string; logo?: string | null; affiliation?: string };
export type CertificateSnapshot = {
  serial: string; issuedAt: string; issuedOn: string; isTest: boolean; school: CertificateSchool; facts: CertificateFacts; template: CertificateTemplate;
};
export type CertificateStatus = "prepared" | "issued" | "superseded" | "cancelled";
export type CertificateIssue = {
  id: string; student_id: string; session_label: string; serial: string; status: CertificateStatus; artifact_state: "preparing" | "ready" | "failed";
  snapshot: CertificateSnapshot; issued_by: string; issued_at: string; storage_path: string | null; artifact_sha256: string | null; supersedes: string | null; reason: string | null;
};
export type CertificateEvent = { id: string; kind: string; created_at: string; actor_id: string; reason: string | null };
export type CertificateBlocker = { field: CertificateField | "identity" | "template" | "source"; reason: "missing_field" | "invalid_date" | "identity_unverified" | "template_inactive" | "source_unavailable" };

export function certificatePreflight(facts: CertificateFacts, template: CertificateTemplate): CertificateBlocker[] {
  const result: CertificateBlocker[] = [];
  if (!template.active) result.push({ field: "template", reason: "template_inactive" });
  if (!facts.identityVerified) result.push({ field: "identity", reason: "identity_unverified" });
  if (!facts.sourceCurrent) result.push({ field: "source", reason: "source_unavailable" });
  const pair = facts.status === "historical" ? [template.historicalBodyEn, template.historicalBodyHi] : [template.bodyEn, template.bodyHi];
  const body = template.language === "both" ? pair : [pair[template.language === "hi" ? 1 : 0]];
  const required = new Set([...template.requiredFields, ...body.flatMap(placeholders).filter((key): key is CertificateField => (certificateFields as readonly string[]).includes(key))]);
  for (const key of required) {
    if (!facts[key]?.trim()) result.push({ field: key, reason: "missing_field" });
    else if (["enrolledOn", "leftOn", "dateOfBirth"].includes(key) && !isCertificateDate(facts[key]!)) result.push({ field: key, reason: "invalid_date" });
  }
  return result;
}

export function isCertificateDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function certificateSerial(prefix: string, session: string, sequence: number, test: boolean): string {
  if (!/^(?:TEST-)?\d{4}-\d{2}$/.test(session) || !Number.isSafeInteger(sequence) || sequence < 1 || !/^[A-Z0-9][A-Z0-9/-]{0,39}$/.test(prefix)) throw new Error("Invalid certificate series");
  return `${test ? "TEST/" : ""}${prefix}/${session}/${String(sequence).padStart(4, "0")}`;
}

export function renderCertificateBody(snapshot: CertificateSnapshot, language: "en" | "hi"): string {
  const t = snapshot.template;
  const body = snapshot.facts.status === "historical" ? (language === "hi" ? t.historicalBodyHi : t.historicalBodyEn) : (language === "hi" ? t.bodyHi : t.bodyEn);
  const values: Record<string, string | null> = { ...Object.fromEntries(certificateFields.map((key) => [key, snapshot.facts[key]])), schoolName: language === "hi" ? snapshot.school.nameHi || snapshot.school.name : snapshot.school.name, schoolAddress: snapshot.school.address, serial: snapshot.serial, issueDate: snapshot.issuedOn };
  return body.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key] ?? "");
}

export function signatureLabel(policy: "manual", status: CertificateStatus): "signature_required" {
  if (policy !== "manual" || !["prepared", "issued", "superseded", "cancelled"].includes(status)) throw new Error("Unknown certificate policy");
  return "signature_required";
}

export const certificateCommandSchema = z.object({
  studentId: z.uuid(), sessionLabel: z.string().regex(/^(?:TEST-)?\d{4}-\d{2}$/), commandId: z.uuid(), newIssue: z.boolean().optional(),
  supersedes: z.uuid().optional(), reason: z.string().trim().min(3).max(500).optional(), resumeIssue: z.uuid().optional(),
}).strict().refine(value => !value.resumeIssue || (!value.newIssue && !value.supersedes), "Recovery uses the original issue");
export type CertificateCommand = z.infer<typeof certificateCommandSchema>;
export type CertificateResult = { ok: true; issueId: string; existing: boolean } | { ok: false; code: "blocked" | "unavailable" | "forbidden" | "invalid"; blockers?: CertificateBlocker[] };
