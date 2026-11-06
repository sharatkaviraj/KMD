import { expect, it } from "vitest";
import { parsePerformanceEvents, performanceRoute } from "@/platform/performance/policy";

it("never includes dynamic paths or arbitrary metadata in telemetry", () => {
  expect(performanceRoute("/assessments/marks/secret-id?phone=123")).toBe("marks");
  expect(performanceRoute("/r/bearer-token")).toBe("other");
  expect(parsePerformanceEvents([{ name: "LCP", route: "teach", value: 2500, installed: true, device: "phone", token: "discard-me" }])).toEqual([{ name: "LCP", route: "teach", value: 2500, installed: true, device: "phone" }]);
});
it("bounds telemetry volume and rejects unknown names or values", () => {
  const event = { name: "INP", route: "attendance", value: 50, installed: false, device: "desktop" };
  for (const bad of [[], Array(21).fill(event), [{ ...event, name: "student-123" }], [{ ...event, route: "/r/token" }], [{ ...event, device: "private-user-agent" }], [{ ...event, value: Infinity }], [{ ...event, value: -1 }], [{ ...event, value: 60001 }]]) expect(parsePerformanceEvents(bad)).toBeNull();
});
it("names each screen without ever carrying an id", () => {
  expect(performanceRoute("/")).toBe("home");
  expect(performanceRoute("/students")).toBe("students");
  expect(performanceRoute("/students/3f2c-uuid?tab=fees")).toBe("student");
  expect(performanceRoute("/dues/family/abc")).toBe("dues");
  expect(performanceRoute("/school-office")).toBe("school-office");
  expect(performanceRoute("/fees/payments/x")).toBe("payments");
  expect(performanceRoute("/no-such-screen/123")).toBe("other");
});
