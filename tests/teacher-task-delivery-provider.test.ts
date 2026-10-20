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
it("task transport requires a verified VPPS origin contract and stays disabled under tests", () => {
  config.values={MESSAGE_PROVIDER:"aisensy",AISENSY_API_KEY:"synthetic-key",AISENSY_TASK_CAMPAIGN_ORIGIN:"https://sampark.example.test",AISENSY_TASK_CONTRACT:"v1"};
  expect(taskDeliveryAvailability()).toBe("unavailable");
  config.values.AISENSY_TASK_CAMPAIGN_ORIGIN="https://vpps.example.test";
  expect(taskDeliveryAvailability()).toBe("test_mode");
});
