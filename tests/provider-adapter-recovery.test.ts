import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MessageSend } from "@/modules/collection/domain/messages";

/**
 * The collection provider seam (D-562): `whatsapp` hands every non-parent
 * message to the one WhatsApp service; `mock` decides from the last digit and
 * touches nothing. The service is mocked, so nothing here can reach a
 * provider; `fetch` is stubbed to prove the mock never calls out.
 */

const state = vi.hoisted(() => ({ provider: "mock" as string | undefined, environment: "dev", sendTemplate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/env", () => ({
  getOptionalEnvVar: (key: string) => (key === "MESSAGE_PROVIDER" ? state.provider : undefined),
  getVppsOneEnvironment: () => state.environment,
}));
vi.mock("@/platform/auth/current-staff", () => ({ getCurrentStaff: async () => ({ userId: "qa-user" }) }));
vi.mock("@/platform/whatsapp/service", () => ({ sendTemplate: state.sendTemplate }));
vi.mock("@/modules/whatsapp/data/parent-send", () => ({ sendParentTemplate: vi.fn() }));

import { dispatchResultFrom, providers, selectProvider } from "@/modules/collection/data/message-provider";

const send = { id: "qa-send", audience: "staff", toPhone: "9876543210", toName: "QA recipient", templateCode: "qa_only", variables: ["a"], sessionLabel: "TEST-2026-27" } as unknown as MessageSend;

beforeEach(() => {
  state.provider = "mock";
  state.environment = "dev";
  state.sendTemplate.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["0", "6", "7", "8", "9"])("mock outcome %s never calls an external endpoint", async (digit) => {
  const result = await selectProvider().send({ ...send, toPhone: `987654321${digit}` });
  expect(result.ok).toBe(["0", "9"].includes(digit));
  expect(fetch).not.toHaveBeenCalled();
});

it("slow mock stays pending until its defined delay", async () => {
  vi.useFakeTimers();
  let settled = false;
  const result = selectProvider()
    .send({ ...send, toPhone: "9876543215" })
    .then((value) => {
      settled = true;
      return value;
    });
  await vi.advanceTimersByTimeAsync(1199);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await result).ok).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it("refuses mock configuration on live and unknown providers", () => {
  state.environment = "live";
  expect(selectProvider).toThrow();
  state.environment = "dev";
  state.provider = "unknown";
  expect(selectProvider).toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([undefined, "whatsapp", "aisensy"])("MESSAGE_PROVIDER=%s is the school's WhatsApp (the old name included)", (value) => {
  state.provider = value;
  expect(selectProvider().id).toBe("whatsapp");
});

it("hands a staff message to the WhatsApp service with its own row to update", async () => {
  state.sendTemplate.mockResolvedValue({ outcome: "accepted", providerMessageId: "wamid.qa", logId: "log" });
  expect(await providers.whatsappProvider.send(send)).toEqual({ ok: true, providerMessageId: "wamid.qa" });
  const [to, name, language, values, options] = state.sendTemplate.mock.calls[0]!;
  expect([to, name, language, values]).toEqual(["+919876543210", "qa_only", null, ["a"]]);
  expect(options).toMatchObject({ feature: "staff_notice", urlButton: null, link: { table: "message_sends", id: "qa-send" }, sessionLabel: "TEST-2026-27", requestedBy: "qa-user" });
});

it("a refusal (not connected, switch off, practice mode) is a definite not-sent", async () => {
  state.sendTemplate.mockResolvedValue({ outcome: "refused", code: "not_configured", reason: "The school's WhatsApp is not connected.", logId: null });
  expect(await providers.whatsappProvider.send(send)).toMatchObject({ ok: false, outcome: "rejected" });
});

it.each([
  { outcome: "queued", reason: "Busy.", logId: "l" },
  { outcome: "unknown", reason: "No answer.", logId: "l" },
  { outcome: "duplicate", providerMessageId: null, logId: "l" },
])("$outcome cannot authorize an ordinary retry", async (outcome) => {
  state.sendTemplate.mockResolvedValue(outcome);
  expect(await providers.whatsappProvider.send(send)).toMatchObject({ ok: false, outcome: "unknown" });
});

it("a thrown service is unknown, never a failure that may be resent", async () => {
  state.sendTemplate.mockRejectedValue(new Error("QA response lost"));
  expect(await providers.whatsappProvider.send(send)).toMatchObject({ ok: false, outcome: "unknown" });
});

it("WhatsApp's own refusal keeps its code in the words", () => {
  expect(dispatchResultFrom({ outcome: "rejected", code: "131026", reason: "Not on WhatsApp.", logId: "l" } as never)).toEqual({
    ok: false,
    outcome: "rejected",
    error: "Not on WhatsApp. (WhatsApp 131026)",
  });
  expect(dispatchResultFrom({ outcome: "dry_run", reason: "Practice mode is on.", logId: "l" } as never)).toEqual({
    ok: false,
    outcome: "rejected",
    error: "Not sent: Practice mode is on.",
  });
  expect(dispatchResultFrom({ outcome: "duplicate", providerMessageId: "wamid.2", logId: "l" } as never)).toEqual({ ok: true, providerMessageId: "wamid.2" });
});

it("the adapter refuses a task campaign without its task before anything is sent", async () => {
  expect(await providers.whatsappProvider.send({ ...send, templateCode: "vppsone_teacher_task_en_v1", variables: [] } as unknown as MessageSend)).toMatchObject({ ok: false, outcome: "rejected" });
  expect(state.sendTemplate).not.toHaveBeenCalled();
});
