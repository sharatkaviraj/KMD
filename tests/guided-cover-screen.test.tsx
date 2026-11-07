// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Review C01: the guided cover screen, with its server actions stubbed.
 * Synthetic teachers and classes only; nothing is saved or sent.
 */

const actions = vi.hoisted(() => ({ preview: vi.fn(), confirm: vi.fn(), check: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/substitutions/guided-actions", () => ({
  previewGuidedCoverAction: actions.preview,
  confirmGuidedCoverAction: actions.confirm,
  checkGuidedCoverAction: actions.check,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: actions.push, replace: actions.replace, refresh: actions.refresh }) }));
vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: unknown }) => {
    void prefetch;
    return <a href={href} {...rest}>{children}</a>;
  },
}));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ language: "en", tx: (p: { en: string } | string) => (typeof p === "string" ? p : p.en), sub: () => null }) }));

import { GuidedCoverScreen } from "@/vx/screens/timetable/guided-cover";
import type { GuidedPreview, GuidedSetup } from "@/modules/substitutions/data/guided";

const A = "00000000-0000-4000-8000-0000000000a1";
const M = "00000000-0000-4000-8000-0000000000b1";
const N = "00000000-0000-4000-8000-0000000000b2";
const Q = "00000000-0000-4000-8000-0000000000b3";

const setup: GuidedSetup = {
  day: "2026-11-03",
  dayRevision: 4,
  blocked: null,
  bells: Array.from({ length: 8 }, (_, index) => ({ index, starts: `0${8 + Math.floor(index / 2)}:00`.slice(-5), ends: "09:00" })),
  openPeriods: [0, 1, 2, 3, 4, 5, 6, 7],
  teachers: [
    { id: A, name: "Test Teacher A", lessons: [{ period: 0, classLabels: ["Class 6"], subjectCode: "MATHS" }], away: null, onLeave: null },
    { id: M, name: "Test Teacher M", lessons: [], away: null, onLeave: null },
  ],
};

function previewFor(choices: { needKey: string; coveringStaffId: string | null }[], fingerprint = "1-first"): GuidedPreview {
  const chosen = choices.find((c) => c.needKey === "L1");
  const holder = chosen ? chosen.coveringStaffId : M;
  const option = (id: string, name: string, conflict: null | "teaching") => ({ id, name, tier: "exact" as const, warnings: [], conflict, autoEligible: conflict === null, workload: { today: 0, week: 2 }, proposed: id === holder });
  return {
    day: "2026-11-03",
    dayRevision: 4,
    fingerprint,
    staffProfileId: A,
    periods: [0, 1, 2, 3, 4, 5, 6, 7],
    choices,
    lessons: [{
      needKey: "L1", period: 0, classLabels: ["Class 6"], subjectCode: "MATHS", automatic: true,
      status: holder ? "assigned" : "needs_help", coveringStaffId: holder, reason: holder ? null : "released", chosen: Boolean(chosen),
      options: [option(M, "Test Teacher M", null), option(N, "Test Teacher N", null), option(Q, "Test Teacher Q", "teaching")],
    }],
    begun: [],
    others: [],
    refused: [],
    tally: { assigned: holder ? 1 : 0, needsHelp: holder ? 0 : 1, total: 1 },
    messages: holder ? [{ staffId: holder, name: holder === N ? "Test Teacher N" : "Test Teacher M", hasPhone: true, lessons: [{ period: 0, classLabels: ["Class 6"], subjectCode: "MATHS", kind: "assigned" }] }] : [],
    withdrawn: [],
  };
}

const saved = { status: "saved" as const, receipt: { commandId: "x", dayRevision: 5, assigned: 1, needsHelp: 0, added: 1, changed: 0, cancelled: 0, unchanged: 0, pinned: 0, skippedStarted: 0, noticesQueued: 1, noticesWithdrawn: 0, noticeRecipients: 1, recipientsWithoutPhone: 0, replayed: false }, committed: [{ period: 0, classLabels: ["Class 6"], subjectCode: "MATHS", status: "assigned" as const, coveringName: "Test Teacher N" }] };

let root: Root;
let host: HTMLDivElement;
const text = () => host.textContent ?? "";
const button = (label: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim().startsWith(label));
  if (!found) throw new Error(`No button "${label}" in: ${text().slice(0, 400)}`);
  return found;
};
const click = (label: string) => act(async () => button(label).click());
const flush = () => act(async () => { await Promise.resolve(); });

async function pickTeacher() {
  const select = host.querySelector("select")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, A);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function toReview() {
  await act(async () => root.render(<GuidedCoverScreen setup={setup} today="2026-11-03" subjects={{ MATHS: { en: "Maths", hi: "गणित" } }} previewing={false} initial={{ staffProfileId: null, periods: null, choices: [], autoPreview: false, fromDraft: false, draftMissing: false }} />));
  await pickTeacher();
  await click("Show their lessons");
  await click("Test Teacher N");
  await click("Review");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.preview.mockImplementation(async (input: { choices: { needKey: string; coveringStaffId: string | null }[] }) => ({ ok: true, preview: previewFor(input.choices) }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

// The first render compiles the vx kit; on a loaded machine that alone took over 5 s.
describe("GuidedCoverScreen", { timeout: 30_000 }, () => {
  it("walks who → lessons → review → confirm, and says Saved only after the server does", async () => {
    await toReview();
    expect(actions.preview).toHaveBeenNthCalledWith(1, { day: "2026-11-03", staffProfileId: A, periods: [0, 1, 2, 3, 4, 5, 6, 7], choices: [] });
    expect(actions.preview).toHaveBeenLastCalledWith(expect.objectContaining({ choices: [{ needKey: "L1", coveringStaffId: N }] }));
    expect(text()).toContain("Check before saving");
    expect(text()).toContain("Nothing is saved until you press Confirm.");
    // The WhatsApp message is said before Confirm: who, how many, and that it is WhatsApp.
    expect(text()).toContain("Confirming queues 1 WhatsApp message to 1 teacher");
    expect(text()).toContain("Test Teacher N — P1 Class 6");
    expect(actions.confirm).not.toHaveBeenCalled();

    let answer!: (value: unknown) => void;
    actions.confirm.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    await click("Confirm and save");
    expect(text()).toContain("Saving…");
    expect(text()).not.toContain("Saved cover");
    const sent = actions.confirm.mock.calls[0][0];
    expect(sent).toMatchObject({ day: "2026-11-03", dayRevision: 4, staffProfileId: A, fingerprint: "1-first", choices: [{ needKey: "L1", coveringStaffId: N }] });
    expect(sent.commandId).toMatch(/^[0-9a-f-]{36}$/);

    await act(async () => answer(saved));
    expect(text()).toContain("Saved cover");
    expect(text()).toContain("→ Test Teacher N");
    expect(text()).toContain("1 WhatsApp message queued for 1 teacher. Queued is not delivered yet");
  });

  it("a day changed by somebody else is said plainly, read again, and confirmed as a new command", async () => {
    await toReview();
    actions.confirm.mockResolvedValueOnce({ status: "stale" });
    actions.preview.mockImplementation(async (input: { choices: { needKey: string; coveringStaffId: string | null }[] }) => ({ ok: true, preview: { ...previewFor(input.choices, "1-second"), dayRevision: 5 } }));
    await click("Confirm and save");
    await flush();
    expect(text()).toContain("Somebody else changed cover for this day after you looked. Nothing was saved.");
    expect(text()).not.toContain("Saved cover");
    actions.confirm.mockResolvedValueOnce(saved);
    await click("Confirm and save");
    const [first, second] = actions.confirm.mock.calls.map((call) => call[0]);
    expect(second).toMatchObject({ dayRevision: 5, fingerprint: "1-second" });
    expect(second.commandId).not.toBe(first.commandId);
    expect(text()).toContain("Saved cover");
  });

  it("an answer that never came is checked; Try again resends the same command", async () => {
    await toReview();
    actions.confirm.mockRejectedValueOnce(new TypeError("fetch failed"));
    actions.check.mockResolvedValueOnce({ status: "not_found" });
    await click("Confirm and save");
    await flush();
    expect(actions.check).toHaveBeenCalledWith(expect.objectContaining({ commandId: actions.confirm.mock.calls[0][0].commandId }));
    expect(text()).toContain("Not saved. Try again sends the same request");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();

    actions.confirm.mockResolvedValueOnce({ ...saved, receipt: { ...saved.receipt, replayed: true } });
    await click("Try again");
    expect(actions.confirm.mock.calls[1][0]).toEqual(actions.confirm.mock.calls[0][0]);
    expect(text()).toContain("Already saved — this is the earlier result");
  });

  it("a partial day asks for periods and sends only the picked ones", async () => {
    await act(async () => root.render(<GuidedCoverScreen setup={setup} today="2026-11-03" subjects={{}} previewing={false} initial={{ staffProfileId: null, periods: null, choices: [], autoPreview: false, fromDraft: false, draftMissing: false }} />));
    await pickTeacher();
    await click("Some periods");
    await click("Show their lessons");
    expect(text()).toContain("Pick at least one period.");
    expect(actions.preview).not.toHaveBeenCalled();
    const p1 = host.querySelector<HTMLButtonElement>('button[aria-label^="Period 1:"]')!;
    const p3 = host.querySelector<HTMLButtonElement>('button[aria-label^="Period 3:"]')!;
    expect(p1.getAttribute("aria-label")).toBe("Period 1: Class 6 · MATHS");
    await act(async () => { p1.click(); p3.click(); });
    expect(p1.getAttribute("aria-pressed")).toBe("true");
    await click("Show their lessons");
    expect(actions.preview).toHaveBeenCalledWith(expect.objectContaining({ periods: [0, 2] }));
  });

  it("previewing another role can look but never confirm", async () => {
    await act(async () => root.render(<GuidedCoverScreen setup={setup} today="2026-11-03" subjects={{}} previewing initial={{ staffProfileId: A, periods: [0], choices: [], autoPreview: true, fromDraft: false, draftMissing: false }} />));
    await flush();
    await click("Review");
    expect(text()).toContain("You are previewing another role");
    expect(button("Confirm and save").disabled).toBe(true);
  });
});
