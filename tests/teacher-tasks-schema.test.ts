import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { taskSchemaMissing } from "@/modules/teacher-tasks/data/schema";
import { collectionTaskSourceKey } from "@/modules/teacher-tasks/data/identity";

it("only treats the absent additive task table as an unavailable feature", () => {
  expect(taskSchemaMissing({ code: "42P01", message: 'relation "vppsone.teacher_tasks" does not exist' })).toBe(true);
  expect(taskSchemaMissing({ code: "PGRST205", message: "Could not find vppsone.teacher_tasks" })).toBe(true);
  expect(taskSchemaMissing({ code: "42501", message: "permission denied for teacher_tasks" })).toBe(false);
  expect(taskSchemaMissing({ code: "42P01", message: "collection_requests missing" })).toBe(false);
  expect(taskSchemaMissing({ message: "teacher_tasks network error" })).toBe(false);
});

it("keeps whole-school task identity bounded and independent of ordering", () => {
  const ids = Array.from({ length: 600 }, (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const a = collectionTaskSourceKey("QA", ids, ["a", "b"]);
  expect(a.length).toBeLessThan(100);
  expect(collectionTaskSourceKey("QA", [...ids].reverse(), ["b", "a", "a"])).toBe(a);
  expect(collectionTaskSourceKey("QA", ids.slice(1), ["a", "b"])).not.toBe(a);
});
