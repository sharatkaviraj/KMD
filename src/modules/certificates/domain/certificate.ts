import { z } from "zod";
import { conductGrades, type ConductGrade } from "./conduct";
import { dateFigures, dateInWords, dateLong } from "./date-words";

/** Documents the school issues itself. A TC is a kind; marking a child as left is not done here. */
export const certificateKinds = ["study", "character", "dob", "tc"] as const;
export type CertificateKind = (typeof certificateKinds)[number];

/** Facts read from the school's records, never typed into a certificate. */
export const certificateFields = ["studentName", "admissionNo", "classLabel", "sessionLabel", "enrolledOn", "leftOn", "admittedOn", "dateOfBirth", "fatherName", "motherName"] as const;
export type CertificateField = (typeof certificateFields)[number];

/** What the office says at the counter for this one issue: the TC's reason, the conduct line. */
export const certificateExtras = ["reasonForLeaving", "conduct", "lastResult", "remarks"] as const;
export type CertificateExtra = (typeof certificateExtras)[number];
export { conductGrades, type ConductGrade };

const derived = ["dateOfBirthWords", "sonDaughter", "heShe", "himHer", "hisHer", "putraPutri"] as const;
export const detailRowKeys = [...certificateFields, ...certificateExtras, "dateOfBirthWords"] as const;
export type DetailRowKey = (typeof detailRowKeys)[number];
const substitutions = new Set<string>([...certificateFields, ...certificateExtras, ...derived, "schoolName", "schoolAddress", "serial", "issueDate", "purpose"]);
export const placeholders = (body: string) => [...body.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
const wording = z.string().trim().min(10).max(4000).refine((body) => placeholders(body).every((key) => substitutions.has(key)), "Unknown certificate placeholder");
const line = z.string().trim().max(600).refine((body) => placeholders(body).every((key) => substitutions.has(key)), "Unknown certificate placeholder");

export const templateSchema = z.object({
  version: z.number().int().positive(), active: z.boolean(), kind: z.enum(certificateKinds).default("study"),
  titleEn: z.string().trim().min(1).max(120), titleHi: z.string().trim().min(1).max(150),
  bodyEn: wording, bodyHi: wording, historicalBodyEn: wording, historicalBodyHi: wording,
  purposeEn: line.default("This certificate is issued on request for the purpose of {purpose}."),
  purposeHi: line.default("यह प्रमाण पत्र {purpose} हेतु आवेदन पर जारी किया जाता है।"),
  requiredFields: z.array(z.enum(certificateFields)).max(certificateFields.length),
  detailRows: z.array(z.enum(detailRowKeys)).max(detailRowKeys.length).default([]),
  language: z.enum(["en", "hi", "both"]), prefix: z.string().regex(/^[A-Z0-9][A-Z0-9/-]{0,39}$/).refine((s) => !s.includes("//") && !s.endsWith("/")),
  signaturePolicy: z.literal("manual"),
});
export type CertificateTemplate = z.infer<typeof templateSchema>;

export const defaultStudyTemplate: CertificateTemplate = {
  version: 1, active: true, kind: "study", titleEn: "Study Certificate", titleHi: "अध्ययन प्रमाण पत्र",
  bodyEn: "This is to certify that {studentName}, admission/SR number {admissionNo}, is enrolled in Class {classLabel} for academic session {sessionLabel} at {schoolName}.",
  bodyHi: "प्रमाणित किया जाता है कि {studentName}, प्रवेश/एसआर संख्या {admissionNo}, शैक्षणिक सत्र {sessionLabel} में {schoolName} की कक्षा {classLabel} में अध्ययनरत हैं।",
  historicalBodyEn: "This is to certify that {studentName}, admission/SR number {admissionNo}, was enrolled in Class {classLabel} during academic session {sessionLabel} at {schoolName}.",
  historicalBodyHi: "प्रमाणित किया जाता है कि {studentName}, प्रवेश/एसआर संख्या {admissionNo}, शैक्षणिक सत्र {sessionLabel} के दौरान {schoolName} की कक्षा {classLabel} में अध्ययनरत थे।",
  purposeEn: "This certificate is issued on request for the purpose of {purpose}.", purposeHi: "यह प्रमाण पत्र {purpose} हेतु आवेदन पर जारी किया जाता है।",
  requiredFields: ["studentName", "admissionNo", "classLabel", "sessionLabel"], detailRows: [], language: "en", prefix: "VPPS/STUDY", signaturePolicy: "manual",
};

export type CertificateFacts = {
  studentId: string; enrolmentId: string; classId: string; studentName: string; admissionNo: string; classLabel: string; sessionLabel: string;
  status: "current" | "historical"; enrolledOn: string | null; leftOn: string | null; dateOfBirth: string | null; fatherName: string | null; motherName: string | null;
  admittedOn?: string | null; gender?: string | null;
  identityVerified: boolean; sourceCurrent: boolean; sourceRevision: string; checkedAt: string;
};

/** The letterhead and signatory exactly as they were when the document was prepared. */
export type CertificateSchool = {
  name: string; nameHi?: string; address: string; phone: string; email: string; logo?: string | null; affiliation?: string;
  place?: string; udiseCode?: string; pspCode?: string; recognitionNo?: string;
  /** The official letterhead's other lines (D-540). Older snapshots have none and print without them. */
  registrationNo?: string; recognisedBy?: string; trust?: string; website?: string;
  principalName?: string; principalDesignation?: string; principalDesignationHi?: string;
  /** An image embedded in older snapshots, when a facsimile had been allowed at preparation time. */
  signature?: string | null; signaturePolicy?: "manual" | "facsimile";
  /**
   * Which stored image signs it and whether the school seal is printed
   * (D-541). Names, not bytes: the snapshot records that this document was
   * signed and sealed, and the renderer reads the files, so a snapshot does
   * not carry 40 KB of image into the database for every issue.
   */
  signatureAsset?: "principal-2026"; seal?: "school-seal-2026";
  layout?: "classic" | "preprinted"; offsetX?: number; offsetY?: number; verifyBase?: string;
};

/** Signed and sealed by the school when it was prepared, so nobody signs the print by hand. */
export function certificateSigned(snapshot: Pick<CertificateSnapshot, "school">): boolean {
  const school = snapshot.school;
  return school.signaturePolicy === "facsimile" && Boolean(school.signatureAsset || school.signature);
}
export type CertificateExtras = Partial<Record<CertificateExtra, string>>;
export type CertificateSnapshot = {
  serial: string; issuedAt: string; issuedOn: string; isTest: boolean; school: CertificateSchool; facts: CertificateFacts; template: CertificateTemplate;
  kind?: CertificateKind; purpose?: string | null; extras?: CertificateExtras; verifyCode?: string;
};
export type CertificateStatus = "prepared" | "issued" | "superseded" | "cancelled";
export type CertificateIssue = {
  id: string; student_id: string; session_label: string; serial: string; status: CertificateStatus; artifact_state: "preparing" | "ready" | "failed";
  snapshot: CertificateSnapshot; issued_by: string; issued_at: string; storage_path: string | null; artifact_sha256: string | null; supersedes: string | null; reason: string | null;
  kind?: CertificateKind;
};
export type CertificateEvent = { id: string; kind: string; created_at: string; actor_id: string; reason: string | null };
export type CertificateBlocker = {
  field: CertificateField | CertificateExtra | "identity" | "template" | "source" | "status";
  reason: "missing_field" | "invalid_date" | "identity_unverified" | "template_inactive" | "source_unavailable" | "not_left";
};

export const kindOf = (snapshot: Pick<CertificateSnapshot, "kind">): CertificateKind => snapshot.kind ?? "study";

function bodiesFor(template: CertificateTemplate, status: CertificateFacts["status"]): string[] {
  const pair = status === "historical" ? [template.historicalBodyEn, template.historicalBodyHi] : [template.bodyEn, template.bodyHi];
  return template.language === "both" ? pair : [pair[template.language === "hi" ? 1 : 0]];
}

/** Extras the office must give for this kind: whatever the wording uses, and the TC's two essentials. */
export function requiredExtras(template: CertificateTemplate, status: CertificateFacts["status"] = "current"): CertificateExtra[] {
  const used = new Set(bodiesFor(template, status).flatMap(placeholders));
  const kind = template.kind ?? "study";
  if (kind === "tc") { used.add("reasonForLeaving"); used.add("conduct"); }
  return certificateExtras.filter((key) => used.has(key));
}
/** Extras the sheet should offer at all: required ones plus the detail rows that may be filled. */
export function offeredExtras(template: CertificateTemplate): CertificateExtra[] {
  const offered = new Set<string>([...requiredExtras(template), ...template.detailRows]);
  return certificateExtras.filter((key) => offered.has(key));
}

export function certificatePreflight(facts: CertificateFacts, template: CertificateTemplate, extras: CertificateExtras = {}): CertificateBlocker[] {
  const result: CertificateBlocker[] = [];
  if (!template.active) result.push({ field: "template", reason: "template_inactive" });
  if (!facts.identityVerified) result.push({ field: "identity", reason: "identity_unverified" });
  if (!facts.sourceCurrent) result.push({ field: "source", reason: "source_unavailable" });
  if ((template.kind ?? "study") === "tc" && facts.status !== "historical") result.push({ field: "status", reason: "not_left" });
  const body = bodiesFor(template, facts.status);
  const mentioned = new Set(body.flatMap(placeholders));
  if (mentioned.has("dateOfBirthWords")) mentioned.add("dateOfBirth");
  const required = new Set([...template.requiredFields, ...[...mentioned].filter((key): key is CertificateField => (certificateFields as readonly string[]).includes(key))]);
  for (const key of required) {
    const value = facts[key];
    if (!value?.trim()) result.push({ field: key, reason: "missing_field" });
    else if (["enrolledOn", "leftOn", "dateOfBirth", "admittedOn"].includes(key) && !isCertificateDate(value)) result.push({ field: key, reason: "invalid_date" });
  }
  for (const key of requiredExtras(template, facts.status)) if (!extras[key]?.trim()) result.push({ field: key, reason: "missing_field" });
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

type Gender = "male" | "female" | null;
export function genderOf(value: string | null | undefined): Gender {
  const v = (value ?? "").trim().toLowerCase();
  if (["m", "male", "boy", "पुरुष", "छात्र"].includes(v)) return "male";
  if (["f", "female", "girl", "महिला", "छात्रा"].includes(v)) return "female";
  return null;
}

const CONDUCT_BODY: Record<ConductGrade, [string, string]> = { excellent: ["an excellent", "उत्तम"], very_good: ["a very good", "बहुत अच्छा"], good: ["a good", "अच्छा"], satisfactory: ["a satisfactory", "संतोषजनक"] };
const CONDUCT_ROW: Record<ConductGrade, [string, string]> = { excellent: ["Excellent", "उत्तम"], very_good: ["Very good", "बहुत अच्छा"], good: ["Good", "अच्छा"], satisfactory: ["Satisfactory", "संतोषजनक"] };
const isConduct = (value: string | undefined): value is ConductGrade => (conductGrades as readonly string[]).includes(value ?? "");

/** Every value a placeholder can take, in one language. Dates and words are computed, never typed. */
export function placeholderValues(snapshot: CertificateSnapshot, language: "en" | "hi", context: "body" | "row" = "body"): Record<string, string> {
  const f = snapshot.facts, extras = snapshot.extras ?? {}, gender = genderOf(f.gender);
  const hi = language === "hi";
  const pick = (male: string, female: string, other: string) => gender === "male" ? male : gender === "female" ? female : other;
  const conduct = extras.conduct;
  const values: Record<string, string | null | undefined> = {
    studentName: f.studentName, admissionNo: f.admissionNo, classLabel: f.classLabel, sessionLabel: f.sessionLabel,
    enrolledOn: dateFigures(f.enrolledOn), leftOn: dateFigures(f.leftOn), admittedOn: dateFigures(f.admittedOn), dateOfBirth: dateFigures(f.dateOfBirth),
    dateOfBirthWords: dateInWords(f.dateOfBirth, language), fatherName: f.fatherName, motherName: f.motherName,
    sonDaughter: pick("son", "daughter", "child"), heShe: pick("he", "she", "the student"), himHer: pick("him", "her", "the student"), hisHer: pick("his", "her", "the student's"),
    putraPutri: pick("पुत्र", "पुत्री", "संतान"),
    reasonForLeaving: extras.reasonForLeaving, lastResult: extras.lastResult, remarks: extras.remarks,
    conduct: isConduct(conduct) ? (context === "body" ? CONDUCT_BODY : CONDUCT_ROW)[conduct][hi ? 1 : 0] : conduct,
    schoolName: hi ? snapshot.school.nameHi || snapshot.school.name : snapshot.school.name, schoolAddress: snapshot.school.address,
    serial: snapshot.serial, issueDate: dateLong(snapshot.issuedOn, language) ?? snapshot.issuedOn, purpose: snapshot.purpose ?? "",
  };
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value ?? ""]));
}

export type Segment = { text: string; value: boolean };
/** The wording split so the PDF can set the child's facts apart from the template's words. */
export function wordingSegments(text: string, values: Record<string, string>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{([^{}]+)\}/g)) {
    if (match.index! > last) out.push({ text: text.slice(last, match.index), value: false });
    const value = values[match[1]] ?? "";
    if (value) out.push({ text: value, value: !["sonDaughter", "heShe", "himHer", "hisHer", "putraPutri", "schoolName", "schoolAddress"].includes(match[1]) });
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), value: false });
  return out;
}

export function certificateBodyText(snapshot: CertificateSnapshot, language: "en" | "hi"): string {
  const t = snapshot.template;
  return snapshot.facts.status === "historical" ? (language === "hi" ? t.historicalBodyHi : t.historicalBodyEn) : (language === "hi" ? t.bodyHi : t.bodyEn);
}

export function renderCertificateBody(snapshot: CertificateSnapshot, language: "en" | "hi"): string {
  const values = placeholderValues(snapshot, language);
  return wordingSegments(certificateBodyText(snapshot, language), values).map((s) => s.text).join("");
}

/** The purpose sentence, only when the office gave a purpose. */
export function purposeLine(snapshot: CertificateSnapshot, language: "en" | "hi"): string | null {
  if (!snapshot.purpose?.trim()) return null;
  const t = templateSchema.shape.purposeEn.parse(language === "hi" ? snapshot.template.purposeHi : snapshot.template.purposeEn);
  return t.trim() ? wordingSegments(t, placeholderValues(snapshot, language)).map((s) => s.text).join("") : null;
}

/** Detail rows with a value; a blank optional row is left out rather than printed empty or guessed. */
export function detailRows(snapshot: CertificateSnapshot, language: "en" | "hi"): { key: DetailRowKey; value: string }[] {
  const values = placeholderValues(snapshot, language, "row");
  return (snapshot.template.detailRows ?? []).map((key) => ({ key, value: values[key] ?? "" })).filter((row) => row.value.trim());
}

export function signatureLabel(policy: "manual", status: CertificateStatus): "signature_required" {
  if (policy !== "manual" || !["prepared", "issued", "superseded", "cancelled"].includes(status)) throw new Error("Unknown certificate policy");
  return "signature_required";
}

/** "R*** S*****": enough for a person holding the paper to recognise, too little to look anyone up. */
export function maskName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/).filter(Boolean).map((word) => {
    const chars = [...word];
    return chars[0] + "*".repeat(Math.max(2, chars.length - 1));
  }).join(" ");
}

export const verifyCodePattern = /^[a-f0-9]{16}$/;
export function verifyPath(code: string): string { return `/cv/${code}`; }

const extraText = z.string().trim().min(1).max(200).refine((value) => !/[{}<>]/.test(value), "Unsafe text");
export const extrasSchema = z.object({
  reasonForLeaving: extraText.optional(), conduct: extraText.optional(), lastResult: extraText.optional(), remarks: extraText.optional(),
}).strict();

export const certificateCommandSchema = z.object({
  studentId: z.uuid(), sessionLabel: z.string().regex(/^(?:TEST-)?\d{4}-\d{2}$/), commandId: z.uuid(), newIssue: z.boolean().optional(),
  kind: z.enum(certificateKinds).optional(), purpose: z.string().trim().min(2).max(80).refine((value) => !/[{}<>]/.test(value)).optional(),
  extras: extrasSchema.optional(),
  supersedes: z.uuid().optional(), reason: z.string().trim().min(3).max(500).optional(), resumeIssue: z.uuid().optional(),
}).strict().refine(value => !value.resumeIssue || (!value.newIssue && !value.supersedes), "Recovery uses the original issue");
export type CertificateCommand = z.infer<typeof certificateCommandSchema>;
export type CertificateResult = { ok: true; issueId: string; existing: boolean; serial?: string } | { ok: false; code: "blocked" | "unavailable" | "forbidden" | "invalid"; blockers?: CertificateBlocker[] };
