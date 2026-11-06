export const performanceNames = ["LCP", "INP", "CLS", "FCP", "TTFB", "form_saved", "directory_selected", "route_ready", "payment_search_completed", "payment_post_confirmed", "fee_summary_ready", "students_filter_completed", "report_generated"] as const;
/**
 * Fixed screen names, never a path: a path can carry a student id or a token.
 * "student" is one child's page, "students" the list; "home" is `/`.
 * Before 6 Nov 2026 most screens logged as "other", which hid which one was slow.
 */
const namedSections = ["teach", "dashboard", "students", "preferences", "fees", "dues", "staff", "timetable", "messages", "inbox", "notes", "reports", "receipts", "admissions", "assessments", "calendar", "menu", "more", "school-office", "collection", "academics", "attendance", "payments", "substitutions", "exams", "documents"] as const;
export const performanceRoutes = ["home", "student", "marks", "transactions", ...namedSections, "other"] as const;
export type PerformanceEvent = { name: typeof performanceNames[number]; route: typeof performanceRoutes[number]; value: number; installed: boolean; device: "phone" | "tablet" | "desktop" };

export function performanceRoute(path: string): PerformanceEvent["route"] {
  const clean = path.split(/[?#]/)[0];
  if (clean === "/" || clean === "") return "home";
  if (clean.startsWith("/teach/attendance")) return "attendance";
  if (clean.startsWith("/assessments/marks/")) return "marks";
  if (clean.startsWith("/fees/payments")) return "payments";
  if (clean.startsWith("/fees/transactions")) return "transactions";
  const [, section, next] = clean.split("/");
  if (section === "students" && next) return "student";
  return namedSections.find((value) => value === section) ?? "other";
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
