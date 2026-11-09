import { afterEach, expect, it, vi } from "vitest";
import { classifyResponse } from "@/modules/staff-notices/domain/notices";
vi.mock("server-only", () => ({}));
const config = vi.hoisted(() => ({ values: {} as Record<string,string> }));
vi.mock("@/platform/env", () => ({ getOptionalEnvVar: (k:string) => config.values[k], getSiteUrl: () => "https://vpps.example.test", getVppsOneEnvironment: () => "dev" }));
import { taskDeliveryAvailability, classifyTaskResponse } from "@/modules/collection/data/message-provider";
afterEach(() => { config.values = {}; vi.unstubAllEnvs(); });
it("an explicit 200 provider error overrides a receipt", () => {
  expect(classifyResponse(200, { error: "Wrong campaign", messageId:"synthetic-receipt" }).outcome).toBe("rejected");
});
it.each([
  [200,{messageId:"synthetic-receipt"},"accepted"],
  [200,{status:"ok"},"unknown"],
  [200,{error:"Wrong campaign"},"rejected"],
  [429,{},"rate_limited"],
  [503,{},"unknown"],
] as const)("task response %s is %s", (status,body,outcome) => {
  expect(classifyTaskResponse(status,body).outcome).toBe(outcome);
});
it("task delivery is unavailable with absent or mock configuration, even on dev", () => {
  expect(taskDeliveryAvailability()).toBe("unavailable");
  config.values.MESSAGE_PROVIDER="mock";
  expect(taskDeliveryAvailability()).toBe("test_mode");
});
it("task transport needs the school's WhatsApp connected, and stays in test mode under a test runner", () => {
  config.values = { MESSAGE_PROVIDER: "whatsapp" };
  expect(taskDeliveryAvailability()).toBe("unavailable");
  vi.stubEnv("WHATSAPP_API_URL", "https://wa.example.test");
  vi.stubEnv("WHATSAPP_API_KEY", "synthetic-key");
  vi.stubEnv("WHATSAPP_SENDER_NUMBER", "+918047136289");
  // The fees app's AiSensy number is refused as a sender, whatever else is set.
  expect(taskDeliveryAvailability()).toBe("unavailable");
  vi.stubEnv("WHATSAPP_SENDER_NUMBER", "+918302207823");
  expect(taskDeliveryAvailability()).toBe("test_mode");
  config.values = { MESSAGE_PROVIDER: "sampark" };
  expect(taskDeliveryAvailability()).toBe("unavailable");
});
