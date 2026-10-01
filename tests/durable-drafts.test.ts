import { afterEach, describe, expect, it, vi } from "vitest";
import { draftKey, isStringRecord, readDraft } from "@/platform/drafts/policy";
import { flushDraftWrites, loadDraft, removeDraft, saveDraft } from "@/platform/drafts/store";
import { buildPaymentDraftKey } from "@/modules/payments/domain/draft-store";

afterEach(() => vi.unstubAllGlobals());
describe("durable drafts", () => {
  it("isolates accounts, sessions and records without separator collisions", () => {
    expect(new Set([draftKey("a", "2026", "marks/p1"), draftKey("b", "2026", "marks/p1"), draftKey("a", "2027", "marks/p1"), draftKey("a", "2026", "marks/p2"), draftKey("a:b", "2026", "marks/p1")]).size).toBe(5);
    expect(buildPaymentDraftKey({ ownerId: "a", sessionLabel: "2026", studentId: "s", paymentDate: "2026-10-01" })).not.toBe(buildPaymentDraftKey({ ownerId: "b", sessionLabel: "2026", studentId: "s", paymentDate: "2026-10-01" }));
    expect(() => draftKey("", "2026", "p1")).toThrow();
  });
  it("rejects corrupt and unknown version drafts", () => {
    const value = { version: 1, baseline: "current", updatedAt: 1, value: { mark: "0" } };
    expect(readDraft(value, isStringRecord)?.value).toEqual({ mark: "0" });
    for (const bad of [{ ...value, version: 2 }, { ...value, updatedAt: NaN }, { ...value, value: [] }, { ...value, value: { mark: 0 } }, null]) expect(readDraft(bad, isStringRecord)).toBeNull();
  });
  it("serializes writes and deletion in the fallback store", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
    const key = draftKey("a", "2026", "r");
    void saveDraft(key, { version: 1, baseline: "", updatedAt: 1, value: "first" });
    void saveDraft(key, { version: 1, baseline: "", updatedAt: 2, value: "latest" });
    await flushDraftWrites();
    expect(await loadDraft(key)).toMatchObject({ value: "latest" });
    await removeDraft(key);
    expect(await loadDraft(key)).toBeNull();
  });
  it("reports storage failures instead of claiming a local save", async () => {
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("quota"); } });
    await expect(saveDraft("blocked", { version: 1, baseline: "", value: "unsaved", updatedAt: 1 })).rejects.toThrow("quota");
  });
});
