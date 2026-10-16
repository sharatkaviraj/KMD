import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/20261016070000_teacher_tasks.sql", import.meta.url), "utf8");
const body = (name: string) => migration.split(`create function vppsone.${name}(`)[1].split("end; $$;")[0];

// Fast source guard only. The actual two-connection schedule lives in
// tests/sql/teacher-task-locks.py and runs on disposable PostgreSQL 17 in CI.
it.each(["create_teacher_tasks", "restart_teacher_task"])("%s acquires the session advisory lock before any row lock", name => {
  const sql = body(name);
  expect(sql.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(-1);
  expect(sql.indexOf("pg_advisory_xact_lock")).toBeLessThan(sql.indexOf("for update"));
});

it("creation takes the session lock before returning a replay receipt", () => {
  const sql = body("create_teacher_tasks");
  expect(sql.indexOf("pg_advisory_xact_lock")).toBeLessThan(sql.indexOf("if v.result is not null"));
});

it("row-locking nested management paths do not call back into session-locking creation", () => {
  for (const name of ["manage_teacher_task", "delegate_teacher_task_list"]) {
    expect(body(name)).not.toMatch(/(?:create_teacher_tasks|restart_teacher_task|pg_advisory_xact_lock)\(/);
  }
});
