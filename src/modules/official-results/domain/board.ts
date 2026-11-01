import { z } from "zod";
import type { ReturnStudent } from "@/modules/government-records/domain/exchange";

export const authorities = ["class5", "class8", "rbse10", "rbse12"] as const;
export const attempts = ["main", "supplementary", "improvement", "corrected"] as const;
export const readinessStatuses = ["missing", "present", "checked", "submitted", "accepted", "rejected"] as const;
export const resultStatuses = ["pending", "available", "withheld", "absent", "cancelled"] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(`${value}T12:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; });
const reference = z.string().trim().min(10).max(1000);
const unique = (values: string[]) => new Set(values).size === values.length;
export const deadlineSchema = z.object({ date, sourceReference: reference, verifiedOn: date, current: z.boolean(), conflict: z.boolean() });
export const cycleSchema = z.object({
 authority: z.enum(authorities), label: z.string().trim().min(3).max(120), sessionLabel: z.string().regex(/^(?:TEST-)?\d{4}-\d{2}$/),
 attempt: z.enum(attempts), attemptLabel: z.string().trim().min(2).max(80), classIds: z.array(z.uuid()).min(1).max(100).refine(unique),
 subjects: z.array(z.object({ code: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(100) })).min(1).max(80).refine(rows => unique(rows.map(row => row.code))),
 requirements: z.array(z.object({ key: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/), label: z.string().trim().min(1).max(150), required: z.boolean() })).max(40).refine(rows => unique(rows.map(row => row.key))),
 sourceReference: reference, verifiedOn: date, responsible: z.string().trim().min(2).max(120), deadline: deadlineSchema.nullable(),
}).strict();
export type BoardConfig = z.infer<typeof cycleSchema>;
export type BoardCycle = { id: string; session_label: string; config: BoardConfig; revision: number; updated_at: string };
export const candidateSchema = z.object({ studentId: z.uuid(), registration: z.string().trim().min(1).max(100), roll: z.string().trim().min(1).max(100), subjects: z.array(z.string().min(1).max(40)).min(1).max(80).refine(unique), verified: z.boolean(), sourceReference: reference, expectedRevision: z.number().int().min(0), cycleRevision: z.number().int().positive() }).strict();
export const candidateSnapshotSchema = z.object({ studentId: z.uuid(), studentName: z.string().min(1), admissionNo: z.string(), classId: z.uuid(), classLabel: z.string().min(1), sessionLabel: z.string(), identityVerified: z.literal(true), enrolmentStatus: z.literal("enrolled"), sourceRevision: z.string().min(1) }).strict();
export type CandidateSnapshot = z.infer<typeof candidateSnapshotSchema>;
export type Candidate = { cycle_id: string; student_id: string; registration: string; roll: string; subjects: string[]; verified: boolean; student_snapshot: CandidateSnapshot | null; source_reference: string; revision: number; verified_by: string; verified_at: string };
export const readinessSchema = z.object({ studentId: z.uuid(), key: z.string().min(1).max(50), status: z.enum(readinessStatuses), reference: z.string().trim().max(1000), expectedRevision: z.number().int().min(0), cycleRevision: z.number().int().positive() }).strict().refine(value => value.status === "missing" || value.reference.length >= 3);
export type Readiness = { cycle_id: string; student_id: string; key: string; status: typeof readinessStatuses[number]; reference: string; revision: number; cycle_revision: number; updated_at: string };
export const resultSchema = z.object({ studentId: z.uuid(), subjectCode: z.string().trim().min(1).max(40), status: z.enum(resultStatuses), rawValue: z.string().trim().min(1).max(250).nullable(), rawStatus: z.string().trim().min(1).max(250), appearance: z.enum(["appeared", "not_appeared", "unknown"]), sourceReference: reference, expectedRevision: z.number().int().min(0), candidateRevision: z.number().int().positive(), cycleRevision: z.number().int().positive() }).strict().superRefine((value, ctx) => {
 if ((value.status === "pending" || value.status === "withheld") && value.rawValue !== null) ctx.addIssue({ code: "custom", message: "Pending and withheld have no issued value" });
 if (value.status === "available" && value.rawValue === null) ctx.addIssue({ code: "custom", message: "An available result needs the exact issued value" });
});
export type OfficialResult = { id: string; cycle_id: string; student_id: string; subject_code: string; revision: number; supersedes: string | null; status: typeof resultStatuses[number]; raw_value: string | null; raw_status: string; appearance: "appeared" | "not_appeared" | "unknown"; source_reference: string; verified_by: string; verified_at: string; evidence_path: string | null; evidence_sha256: string | null; evidence_type: string | null; candidate_revision: number; cycle_revision: number };
export function verifiedDeadline(config: { deadline: z.infer<typeof deadlineSchema> | null }) {
 const checked = deadlineSchema.safeParse(config.deadline);
 return checked.success && checked.data.current && !checked.data.conflict ? checked.data : null;
}
export function readinessFor(requirements: { key: string; required: boolean }[], evidence: { key: string; status: string; reference: string }[]) {
 const required = requirements.filter(row => row.required);
 if (!required.length) return "unconfigured";
 const states = required.map(item => evidence.find(row => row.key === item.key && row.reference.trim())?.status ?? "missing");
 if (states.includes("rejected")) return "conflict";
 if (states.every(state => state === "accepted")) return "accepted";
 if (states.every(state => state === "submitted" || state === "accepted")) return "submitted";
 if (states.every(state => ["checked", "submitted", "accepted"].includes(state))) return "checked";
 return "needs_details";
}
export function latestResults<T extends { cycle_id: string; student_id: string; subject_code: string; revision: number }>(rows: T[]): T[] {
 const map = new Map<string, T>();
 for (const row of rows) { const key = `${row.cycle_id}:${row.student_id}:${row.subject_code}`; if ((map.get(key)?.revision ?? 0) < row.revision) map.set(key, row); }
 return [...map.values()];
}
export function boardCounts(candidateCount: number, candidates: Pick<Candidate, "student_id" | "verified" | "subjects">[], results: Pick<OfficialResult, "student_id" | "subject_code" | "status" | "appearance">[]) {
 const registered = candidates.filter(row => row.verified), expectedSubjects = registered.reduce((sum, row) => sum + row.subjects.length, 0);
 const scoped = results.filter(row => registered.some(candidate => candidate.student_id === row.student_id && candidate.subjects.includes(row.subject_code)));
 const available = scoped.filter(row => !["pending", "withheld"].includes(row.status)).length;
 const appeared = registered.filter(candidate => scoped.some(row => row.student_id === candidate.student_id && row.appearance === "appeared")).length;
 const appearanceUnknown = registered.filter(candidate => !scoped.some(row => row.student_id === candidate.student_id && row.appearance !== "unknown")).length;
 return { candidates: candidateCount, registered: registered.length, appeared, appearanceUnknown, available, pending: expectedSubjects - available, expectedSubjects };
}
function registeredSnapshot(config: BoardConfig, studentId: string, candidate?: Candidate): ReturnStudent | null {
 const snapshot = candidateSnapshotSchema.safeParse(candidate?.student_snapshot);
 if (!candidate?.verified || candidate.student_id !== studentId || !snapshot.success || snapshot.data.studentId !== studentId || snapshot.data.sessionLabel !== config.sessionLabel || !config.classIds.includes(snapshot.data.classId)) return null;
 return { ...snapshot.data, schoolCode: "", externalId: "", registrationStatus: "", externalRevision: 0 };
}
/** Registration freezes examination membership; it never invents identity from a name. */
export function cycleRoster(config: BoardConfig, current: ReturnStudent[], candidates: Candidate[], sourceRevision: string | null): ReturnStudent[] {
 const byId = new Map(current.filter(row => row.sessionLabel === config.sessionLabel && config.classIds.includes(row.classId)).map(row => [row.studentId, row]));
 for (const candidate of candidates) {
  const snapshot = registeredSnapshot(config, candidate.student_id, candidate);
  if (snapshot) byId.set(candidate.student_id, { ...snapshot, sourceRevision: sourceRevision ?? snapshot.sourceRevision });
 }
 return [...byId.values()];
}
/** Readiness/outcomes may use registered history; registration edits need current enrolment. */
export function boardMutationStudent(config: BoardConfig, studentId: string, kind: "candidate" | "readiness" | "result", current: ReturnStudent[], candidate?: Candidate): ReturnStudent {
 const snapshot = kind !== "candidate" ? registeredSnapshot(config, studentId, candidate) : null;
 if (snapshot) return snapshot;
 const pupil = current.find(row => row.studentId === studentId && row.sessionLabel === config.sessionLabel && row.identityVerified && config.classIds.includes(row.classId));
 if (!pupil || kind === "result") throw new Error("Board candidate identity is unavailable");
 return pupil;
}
