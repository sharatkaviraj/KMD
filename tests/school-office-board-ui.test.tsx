// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ candidate: vi.fn(), result: vi.fn(), readiness: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/exam-office/board/actions", () => ({ saveBoardCycleAction: vi.fn(), saveBoardCandidateAction: mocks.candidate, saveBoardReadinessAction: mocks.readiness, saveOfficialResultAction: mocks.result }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }), default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (value: { en: string } | string) => typeof value === "string" ? value : value.en }), Bi: ({ en }: { en: string }) => <span>{en}</span> }));
import { CandidateEditor, ReadinessEditor, ResultEditor } from "@/vx/screens/board-office/forms";
import { BoardWorkspace } from "@/vx/screens/board-office/workspace";
import type { BoardCycle, Candidate, Readiness } from "@/modules/official-results/domain/board";
import type { ReturnStudent } from "@/modules/government-records/domain/exchange";
const id = "00000000-0000-4000-8000-000000000001";
const cycle: BoardCycle = { id, session_label: "TEST-2026-27", revision: 2, updated_at: "2026-11-01", config: { authority: "class5", sessionLabel: "TEST-2026-27", attempt: "main", attemptLabel: "Synthetic main", label: "Synthetic examination", classIds: [id], subjects: [{ code: "001", label: "Synthetic subject" }], requirements: [{ key: "photo", label: "Synthetic photo", required: true }], sourceReference: "Synthetic current circular", verifiedOn: "2026-11-01", responsible: "Synthetic coordinator", deadline: null } };
const student: ReturnStudent = { studentId: id, studentName: "Synthetic pupil", admissionNo: "00017", classId: id, classLabel: "5 A", sessionLabel: "TEST-2026-27", schoolCode: "", externalId: "", registrationStatus: "", sourceRevision: "synthetic:1", externalRevision: 0, identityVerified: true };
const candidate: Candidate = { cycle_id: id, student_id: id, registration: "00031", roll: "00008", subjects: ["001"], verified: true, student_snapshot: { studentId: id, studentName: student.studentName, admissionNo: student.admissionNo, classId: id, classLabel: "5 A", sessionLabel: "TEST-2026-27", identityVerified: true, enrolmentStatus: "enrolled", sourceRevision: "synthetic:old" }, source_reference: "Synthetic registration reference", revision: 1, verified_by: id, verified_at: "2026-11-01" };
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); vi.clearAllMocks(); mocks.candidate.mockResolvedValue({ ok: true }); mocks.readiness.mockResolvedValue({ ok: true }); mocks.result.mockResolvedValue({ ok: true }); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (element: React.ReactNode) => act(async () => root.render(element));
const submit = async () => act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
async function choose(name: string, value: string) { await act(async () => { const node = host.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!; node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); }); }
it("registration subjects and verification are never inferred; uncertain retries retain the command ID", async () => {
 mocks.candidate.mockRejectedValueOnce(new Error("network"));
 await render(<CandidateEditor cycle={cycle} student={student} frozen={false} />);
 expect(host.querySelector<HTMLInputElement>('input[name="verified"]')!.checked).toBe(false);
 expect(host.querySelector<HTMLInputElement>('input[name="subject"]')!.checked).toBe(false);
 host.querySelector<HTMLInputElement>('input[name="registration"]')!.value = "00031"; host.querySelector<HTMLInputElement>('input[name="roll"]')!.value = "00008"; host.querySelector<HTMLTextAreaElement>("textarea")!.value = "Synthetic registration reference";
 host.querySelector<HTMLInputElement>('input[name="subject"]')!.checked = true; host.querySelector<HTMLInputElement>('input[name="verified"]')!.checked = true;
 await submit(); expect(host.textContent).toContain("Could not save"); await submit();
 expect(mocks.candidate.mock.calls[0][0].commandId).toBe(mocks.candidate.mock.calls[1][0].commandId);
 expect(mocks.candidate.mock.calls[1][0].payload).toMatchObject({ registration: "00031", roll: "00008", subjects: ["001"], verified: true });
});
it("pending entry has no numeric value; zero survives an explicit available outcome", async () => {
 await render(<ResultEditor cycle={cycle} student={student} candidate={candidate} results={[]} />);
 expect(host.querySelector<HTMLInputElement>('input[name="rawValue"]')!.disabled).toBe(true);
 host.querySelector<HTMLInputElement>('input[name="rawStatus"]')!.value = "PENDING"; host.querySelector<HTMLTextAreaElement>("textarea")!.value = "Synthetic issued result sheet";
 await submit(); expect(JSON.parse(mocks.result.mock.calls[0][0].get("input")).payload).toMatchObject({ status: "pending", rawValue: null, appearance: "unknown" });
 await choose("status", "available"); host.querySelector<HTMLInputElement>('input[name="rawValue"]')!.value = "0"; host.querySelector<HTMLInputElement>('input[name="rawStatus"]')!.value = "FAIL";
 await submit(); expect(JSON.parse(mocks.result.mock.calls[1][0].get("input")).payload).toMatchObject({ rawValue: "0", rawStatus: "FAIL", expectedRevision: 0, candidateRevision: 1, cycleRevision: 2 });
});
it("a changed circular invalidates an older accepted checklist fact until checked again", async () => {
 const evidence: Readiness = { cycle_id: id, student_id: id, key: "photo", status: "accepted", reference: "Synthetic old acknowledgement", revision: 4, cycle_revision: 1, updated_at: "2026-11-01" };
 await render(<ReadinessEditor cycle={cycle} student={student} requirement={cycle.config.requirements[0]} evidence={evidence} />);
 expect(host.textContent).toContain("circular or checklist changed");
 expect(host.querySelector<HTMLSelectElement>('select[name="status"]')!.value).toBe("missing");
 expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
 await submit(); expect(mocks.readiness.mock.calls[0][0].payload).toMatchObject({ expectedRevision: 4, cycleRevision: 2, status: "missing" });
});
it("office viewers can inspect readiness and results but receive no edit forms", async () => {
 await render(<BoardWorkspace mode="board" sessionLabel="TEST-2026-27" canManage={false} unavailable={false} workspace={{ cycles: [cycle], cycle, roster: [student], sourceRevision: "synthetic:1", candidates: [candidate], readiness: [], results: [], history: [] }} />);
 expect(host.querySelector("form")).toBeNull();
 expect(host.textContent).toContain("00031"); expect(host.textContent).toContain("No confirmed deadline");
 expect(host.textContent).toContain("0 / 1");
});
it("retains a departed pupil's name, registered denominator and result entry while source is healthy", async () => {
 await render(<BoardWorkspace mode="results" sessionLabel="TEST-2026-27" canManage unavailable={false} workspace={{ cycles: [cycle], cycle, roster: [], sourceRevision: "synthetic:1", candidates: [candidate], readiness: [], results: [], history: [] }} />);
 expect(host.textContent).toContain("Synthetic pupil"); expect(host.textContent).toContain("1 / 1");
 expect(host.querySelector('form input[name="rawStatus"]')).not.toBeNull();
 expect(host.querySelector('input[name="registration"]')).toBeNull();
 await render(<BoardWorkspace mode="results" sessionLabel="TEST-2026-27" canManage unavailable={false} workspace={{ cycles: [cycle], cycle, roster: null, sourceRevision: null, candidates: [candidate], readiness: [], results: [], history: [] }} />);
 expect(host.textContent).toContain("Synthetic pupil"); expect(host.textContent).toContain("current roster could not be verified");
 expect(host.querySelector("form")).toBeNull();
});
it("filters profile entry by exact student ID and keeps that scope across board/cycle links", async () => {
 const second = { ...student, studentId: "00000000-0000-4000-8000-000000000099", studentName: "Synthetic other pupil" };
 await render(<BoardWorkspace mode="results" sessionLabel="TEST-2026-27" studentId={id} canManage={false} unavailable={false} workspace={{ cycles: [cycle], cycle, roster: [student, second], sourceRevision: "synthetic:1", candidates: [candidate], readiness: [], results: [], history: [] }} />);
 expect(host.querySelectorAll("article")).toHaveLength(1); expect(host.textContent).not.toContain(second.studentName);
 expect(host.querySelector(`a[href="/exam-office/board?cycle=${id}&student=${id}"]`)).not.toBeNull();
 const clear = [...host.querySelectorAll("a")].find(row => row.textContent === "Show all candidates");
 expect(clear?.getAttribute("href")).toBe(`/exam-office/official-results?cycle=${id}`);
 await act(async () => host.querySelector<HTMLSelectElement>("select")!.dispatchEvent(new Event("change", { bubbles: true })));
 expect(mocks.push).toHaveBeenCalledWith(`/exam-office/official-results?cycle=${id}&student=${id}`);
});
