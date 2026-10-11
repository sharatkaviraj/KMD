// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: navigation.refresh }) }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string }) => p.en, sub: () => null }), Bi: ({ en }: { en: string }) => <span>{en}</span> }));
import { Student360, type Student360Fees, type Student360Props } from "@/vx/screens/admin/student360";

const p: Student360Props = {
  id: "00000000-0000-4000-8000-000000000001", name: "QA Child", classLabel: "QA Class", sr: "QA-1", rollNo: "1",
  status: "active", father: null, mother: null, phone: null, address: null, dob: null, joined: null, route: null,
  tab: "overview", tabs: ["overview", "fees", "family", "attendance", "marks", "notes", "documents", "history", "info"],
  money: null, installments: null, feeSummary: null, feeBreakup: null, feeSession: null, receipts: null, family: null,
  attendance: { percent: 90, counted: 10, counts: { present: 9, absent: 1, half_day: 0, late: 0, leave: 0 }, weeks: [] },
  terms: [], documents: [],
  notes: [{ id: "qa-note", body: "QA school note", tags: ["talent"], status: "open", needsFollowUp: false, followUpOn: null, followUpOwner: null, followUpName: null, by: "QA Staff", createdAt: "2026-10-10" }],
  history: [], today: "2026-10-10", canCollect: false, canManageDocuments: false, canManageFees: false, canAddNote: false,
};
function deferred() {
  let resolve!: (value: Student360Fees | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Student360Fees | null>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const fees: Student360Fees = { family: [{ id: "qa-sibling", name: "QA Sibling", sr: "QA-2", classLabel: "QA Class", self: false }] };
let root: Root; let host: HTMLDivElement;
async function render(promise?: Promise<Student360Fees | null>, initial: Student360Props = p) {
  await act(async () => root.render(<Student360 p={initial} fees={promise} />));
}
async function click(label: string) {
  const anchor = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(a => a.textContent === label)!;
  await act(async () => anchor.click());
}
const selected = () => host.querySelector('[aria-current="page"]')?.textContent;
beforeEach(() => {
  navigation.refresh.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", `/students/${p.id}`);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("Student 360 delayed fee streaming", () => {
  it("renders the school card and notes while the fee read is unresolved", async () => {
    const read = deferred(); await render(read.promise);
    expect(host.textContent).toContain("QA Child"); expect(host.textContent).toContain("90%");
    expect(host.textContent).toContain("QA school note"); expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => read.resolve(fees));
  });
  it("keeps the attendance tab and URL chosen during loading when fees arrive", async () => {
    const read = deferred(); await render(read.promise); await click("Attendance");
    expect(selected()).toBe("Attendance"); expect(window.location.search).toBe("?tab=attendance");
    await act(async () => read.resolve(fees));
    expect(selected()).toBe("Attendance"); expect(window.location.search).toBe("?tab=attendance");
    expect(host.textContent).toContain("90%"); expect(host.textContent).not.toContain("QA Sibling");
    await click("Family"); expect(host.textContent).toContain("QA Sibling");
  });
  it("does not claim there are no siblings before the family read resolves", async () => {
    const read = deferred(); await render(read.promise); await click("Family");
    expect(host.textContent).toContain("Loading fees"); expect(host.textContent).not.toContain("No brothers or sisters linked");
    await act(async () => read.resolve(fees));
    expect(selected()).toBe("Family"); expect(host.textContent).toContain("QA Sibling"); expect(host.textContent).not.toContain("Loading fees");
  });
  it("keeps a deep-linked fees tab loading until the read completes", async () => {
    const read = deferred(); await render(read.promise, { ...p, tab: "fees" });
    expect(selected()).toBe("Fees"); expect(host.textContent).toContain("Loading fees");
    expect(host.textContent).not.toContain("No fee record");
    await act(async () => read.resolve(null));
    expect(selected()).toBe("Fees"); expect(host.textContent).toContain("No fee record");
  });
  it("preserves school notes and offers retry without false empty states after a fee error", async () => {
    const read = deferred(); const handled = read.promise.catch(() => ({ unavailable: true }));
    await render(handled); await click("Notes");
    await act(async () => read.reject(new Error("QA fee read failed")));
    expect(selected()).toBe("Notes"); expect(host.textContent).toContain("QA Child"); expect(host.textContent).toContain("QA school note");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    await click("Fees"); expect(host.textContent).not.toContain("No fee record");
    await click("Family"); expect(host.textContent).not.toContain("No brothers or sisters linked");
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Try again")!.click());
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
  it("removes the error and retains the chosen tab when a retry's new stream succeeds", async () => {
    await render(Promise.resolve({ unavailable: true })); await click("Family");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await render(Promise.resolve(fees));
    expect(host.querySelector('[role="alert"]')).toBeNull(); expect(selected()).toBe("Family");
    expect(host.textContent).toContain("QA Sibling");
  });
  it("does not expose fee tabs or a loading fee tile for a school-only model", async () => {
    await render(undefined, { ...p, tabs: ["overview", "attendance", "marks", "notes"] });
    expect(host.textContent).toContain("QA Child"); expect(host.textContent).toContain("90%");
    expect([...host.querySelectorAll("a")].some(a => a.textContent === "Fees")).toBe(false);
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe("Student 360 overview", () => {
  const school: Student360Props = { ...p, tabs: ["overview", "attendance", "marks", "notes"] };

  it("shows the name once, with no fee share beside the child's identity", async () => {
    await render(undefined, school);
    // The bar carries it (a desktop h1 and the phone title, one shown at a time); the page body does not repeat it.
    expect(host.querySelector("h1")?.textContent).toBe("QA Child");
    expect(host.querySelector("main")!.textContent).not.toContain("QA Child");
    expect(host.textContent).not.toContain("of the year paid");
  });
  it("says a term with a blank paper is provisional, beside its percentage", async () => {
    await render(undefined, { ...school, terms: [{ term: "QA Term", percent: 72, grade: "B", missing: 1, papers: 6, scored: 360, outOf: 500 }] });
    expect(host.textContent).toContain("72%");
    expect(host.textContent).toContain("QA Term · Provisional · 1 paper not entered");
    await click("Marks");
    expect(host.textContent).toContain("B · Provisional");
  });
  it("does not call a complete term provisional", async () => {
    await render(undefined, { ...school, terms: [{ term: "QA Term", percent: 72, grade: "B", missing: 0, papers: 6, scored: 432, outOf: 600 }] });
    expect(host.textContent).not.toContain("Provisional");
  });
  it("says plainly when there is nothing yet, and never hints at a lack of talent", async () => {
    await render(undefined, { ...school, notes: [], attendance: { ...p.attendance, percent: null, counted: 0 } });
    expect(host.textContent).toContain("No attendance recorded yet");
    expect(host.textContent).toContain("No observation recorded");
    expect(host.textContent).toContain("No open support action");
  });
  it("keeps a health note out of strengths and shows the open action with owner and review date", async () => {
    await render(undefined, {
      ...school,
      notes: [
        { ...p.notes[0], id: "qa-health", body: "QA health talent note", tags: ["talent", "health"] },
        { ...p.notes[0], id: "qa-action", body: "QA reading support", tags: ["studies"], needsFollowUp: true, followUpOn: "2026-10-08", followUpOwner: "class_teacher" },
      ],
    });
    expect(host.textContent).not.toContain("QA health talent note");
    expect(host.textContent).toContain("No observation recorded");
    expect(host.textContent).toContain("QA reading support");
    expect(host.textContent).toContain("Owner: Class teacher");
    expect(host.textContent).toContain("Review: 2 days late");
  });
  it("leaves the strengths and support cards out for a reader without notes", async () => {
    await render(undefined, { ...school, tabs: ["overview", "attendance", "marks"] });
    expect(host.textContent).not.toContain("Strengths");
    expect(host.textContent).not.toContain("No open support action");
  });
});
