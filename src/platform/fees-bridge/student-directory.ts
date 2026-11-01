import type { SegmentId } from "@/modules/students-fees/domain/student-segments";
import { assertBridgeSession, FEES_ORIGIN } from "./policy";

/** The native chips name the same source predicates used by the legacy list. */
export const STUDENT_LIST_FEE_SEGMENTS = {
  pending: "overdue", late: "lateFeePending", never: "neverPaid", part: "partlyPaid",
  paid: "yearClear", emi: "onEmi", emiMissed: "emiMissed", old: "oldBalanceDue",
  bus: "onTransport", new: "newThisYear", concession: "hasDiscount", noPhone: "missingPhone",
} as const satisfies Record<string, SegmentId>;

/** Reviewed source filter-params contract; no arbitrary path/query forwarding. */
export function canonicalStudentDirectoryUrl(input: {
  sessionLabel: string; query: string; classId: string | null;
  filters: readonly (keyof typeof STUDENT_LIST_FEE_SEGMENTS)[]; sort: "name" | "class";
}): string {
  assertBridgeSession(input.sessionLabel);
  if (input.classId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.classId)) {
    throw new Error("The selected class is not a valid school class.");
  }
  const url = new URL("/protected/students", FEES_ORIGIN);
  url.searchParams.set("session", input.sessionLabel);
  if (input.query) url.searchParams.set("query", input.query);
  if (input.classId) url.searchParams.set("classId", input.classId);
  if (input.filters.length) url.searchParams.set("seg", input.filters.map(filter => STUDENT_LIST_FEE_SEGMENTS[filter]).join(","));
  if (input.sort === "class") url.searchParams.set("sort", "class");
  return url.toString();
}
