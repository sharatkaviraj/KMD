// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ online: true, save: vi.fn(), check: vi.fn(), toast: vi.fn(),
  stored: new Map<string, unknown>(), storageFails: false, removals: [] as string[], restore: null as Promise<unknown> | null, restoreKey: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/platform/drafts/use-durable-draft", () => ({ useOnline: () => state.online }));
vi.mock("@/platform/drafts/store", () => ({
  loadDraft: async (key: string) => key===state.restoreKey && state.restore ? state.restore : state.stored.get(key) ?? null,
  saveDraft: async (key: string, value: unknown) => { if (state.storageFails) throw new Error("storage blocked"); state.stored.set(key, value); },
  removeDraft: async (key: string) => { state.removals.push(key); state.stored.delete(key); },
}));
vi.mock("@/vx/screens/teach/actions", () => ({ saveRegisterVx: state.save, checkRegisterVx: state.check }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string }) => p.en, sub: () => null }), Bi: ({ en }: { en: string }) => <span>{en}</span> }));
vi.mock("@/vx/shell/sidebar", () => ({ LangButton: () => null }));
vi.mock("@/vx/ui/overlays", () => ({ useToast: () => ({ show: state.toast }), Sheet: ({ open, children, footer }: { open: boolean; children: React.ReactNode; footer: React.ReactNode }) => open ? <section>{children}{footer}</section> : null }));
vi.mock("@/vx/screens/teach/ui/shared", () => ({ HelpIcon: () => null, HelpSheet: () => null, LangSeg: () => null, DrawnTick: () => null,
  TchTop: ({ actions }: { actions?: React.ReactNode }) => <header>{actions}</header>,
  useUrlState: (_key: string, initial: string | null) => React.useState(initial),
}));
import { TeachAttend } from "@/vx/screens/teach/ui/attend";
import type { AttendData } from "@/vx/screens/teach/data";
import { draftKey } from "@/platform/drafts/policy";

const classId = "00000000-0000-4000-8000-000000000001";
const studentId = "00000000-0000-4000-8000-000000000002";
const ownerId = "qa-teacher";
const key = draftKey(ownerId, "QA", `attendance-outbox/${classId}/2026-10-10`);
const box = { payload: "qa-payload", alerts: false, commandId: "qa-command", at: 1 };
const data = { kind: "class", sessionLabel: "QA", classId, classLabel: "QA class", day: "2026-10-10", prevDay: "2026-10-09",
  choices: [], closed: false, canSave: true, canCorrect: true, isOwner: true, correctsAny: false, onBehalf: false, reason: null,
  roll: [{ id: studentId, name: "QA Child", rollNo: "1", gender: null, birthday: false }], registerId: null, revision: 0,
  saved: {}, yesterday: {}, receipt: null, queuedAlerts: [], month: "2026-10", monthMarks: [], closedDays: [],
} as AttendData;
let root: Root; let host: HTMLDivElement;
async function render(model: AttendData = data) { await act(async () => root.render(<TeachAttend data={model} ownerId={ownerId} initialSheet="save" initialView={null} school="QA School" />)); }
async function clickSave() {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")].filter(b => b.textContent === "Save attendance");
  await act(async () => buttons.at(-1)!.click());
}
async function reconnect() { state.online = true; await render(); await act(async () => vi.advanceTimersByTimeAsync(450)); }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.online = true; state.storageFails = false; state.stored.clear(); state.removals = []; state.restore=null;
  state.save.mockReset().mockResolvedValue({ status: "refused", message: { en: "Window closed", hi: "" } });
  state.check.mockReset().mockResolvedValue({ status: "error", message: { en: "Not found", hi: "" } }); state.toast.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("attendance offline outbox recovery", () => {
  it("keeps a new child mark when a slower phone draft restore arrives", async () => {
    let restore!: (value: unknown) => void;
    state.restoreKey=draftKey(ownerId,"QA",`attendance-vx/${classId}/2026-10-10`);
    state.restore=new Promise(resolve=>{restore=resolve;});
    await render();
    const child=host.querySelector<HTMLButtonElement>("button.tc-akid")!;
    await act(async()=>child.click());
    expect(child.className).toMatch(/\ba\b/);
    await act(async()=>restore({value:{marks:{[studentId]:"present"},revision:0}}));
    expect(child.className).toMatch(/\ba\b/);
  });
  it("still restores untouched children alongside a new touch edit", async () => {
    const secondId="00000000-0000-4000-8000-000000000003";
    let restore!: (value: unknown) => void;
    state.restoreKey=draftKey(ownerId,"QA",`attendance-vx/${classId}/2026-10-10`);
    state.restore=new Promise(resolve=>{restore=resolve;});
    await render({...data,roll:[...data.roll,{id:secondId,name:"QA Other Child",rollNo:"2",gender:null,birthday:false}]});
    const children=host.querySelectorAll<HTMLButtonElement>("button.tc-akid");
    await act(async()=>children[0].click());
    await act(async()=>restore({value:{marks:{[studentId]:"present",[secondId]:"half_day"},revision:0}}));
    expect(children[0].className).toMatch(/\ba\b/);
    expect(children[1].className).toMatch(/\bh\b/);
  });
  it.each(["refused", "stale", "roster_changed"])("removes a restored outbox after terminal %s and retains editable marks", async status => {
    state.stored.set(key, { value: box });
    state.save.mockResolvedValue({ status, message: { en: "Review required", hi: "" }, joined: [], left: [], latest: null });
    await render(); await act(async () => vi.advanceTimersByTimeAsync(450));
    expect(state.save).toHaveBeenCalledOnce(); expect(state.stored.has(key)).toBe(false);
    expect(host.textContent).not.toContain("Waiting to sync");
    state.online = false; await render(); await reconnect(); expect(state.save).toHaveBeenCalledOnce();
  });
  it("does not claim a phone copy when offline storage fails", async () => {
    state.online = false; state.storageFails = true; await render(); await clickSave();
    expect(state.toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "bad" }));
    expect(JSON.stringify(state.toast.mock.calls)).not.toContain("Saved on this phone");
    expect(host.textContent).not.toContain("Waiting to sync"); expect(state.save).not.toHaveBeenCalled();
  });
  it("persists an offline save before reporting it queued and reuses its command on reconnect", async () => {
    state.online = false; await render(); await clickSave();
    const queued = state.stored.get(key) as { value: { commandId: string; payload: string } };
    expect(queued.value.commandId).toBeTruthy(); expect(state.toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "info" }));
    await reconnect(); expect(state.save).toHaveBeenCalledWith(queued.value.payload, true);
  });
  it("checks an uncertain submission before resending a save already acknowledged", async () => {
    state.stored.set(key, { value: box });
    state.check.mockResolvedValue({ status: "saved", receipt: { savedAt: "2026-10-10T05:00:00Z", registerId: "r", revision: 1 } });
    await render(); await act(async () => vi.advanceTimersByTimeAsync(450));
    expect(state.check).toHaveBeenCalledWith(box.commandId); expect(state.save).not.toHaveBeenCalled(); expect(state.stored.has(key)).toBe(false);
  });
});
