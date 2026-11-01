import { describe, expect, it } from "vitest";
import { cycleSchema, resultSchema, boardCounts, readinessFor, verifiedDeadline, latestResults, cycleRoster, boardMutationStudent } from "@/modules/official-results/domain/board";
import type { Candidate } from "@/modules/official-results/domain/board";
import type { ReturnStudent } from "@/modules/government-records/domain/exchange";

const sid = "00000000-0000-4000-8000-000000000001";
const config = { authority: "class5" as const, label: "Synthetic board", sessionLabel: "TEST-2026-27", attempt: "main" as const, attemptLabel: "Main", classIds: [sid], subjects: [{ code: "001", label: "Synthetic subject" }], requirements: [{ key: "photo", label: "Photo", required: true }], sourceReference: "Synthetic circular reference", verifiedOn: "2026-11-01", responsible: "Synthetic coordinator", deadline: null };
describe("school office board boundaries", () => {
 it("keeps authorities and actual subject codes distinct without annual defaults", () => {
   for (const authority of ["class5", "class8", "rbse10", "rbse12"]) expect(cycleSchema.parse({ ...config, authority }).subjects).toEqual(config.subjects);
   expect(cycleSchema.safeParse({ ...config, subjects: [] }).success).toBe(false);
   expect(cycleSchema.safeParse({ ...config, subjects: [config.subjects[0], config.subjects[0]] }).success).toBe(false);
 });
 it("does not publish an unverified, historical, conflicting or impossible deadline", () => {
   const deadline = { date: "2026-12-01", sourceReference: "Synthetic dated circular", verifiedOn: "2026-11-01", current: true, conflict: false };
   expect(verifiedDeadline({ ...config, deadline })).toEqual(deadline);
   expect(verifiedDeadline({ ...config, deadline: { ...deadline, conflict: true } })).toBeNull();
   expect(verifiedDeadline({ ...config, deadline: { ...deadline, current: false } })).toBeNull();
   expect(cycleSchema.safeParse({ ...config, deadline: { ...deadline, date: "2026-02-30" } }).success).toBe(false);
 });
 it("document presence does not become checked, submitted, accepted or financial clearance", () => {
   expect(readinessFor(config.requirements, [{ key: "photo", status: "present", reference: "Synthetic document" }])).toBe("needs_details");
   expect(readinessFor(config.requirements, [{ key: "photo", status: "accepted", reference: "Synthetic acknowledgement" }])).toBe("accepted");
   expect(readinessFor(config.requirements, [])).toBe("needs_details");
 });
 it("preserves pending versus zero and authority fail text", () => {
   const value = { studentId: sid, subjectCode: "001", status: "available", rawValue: "0", rawStatus: "FAIL", appearance: "appeared", sourceReference: "Synthetic issued result sheet", expectedRevision: 0, candidateRevision: 1, cycleRevision: 1 };
   expect(resultSchema.parse(value).rawValue).toBe("0");
   expect(resultSchema.safeParse({ ...value, status: "pending", rawValue: "0" }).success).toBe(false);
   expect(resultSchema.parse({ ...value, status: "pending", rawValue: null, rawStatus: "PENDING" }).rawValue).toBeNull();
 });
 it("supersedes only the same cycle/student/subject; separate attempts survive", () => {
   const rows = [{ cycle_id: "main", student_id: sid, subject_code: "001", revision: 1 }, { cycle_id: "main", student_id: sid, subject_code: "001", revision: 2 }, { cycle_id: "supplementary", student_id: sid, subject_code: "001", revision: 1 }];
   expect(latestResults(rows)).toEqual([rows[1], rows[2]]);
 });
 it("reports honest registered subject denominators and unknown appearance", () => {
   const candidates = [{ student_id: sid, verified: true, subjects: ["001", "002"] }];
   const results = [{ student_id: sid, subject_code: "001", status: "available" as const, appearance: "unknown" as const }];
   expect(boardCounts(3, candidates, results)).toEqual({ candidates: 3, registered: 1, appeared: 0, appearanceUnknown: 1, available: 1, pending: 1, expectedSubjects: 2 });
 });
 it("retains a graduated/departed registration's exact identity and denominator", () => {
   const snapshot = { studentId: sid, studentName: "Synthetic original candidate", admissionNo: "00017", classId: sid, classLabel: "5 A", sessionLabel: "TEST-2026-27", identityVerified: true as const, enrolmentStatus: "enrolled" as const, sourceRevision: "test:old" };
   const registered = { cycle_id: sid, student_id: sid, verified: true, subjects: ["001"], student_snapshot: snapshot } as Candidate;
   const roster = cycleRoster(config, [], [registered], "test:current");
   expect(roster).toHaveLength(1); expect(roster[0]).toMatchObject({ studentName: snapshot.studentName, classLabel: "5 A", sourceRevision: "test:current" });
   expect(boardCounts(roster.length, [registered], [])).toMatchObject({ candidates: 1, registered: 1, pending: 1, expectedSubjects: 1 });
   const moved = { ...snapshot, classId: "00000000-0000-4000-8000-000000000099", classLabel: "6 B", studentName: "Synthetic newer name", schoolCode: "", externalId: "", registrationStatus: "", externalRevision: 0 } as ReturnStudent;
   expect(cycleRoster(config, [moved], [registered], "test:current")[0].studentName).toBe(snapshot.studentName);
   expect(boardMutationStudent(config, sid, "result", [], registered).studentId).toBe(sid);
   expect(boardMutationStudent(config, sid, "readiness", [], registered).classId).toBe(sid);
   expect(() => boardMutationStudent(config, sid, "candidate", [], registered)).toThrow();
   expect(() => boardMutationStudent(config, sid, "result", [], { ...registered, verified: false })).toThrow();
   expect(() => boardMutationStudent(config, "00000000-0000-4000-8000-000000000088", "result", [], registered)).toThrow();
 });
});
