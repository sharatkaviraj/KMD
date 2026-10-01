import type { PerformanceEvent } from "./policy";

export function recordPerformance(name: PerformanceEvent["name"], value: number) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("vpps:performance", { detail: { name, value } }));
}
