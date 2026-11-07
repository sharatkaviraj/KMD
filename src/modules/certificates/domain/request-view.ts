import type { CertificateKind, CertificateStatus } from "./certificate";
import type { ConductGrade } from "./conduct";

/**
 * A teacher asks, an approver signs, the teacher downloads (D-542).
 *
 * A teacher never prepares a certificate. She names a child in one of her
 * own classes, the document and, if the family said, what it is for. An
 * approver's "Approve and sign" issues it through the ordinary issue path
 * under the approver's own name, so it carries the principal's printed
 * signature and the school seal; the request then points at that stored
 * original, which the teacher may download and send to the family.
 *
 * The TC is not here: it belongs to the office's leaving workflow.
 *
 * This file is what a screen needs and nothing more; the schemas that check
 * what a screen sends are in `request.ts`, so zod stays off the teacher's
 * pages.
 */
export const requestKinds = ["study", "character", "dob"] as const satisfies readonly CertificateKind[];
export type RequestKind = (typeof requestKinds)[number];
export type RequestState = "waiting" | "approved" | "declined" | "withdrawn";

/** Which kinds may carry a purpose line — the same two the office sheet offers. */
export const requestPurposeKinds: readonly RequestKind[] = ["study", "character"];

/** One request as each screen reads it (`vppsone.school_certificate_requests_list`). */
export type CertificateRequestRow = {
  id: string;
  studentId: string;
  sessionLabel: string;
  classId: string;
  kind: RequestKind;
  purpose: string | null;
  extras: { conduct?: ConductGrade };
  note: string | null;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  state: RequestState;
  decidedByName: string | null;
  decidedAt: string | null;
  declineReason: string | null;
  issueId: string | null;
  serial: string | null;
  issueStatus: CertificateStatus | null;
  issueReady: boolean;
  signed: boolean;
  studentName: string;
  admissionNo: string;
  classLabel: string;
  mine: boolean;
  /** Only an approver gets these two, to check before signing. */
  fatherName: string | null;
  dateOfBirth: string | null;
};

/**
 * What the person who asked sees, in one word:
 *  - `waiting`  — with the approver;
 *  - `ready`    — approved, signed and stored: download it;
 *  - `declined` — the approver said why;
 *  - `gone`     — approved, but the office has since cancelled that copy.
 */
export type RequestStage = "waiting" | "ready" | "declined" | "gone";
export function requestStage(row: Pick<CertificateRequestRow, "state" | "issueReady">): RequestStage {
  if (row.state === "waiting") return "waiting";
  if (row.state === "declined") return "declined";
  if (row.state === "approved") return row.issueReady ? "ready" : "gone";
  return "gone";
}

/** The database's refusal codes, as the screens explain them. */
export const requestErrorCodes = [
  "forbidden", "not_enrolled", "invalid_kind", "invalid_purpose", "invalid_note", "invalid_extras", "conduct_required",
  "command_reused", "decided", "reason_required", "issue_mismatch", "not_ready", "invalid_scope",
] as const;
export type RequestErrorCode = (typeof requestErrorCodes)[number] | "unavailable" | "invalid" | "blocked";
