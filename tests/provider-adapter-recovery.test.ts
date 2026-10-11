import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MessageSend } from "@/modules/collection/domain/messages";
const state = vi.hoisted(() => ({ provider: "mock", environment: "dev", key: "qa-key-placeholder" }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/env", () => ({ getOptionalEnvVar: (key: string) => key === "MESSAGE_PROVIDER" ? state.provider : key === "AISENSY_API_KEY" ? state.key : undefined, getVppsOneEnvironment: () => state.environment }));
import { providers, selectProvider } from "@/modules/collection/data/message-provider";
const send = { id: "qa-send", toPhone: "9876543210", toName: "QA recipient", templateCode: "qa-only", variables: [] } as unknown as MessageSend;
beforeEach(() => { state.provider = "mock"; state.environment = "dev"; state.key = "qa-key-placeholder"; vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("missing configuration is a known refusal before transport", async () => {
  state.key = ""; expect(await providers.aisensyProvider.send(send)).toMatchObject({ ok: false, outcome: "rejected" });
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["0", "6", "7", "8", "9"])("mock outcome %s never calls an external endpoint", async (digit) => {
  const result = await selectProvider().send({ ...send, toPhone: `987654321${digit}` });
  expect(result.ok).toBe(["0", "9"].includes(digit)); expect(fetch).not.toHaveBeenCalled();
});
it("slow mock stays pending until its defined delay", async () => {
  vi.useFakeTimers(); let settled = false;
  const result = selectProvider().send({ ...send, toPhone: "9876543215" }).then(value => { settled = true; return value; });
  await vi.advanceTimersByTimeAsync(1199); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect((await result).ok).toBe(true); expect(fetch).not.toHaveBeenCalled();
});
it("refuses mock configuration on live and unknown providers", () => {
  state.environment = "live"; expect(selectProvider).toThrow(); state.environment = "dev"; state.provider = "unknown"; expect(selectProvider).toThrow(); expect(fetch).not.toHaveBeenCalled();
});
it("missing real-provider configuration sends nothing", async () => { state.key = ""; expect((await providers.aisensyProvider.send(send)).ok).toBe(false); expect(fetch).not.toHaveBeenCalled(); });
it.each([429, 500])("a mocked provider %i response is a failure", async (status) => { vi.mocked(fetch).mockResolvedValue({ ok: false, status } as Response); expect((await providers.aisensyProvider.send(send)).ok).toBe(false); });
it("a mocked transport failure is not confirmation", async () => { vi.mocked(fetch).mockRejectedValue(new Error("QA response lost")); expect((await providers.aisensyProvider.send(send)).ok).toBe(false); });
it.each(["dropped", "server"])("%s response cannot authorize an ordinary retry", async (caseName) => {
  if (caseName === "dropped") vi.mocked(fetch).mockRejectedValue(new Error("QA response lost"));
  else vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
  expect(await providers.aisensyProvider.send(send)).toMatchObject({ ok: false, outcome: "unknown" });
});
// AiSensy's API reference defines HTTP 200 as acceptance; it does not promise
// a messageId. Acceptance is not a delivery/read receipt or a invented ID.
it.each([{}, { messageId: null }, { messageId: "" }, { messageId: "  " }])("a documented success without an ID records acceptance without inventing an identifier", async (body) => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => body } as Response);
  expect(await providers.aisensyProvider.send(send)).toEqual({ ok: true, providerMessageId: "" });
});
it("returns a confirmed ID from a mocked positive response", async () => { vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ messageId: "qa-confirmation" }) } as Response); expect(await providers.aisensyProvider.send(send)).toEqual({ ok: true, providerMessageId: "qa-confirmation" }); });
