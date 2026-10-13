// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: navigation.refresh }), usePathname: () => window.location.pathname }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string }) => p.en, sub: () => null }), Bi: ({ en }: { en: string }) => <span>{en}</span> }));
vi.mock("@/vx/screens/family-contact/actions", () => ({ logFamilyContactAction: vi.fn() }));
vi.mock("@/vx/screens/notes/actions", () => ({ setNoteStatusAction: vi.fn(), replyToNoteAction: vi.fn() }));
import { Student360, type Student360Fees, type Student360Props } from "@/vx/screens/admin/student360";

const p: Student360Props = {
  id: "00000000-0000-4000-8000-000000000001", name: "QA Child", classLabel: "QA Class", sr: "QA-1", rollNo: "1",
  status: "active", father: null, mother: null, phone: null, address: null, dob: null, joined: null, route: null,
  tab: "overview", tabs: ["overview", "fees", "family", "attendance", "marks", "notes", "documents", "history", "info"],
  money: null, installments: null, feeSummary: null, feeBreakup: null, feeSession: null, receipts: null, family: null,
  attendance: { percent: 90, counted: 10, counts: { present: 9, absent: 1, half_day: 0, late: 0, leave: 0 }, weeks: [] },
  terms: [], documents: [],
  notes: [{ id: "qa-note", body: "QA school note", tags: ["talent"], status: "open", needsFollowUp: false, followUpOn: null, followUpOwner: null, followUpName: null, by: "QA Staff", createdAt: "2026-10-10" }],
  history: [], today: "2026-10-10", canCollect: false, canManageDocuments: false, canManageFees: false, canAddNote: false, contacts: null,
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
  // Match the page's key: changing students remounts the card.
  await act(async () => root.render(<Student360 key={initial.id} p={initial} fees={promise} />));
}
async function click(label: string) {
  // The design draws every tab as a chip in one row (F06–F08).
  const anchor = [...host.querySelectorAll<HTMLAnchorElement>(".s360-tabs a")].find(a => a.textContent === label)!;
  await act(async () => anchor.click());
}
const selected = () => host.querySelector('.s360-tabs [aria-current="page"]')?.textContent;
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
    window.history.replaceState(null, "", `/students/${p.id}?tab=fees`);
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

  it("shows the design's chips in order, and no Fees for a school-only reader", async () => {
    await render();
    expect([...host.querySelectorAll('.s360-tabs a')].map(a => a.textContent)).toEqual(["Overview", "Fees", "Attendance", "Marks", "Family", "Info", "Notes", "Documents", "History"]);
    await render(undefined, school);
    expect([...host.querySelectorAll('.s360-tabs a')].map(a => a.textContent)).toEqual(["Overview", "Attendance", "Marks", "Notes"]);
  });

  it("uses initials for missing or failed private portraits and retries a changed URL", async () => {
    await render(); expect(host.querySelector('.s360-ava [role="img"]')?.textContent).toBe("QC");
    await render(undefined, { ...p, photoUrl: "/synthetic-portrait.png" });
    expect(host.querySelector('.s360-ava img')).not.toBeNull();
    await act(async () => host.querySelector('.s360-ava img')!.dispatchEvent(new Event("error")));
    expect(host.querySelector('.s360-ava img')).toBeNull();
    expect(host.querySelector('.s360-ava [role="img"]')?.textContent).toBe("QC");
    await render(undefined, { ...p, photoUrl: "/synthetic-portrait-new.png" });
    expect(host.querySelector('.s360-ava img')).not.toBeNull();
  });

  it("does not invent active status or empty academic records when a read failed", async () => {
    await render(undefined, { ...school, status: null, notes: [], terms: [], unavailable: ["notes", "marks", "attendance"] });
    expect(host.textContent).toContain("Status not recorded");
    expect(host.textContent).not.toContain("Active");
    expect(host.textContent).not.toContain("No notes yet");
    expect(host.textContent).not.toContain("No marks entered yet");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("does not infer calendar cells when school closure data is unavailable", async () => {
    await render(undefined, { ...school, unavailable: ["calendar"], attendance: { ...school.attendance, weeks: [{ day: "2026-10-10", label: "Synthetic day cell", state: "none" }] } });
    await click("Attendance"); expect(host.textContent).not.toContain("Synthetic day cell");
    expect(host.textContent).toContain("90%"); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("puts the child's name in the one heading, with no fee share for a school-only reader", async () => {
    await render(undefined, school);
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector("h1")?.textContent).toBe("QA Child");
    expect(host.textContent).not.toContain("fees paid");
  });
  it("says a term with a blank paper is provisional, beside its percentage", async () => {
    await render(undefined, { ...school, terms: [{ term: "QA Term", percent: 72, grade: "B", missing: 1, papers: 6, scored: 360, outOf: 500 }] });
    expect(host.textContent).toContain("72%");
    expect(host.textContent).toContain("Provisional · 1 paper not entered");
    await click("Marks");
    expect(host.textContent).toContain("Provisional · 1 paper not entered");
    expect(host.textContent).toContain("B");
  });
  it("does not call a complete term provisional", async () => {
    await render(undefined, { ...school, terms: [{ term: "QA Term", percent: 72, grade: "B", missing: 0, papers: 6, scored: 432, outOf: 600 }] });
    expect(host.textContent).not.toContain("Provisional");
  });
  it("says plainly when there is nothing yet", async () => {
    await render(undefined, { ...school, notes: [], attendance: { ...p.attendance, percent: null, counted: 0 } });
    expect(host.textContent).toContain("No attendance recorded yet");
    expect(host.textContent).toContain("No notes yet");
  });
  it("shows the open support action with owner and review date", async () => {
    await render(undefined, {
      ...school,
      notes: [
        { ...p.notes[0], id: "qa-health", body: "QA health talent note", tags: ["talent", "health"] },
        { ...p.notes[0], id: "qa-action", body: "QA reading support", tags: ["studies"], needsFollowUp: true, followUpOn: "2026-10-08", followUpOwner: "class_teacher" },
      ],
    });
    expect(host.textContent).toContain("QA reading support");
    expect(host.textContent).toContain("Owner: Class teacher");
    expect(host.textContent).toContain("Review: 2 days late");
  });
  it("leaves the notes and support cards out for a reader without notes", async () => {
    await render(undefined, { ...school, tabs: ["overview", "attendance", "marks"] });
    expect(host.textContent).not.toContain("Notes from teachers");
    expect(host.textContent).not.toContain("Owner:");
  });
});

describe("Student 360 tab history", () => {
  it("resets a reused card for another student's URL", async () => {
    await render(); await click("Notes");
    const other = { ...p, id: "00000000-0000-4000-8000-000000000002" };
    window.history.replaceState(null, "", `/students/${other.id}`);
    await render(undefined, other);
    expect(selected()).toBe("Overview");
  });

  it("clamps the selected tab when refreshed role scopes remove it", async () => {
    await render(); await click("Notes");
    await render(undefined, { ...p, tabs: ["overview", "attendance"] });
    expect(selected()).toBe("Overview");
    expect(host.textContent).not.toContain("QA school note");
  });

  it("restores Notes from the URL when a cached Overview model remounts after All notes", async () => {
    await render();
    await click("Notes");
    expect(selected()).toBe("Notes");
    const returnUrl = window.location.href;
    // Leaving for the notes board unmounts the card. Next can return its
    // cached original props, while replaceState retained the selected tab.
    await act(async () => root.render(null));
    window.history.pushState(null, "", `/notes?student=${p.id}`);
    window.history.replaceState(null, "", returnUrl);
    await render();
    expect(window.location.search).toBe("?tab=notes");
    expect(selected()).toBe("Notes");
    expect(host.textContent).toContain("QA school note");
  });

  it("follows Back and Forward tab URLs without exposing an unavailable tab", async () => {
    await render(undefined, { ...p, tabs: ["overview", "attendance", "notes"] });
    await click("Notes");
    await act(async () => {
      window.history.replaceState(null, "", `/students/${p.id}?tab=attendance`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(selected()).toBe("Attendance");
    await act(async () => {
      window.history.replaceState(null, "", `/students/${p.id}?tab=fees`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(selected()).toBe("Overview");
    expect([...host.querySelectorAll("a")].some(a => a.textContent === "Fees")).toBe(false);
  });
});
