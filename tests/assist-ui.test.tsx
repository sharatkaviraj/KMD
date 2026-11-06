// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Test data only (rule 6). The network is mocked: no request leaves the test. */

const state = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string } | string) => (typeof p === "string" ? p : p.en), sub: () => null, language: "en" }) }));
vi.mock("@/vx/ui/overlays", () => ({ useToast: () => ({ show: state.toast }) }));

import type { AssistFeature } from "@/modules/assist/domain/features";
import { AskRow } from "@/vx/assist/ask-assist";
import { AssistProvider } from "@/vx/assist/context";
import { NoteAssist } from "@/vx/assist/note-assist";
import { AiRemarkCard, AiRemarksBar, useAiRemarks } from "@/vx/assist/remarks-assist";
import { CallScript } from "@/vx/assist/call-script";
import { ChildSummary } from "@/vx/assist/summary-assist";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(node: React.ReactNode, features: AssistFeature[]) {
  await act(async () => root.render(<AssistProvider features={features}>{node}</AssistProvider>));
}

const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text));

async function click(text: string) {
  const b = button(text);
  if (!b) throw new Error(`no button "${text}" in: ${host.textContent}`);
  await act(async () => b.click());
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}

const answer = (body: unknown) => ({ status: 200, json: async () => body });

describe("the AI buttons are absent unless the shell offers them", () => {
  it("renders nothing for a person without the feature", async () => {
    await render(<NoteAssist body="Quiet in class today, finds fractions hard" childName="Qatest Kumar" onApply={() => undefined} />, []);
    expect(host.textContent).toBe("");
  });
});

describe("note helper", () => {
  it("offers Tidy up, shows the suggestion, and Use puts it in the box", async () => {
    const onApply = vi.fn();
    fetchMock.mockResolvedValueOnce(answer({ ok: true, value: { text: "Quiet in class today; finds fractions hard.", tags: ["studies"] }, logId: "33333333-3333-4333-8333-333333333333" }));
    fetchMock.mockResolvedValue(answer({ ok: true }));
    await render(<NoteAssist body="quiet in class today finds fractions hard" childName="Qatest Kumar" onApply={onApply} />, ["note", "translate"]);
    expect(button("Tidy up")).toBeTruthy();
    expect(button("In Hindi")).toBeTruthy();

    await click("Tidy up");
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.task).toBe("note.polish");
    expect(host.textContent).toContain("Quiet in class today; finds fractions hard.");
    expect(host.textContent).toContain("Written by AI");

    await click("Use this");
    expect(onApply).toHaveBeenCalledWith("Quiet in class today; finds fractions hard.", ["studies"]);
    // The decision is reported, and the buttons come back.
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ logId: "33333333-3333-4333-8333-333333333333", decision: "kept" });
    expect(button("Tidy up")).toBeTruthy();
  });

  it("says a problem in one line and never applies anything", async () => {
    const onApply = vi.fn();
    fetchMock.mockResolvedValueOnce(answer({ ok: false, problem: "daily_cap" }));
    await render(<NoteAssist body="quiet in class today" childName={null} onApply={onApply} />, ["note"]);
    await click("Tidy up");
    expect(host.textContent).toContain("You have used today’s AI suggestions");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("waits for enough words before it offers to help", async () => {
    await render(<NoteAssist body="ok" childName={null} onApply={() => undefined} />, ["note"]);
    expect(button("Tidy up")?.disabled).toBe(true);
  });
});

describe("Ask in the search box", () => {
  const pages = [{ href: "/teach/notes", label: { en: "Notes on children" }, icon: "note" as const }];

  it("is offered for a question and not for a name", async () => {
    await render(<AskRow question="Qatest Kumar" pages={pages} onGo={() => undefined} onSearch={() => undefined} />, ["ask"]);
    expect(host.textContent).toBe("");
    await render(<AskRow question="how do I write a note?" pages={pages} onGo={() => undefined} onSearch={() => undefined} />, ["ask"]);
    expect(host.textContent).toContain("Ask:");
  });

  it("opens only a page it was given", async () => {
    const onGo = vi.fn();
    fetchMock.mockResolvedValueOnce(answer({ ok: true, value: { answer: "Open Notes and tap Add.", links: ["/teach/notes"], search: null }, logId: null }));
    await render(<AskRow question="how do I write a note?" pages={pages} onGo={onGo} onSearch={() => undefined} />, ["ask"]);
    await click("Ask:");
    expect(host.textContent).toContain("Open Notes and tap Add.");
    await click("Open");
    expect(onGo).toHaveBeenCalledWith("/teach/notes");
  });
});

describe("report-card remarks", () => {
  const kids = [
    { id: "c-1", percent: 72, attendance: 91, strongest: "Maths", weakest: "English" },
    { id: "c-2", percent: null, attendance: null },
  ];

  function Remarks({ current, onPick }: { current: string; onPick: (v: string) => void }) {
    const ai = useAiRemarks({ exam: "Term 1", classLabel: "QA 6 A" });
    return (
      <>
        <AiRemarksBar ai={ai} missing={kids} />
        <AiRemarkCard ai={ai} child={kids[0]} current={current} onPick={onPick} />
      </>
    );
  }

  it("sends refs and figures, never names, and offers the draft as a card to tap", async () => {
    const onPick = vi.fn();
    fetchMock.mockResolvedValueOnce(answer({ ok: true, value: { remarks: [{ ref: "C1", en: "Steady work; keep reading daily.", hi: "नियमित काम; रोज़ पढ़ते रहें।" }] }, logId: null }));
    await render(<Remarks current="" onPick={onPick} />, ["remarks"]);
    // Only the child with figures is counted.
    expect(host.textContent).toContain("Write AI remarks for 1 child without one");

    await click("Write AI remarks");
    // The first tap only asks (teacher replay, 6 Nov 2026).
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Nothing is saved");
    await click("Write the drafts");
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.task).toBe("remarks.class");
    expect(sent.input.children).toEqual([{ ref: "C1", percent: 72, attendance: 91, strongest: "Maths", weakest: "English" }]);
    expect(JSON.stringify(sent)).not.toContain("c-1");

    await click("Steady work");
    expect(onPick).toHaveBeenCalledWith("Steady work; keep reading daily.\nनियमित काम; रोज़ पढ़ते रहें।");
  });
});

describe("call scripts", () => {
  it("sends only slot names and phrases, and fills the family's figures in the browser", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true, value: { opening: "Namaste <<parent>>, this is the school office.", points: ["<<amount_due>> is due for <<children>>."], close: "Thank you." }, logId: null }));
    await render(
      <CallScript
        topic="dues"
        facts={[
          { key: "parent", label: "parent's name", value: "QA Parent" },
          { key: "children", label: "children's first names", value: "Qatest" },
          { key: "amount_due", label: "fees due today", value: "₹4,500" },
          { key: "late_fee", label: "late fee", value: null },
        ]}
        situation={["the fees have been overdue for more than a week"]}
      />,
      ["calls"],
    );
    await click("What to say on this call");
    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).not.toContain("QA Parent");
    expect(body).not.toContain("Qatest");
    expect(body).not.toContain("4,500");
    expect(JSON.parse(body).input.slots.map((s: { key: string }) => s.key)).toEqual(["parent", "children", "amount_due"]);
    expect(host.textContent).toContain("Namaste QA Parent, this is the school office.");
    expect([...host.querySelectorAll("b")].map((b) => b.textContent)).toEqual(expect.arrayContaining(["QA Parent", "₹4,500", "Qatest"]));
  });
});

describe("a child's summary", () => {
  it("never sends health or family notes", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true, value: { points: ["Reads well."], opener: "Thank you for coming." }, logId: null }));
    await render(
      <ChildSummary
        childName="Qatest Child"
        notes={[
          { body: "Reads well in class.", tags: ["studies"], createdAt: "2026-10-20T05:00:00Z" },
          { body: "QA private health matter.", tags: ["health"], createdAt: "2026-10-21T05:00:00Z" },
          { body: "QA private family matter.", tags: ["family"], createdAt: "2026-10-22T05:00:00Z" },
        ]}
        facts={["Attendance this session: 91%"]}
      />,
      ["summary"],
    );
    await click("Summary for a parent meeting");
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.input.notes).toHaveLength(1);
    expect(JSON.stringify(sent)).not.toContain("private");
    expect(host.textContent).toContain("Reads well.");
  });
});

describe("on a phone with no signal", () => {
  it("disables every AI button, says it needs the internet, and sends nothing", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      await render(<NoteAssist body="quiet in class today" childName={null} onApply={() => undefined} />, ["note", "translate"]);
      const buttons = [...host.querySelectorAll<HTMLButtonElement>("button.as-btn")];
      expect(buttons.length).toBe(2);
      expect(buttons.every((b) => b.disabled)).toBe(true);
      expect(host.textContent).toContain("Needs the internet");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      onLine.mockRestore();
    }
  });
});

describe("read-only suggestions", () => {
  it("Copy keeps the call script open and counts it as kept once", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fetchMock.mockResolvedValueOnce(answer({ ok: true, value: { opening: "Namaste <<parent>>.", points: ["<<amount_due>> is due."], close: "Thank you." }, logId: "44444444-4444-4444-8444-444444444444" }));
    fetchMock.mockResolvedValue(answer({ ok: true }));
    await render(
      <CallScript topic="dues" facts={[{ key: "parent", label: "parent", value: "QA Parent" }, { key: "amount_due", label: "fees due", value: "₹4,500" }]} situation={[]} />,
      ["calls"],
    );
    await click("What to say on this call");
    await click("Copy");
    await click("Copied");
    expect(writeText).toHaveBeenCalledWith("Namaste QA Parent.\n₹4,500 is due.\nThank you.");
    // Still open for the rest of the call.
    expect(host.textContent).toContain("Namaste QA Parent.");
    const patches = fetchMock.mock.calls.filter((c) => c[1]?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0][1].body as string)).toEqual({ logId: "44444444-4444-4444-8444-444444444444", decision: "kept" });
  });
});
