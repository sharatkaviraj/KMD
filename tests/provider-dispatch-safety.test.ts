import { beforeEach, expect, it, vi } from "vitest";
import type { MessageSend } from "@/modules/collection/domain/messages";
const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, failWrite: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/env", () => ({ getOptionalEnvVar: (k: string) => k === "MESSAGE_PROVIDER" ? "mock" : undefined, getVppsOneEnvironment: () => "dev" }));
vi.mock("@/platform/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/modules/collection/data/parent-messages-repo", () => ({ categoryFor: vi.fn(), markStale: vi.fn(), parentDispatchMode: vi.fn(), parentDispatchSwitch: vi.fn(), parentPolicies: vi.fn(), snapshotNow: vi.fn(), staleness: vi.fn() }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  let patch: Record<string, unknown> = {}; const filters: ((r: Record<string, unknown>) => boolean)[] = [];
  const q = {
    update(p: Record<string, unknown>) { patch = p; return q; }, select() { return q; },
    eq(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
    neq(k: string, v: unknown) { filters.push(r => r[k] !== v); return q; },
    is(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
    in(k: string, v: unknown[]) { filters.push(r => v.includes(r[k])); return q; },
    async maybeSingle() { return { data: filters.every(f => f(state.row)) ? { ...state.row } : null, error: state.failWrite ? { message: "QA read refused" } : null }; },
    then(resolve: (v: unknown) => void) {
      if (state.failWrite) return Promise.resolve(resolve({ data: null, error: { message: "QA write refused" } }));
      const match = filters.every(f => f(state.row)); if (match) Object.assign(state.row, patch);
      return Promise.resolve(resolve({ data: match ? [{ id: state.row.id }] : [], error: null }));
    },
  }; return q;
} }) }));
import { dispatch, cancelSend, markSentByHand, confirmDispatchReceived } from "@/modules/collection/data/messages-repo";
import { providers } from "@/modules/collection/data/message-provider";
import { mayDispatch } from "@/modules/collection/domain/messages";
const send = { id: "qa-send", audience: "staff", status: "queued", providerMessageId: null, templateId: "qa-template", toPhone: "9876543210", renderedHi: "QA", renderedEn: "QA", variables: [] } as unknown as MessageSend;
beforeEach(() => { vi.restoreAllMocks(); state.failWrite = false; state.row = { id: send.id, status: "queued", provider_message_id: null, template_id: send.templateId, to_phone: send.toPhone, rendered_hi: send.renderedHi, rendered_en: send.renderedEn }; });
it("persists the claim before transport and only one concurrent dispatcher reaches the provider", async () => {
  let finish!: () => void;
  const provider = vi.spyOn(providers.mockProvider, "send").mockImplementation(async () => {
    expect(state.row.provider_message_id).toMatch(/^attempt:/);
    await new Promise<void>(r => { finish = r; }); return { ok: true, providerMessageId: "mock:qa-send" };
  });
  const first = dispatch(send); await Promise.resolve(); await Promise.resolve();
  const second = await dispatch(send); expect(second.ok).toBe(false);
  expect(provider).toHaveBeenCalledOnce(); finish(); expect((await first).ok).toBe(true);
  expect(state.row.status).toBe("sent"); expect(state.row.provider_message_id).toBe("mock:qa-send");
});
it("a lost provider response remains durably blocked across a new dispatch", async () => {
  const provider = vi.spyOn(providers.mockProvider, "send").mockRejectedValue(new Error("QA lost response"));
  expect((await dispatch(send)).ok).toBe(false); expect(state.row.provider_message_id).toMatch(/^attempt:/);
  expect((await dispatch(send)).ok).toBe(false); expect(provider).toHaveBeenCalledOnce();
});
it("an unconfirmed attempt is refused by the domain and by manual overwrite/cancellation", async () => {
  state.row.provider_message_id = "attempt:qa-unknown"; state.row.status = "failed";
  expect(mayDispatch({ ...send, status: "failed", providerMessageId: "attempt:qa-unknown" }).ok).toBe(false);
  await expect(cancelSend(send.id)).rejects.toThrow(); await expect(markSentByHand(send.id, "qa-actor")).rejects.toThrow();
  expect(state.row.status).toBe("failed"); expect(state.row.provider_message_id).toBe("attempt:qa-unknown");
});
it("a failed claim does not contact the provider", async () => {
  state.failWrite = true; const provider = vi.spyOn(providers.mockProvider, "send");
  expect((await dispatch(send)).ok).toBe(false); expect(provider).not.toHaveBeenCalled();
});
it("a legacy failed row without rejection evidence cannot reach transport or a manual overwrite", async () => {
  state.row.status = "failed"; state.row.error = "QA old response was lost";
  const legacy = { ...send, status: "failed" as const, error: String(state.row.error) };
  const provider = vi.spyOn(providers.mockProvider, "send");
  expect(mayDispatch(legacy).ok).toBe(false); expect((await dispatch(legacy)).ok).toBe(false);
  expect(provider).not.toHaveBeenCalled();
  await expect(markSentByHand(send.id, "qa-actor")).rejects.toThrow();
});
it("a confirmed refusal releases the claim for a later retry", async () => {
  const provider = vi.spyOn(providers.mockProvider, "send").mockResolvedValue({ ok: false, outcome: "rejected", error: "QA refusal" });
  expect((await dispatch(send)).ok).toBe(false); expect(state.row.provider_message_id).toBeNull();
  await dispatch(send); expect(provider).toHaveBeenCalledTimes(2);
});
it("failed result recording keeps the pre-transport marker", async () => {
  const provider = vi.spyOn(providers.mockProvider, "send").mockImplementation(async () => { state.failWrite = true; return { ok: true, providerMessageId: "mock:accepted" }; });
  expect((await dispatch(send)).ok).toBe(false); expect(state.row.provider_message_id).toMatch(/^attempt:/);
  state.failWrite = false; await dispatch(send); expect(provider).toHaveBeenCalledOnce();
});
it("human confirmation preserves the attempt and evidence and cannot restore the row for retry", async () => {
  const attempt = "attempt:11111111-1111-4111-8111-111111111111";
  state.row.provider_message_id = attempt; state.row.status = "failed";
  state.row.requested_by = "qa-original-requester";
  await confirmDispatchReceived(send.id, attempt, "QA delivery log checked", "qa-actor");
  expect(state.row.status).toBe("sent"); expect(state.row.provider_message_id).toBe(`confirmed:${attempt}`);
  expect(state.row.error).toContain("QA delivery log checked");
  expect(state.row.requested_by).toBe("qa-original-requester");
  await expect(confirmDispatchReceived(send.id, attempt, "QA duplicate check", "qa-actor")).rejects.toThrow();
});
