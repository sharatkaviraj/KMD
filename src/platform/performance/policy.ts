export const performanceNames = ["LCP", "INP", "CLS", "FCP", "TTFB", "form_saved", "directory_selected", "route_ready", "payment_search_completed", "payment_post_confirmed", "fee_summary_ready", "students_filter_completed", "report_generated"] as const;
export const performanceRoutes = ["teach", "attendance", "marks", "dashboard", "students", "payments", "transactions", "preferences", "other"] as const;
export type PerformanceEvent = { name: typeof performanceNames[number]; route: typeof performanceRoutes[number]; value: number; installed: boolean; device: "phone" | "tablet" | "desktop" };

export function performanceRoute(path: string): PerformanceEvent["route"] {
  if (path.startsWith("/teach/attendance")) return "attendance";
  if (path.startsWith("/assessments/marks/")) return "marks";
  if (path.startsWith("/fees/payments")) return "payments";
  if (path.startsWith("/fees/transactions")) return "transactions";
  const route = path.split("/")[1];
  return (["teach", "dashboard", "students", "preferences"] as const).find(value => value === route) ?? "other";
}

/** Fixed names/routes only: no URLs, identifiers, tokens, money or metadata. */
export function parsePerformanceEvents(body: unknown): PerformanceEvent[] | null {
  if (!Array.isArray(body) || !body.length || body.length > 20) return null;
  const events: PerformanceEvent[] = [];
  for (const raw of body) {
    if (!raw || typeof raw !== "object") return null;
    const { name, route, value, installed, device } = raw;
    if (!performanceNames.includes(name) || !performanceRoutes.includes(route) || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 60000 || typeof installed !== "boolean" || !["phone", "tablet", "desktop"].includes(device)) return null;
    events.push({ name, route, value, installed, device });
  }
  return events;
}
