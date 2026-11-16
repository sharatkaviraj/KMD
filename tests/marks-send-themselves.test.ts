import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sendsItselfLine, sentItself, sentItselfLine, SENDS_ITSELF_HINT } from "@/vx/screens/exams/domain/sent-itself";

/*
 * Marks send themselves (D-651). The owner (16 Nov 2026): fully entered marks
 * may send themselves at the end of the due day. They go where Send marks
 * takes them, the exam office, and never to parents: that stays the admin's
 * (D-647). The database half is tests/sql/marks-send-themselves.mjs.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const name = readdirSync(dir).find((f) => f.endsWith("_marks_send_themselves.sql"));
  if (!name) throw new Error("migration missing");
  return readFileSync(join(dir, name), "utf8");
};

describe("whether a paper reads as sent by itself", () => {
  const at = "2026-11-16T18:37:00.123+00:00";

  it("is sent, and the send on file is the one the database made", () => {
    expect(sentItself({ entry_status: "submitted", submitted_at: at, sent_itself_at: at })).toBe(true);
    // PostgREST may print the same moment differently.
    expect(sentItself({ entry_status: "submitted", submitted_at: "2026-11-16T18:37:00.123Z", sent_itself_at: at })).toBe(true);
  });

  it("is not once the office hands it back, or a person sends it again", () => {
    expect(sentItself({ entry_status: "open", submitted_at: null, sent_itself_at: at })).toBe(false);
    expect(sentItself({ entry_status: "submitted", submitted_at: "2026-11-17T05:00:00Z", sent_itself_at: at })).toBe(false);
  });

  it("is not for a paper a person sent, or one read without the column", () => {
    expect(sentItself({ entry_status: "submitted", submitted_at: at, sent_itself_at: null })).toBe(false);
    expect(sentItself({ entry_status: "submitted", submitted_at: at })).toBe(false);
  });
});

describe("what the teacher and the office are told", () => {
  it("says beside Send marks what happens if she forgets", () => {
    expect(sendsItselfLine(null)).toBeNull();
    expect(sendsItselfLine("15 Nov")?.en).toBe("If you forget, it goes by itself after 15 Nov");
    expect(sendsItselfLine("15 Nov", true)?.en).toBe("If you forget, it goes by itself two hours after your last mark");
    for (const line of [sendsItselfLine("15 Nov"), sendsItselfLine("15 Nov", true), sentItselfLine("16 Nov", "12:07 am"), SENDS_ITSELF_HINT]) {
      expect(line?.hi, "said in Hindi too").toMatch(/[ऀ-ॿ]/);
    }
  });

  it("says on the sent page that it went by itself, and why", () => {
    expect(sentItselfLine("16 Nov", "12:07 am").en).toBe("Sent by itself on 16 Nov, 12:07 am: every child had a mark after the due day");
  });

  it("shows both on the screens", () => {
    const sheet = read("src/vx/screens/exams/marks-sheet.tsx");
    expect(sheet).toContain("sendsItselfLine(paper.dueLabel, paper.duePassed)");
    expect(sheet).toContain("sentItselfLine(shortDay(submittedAt), clock(submittedAt))");
    // Never for a class test or the office's own grid.
    expect(sheet).toMatch(/!ct && variant !== "office" && entryStatus === "open" \? sendsItselfLine/);
    expect(read("src/vx/screens/exams/sheet-data.ts")).toContain("sentItself: sentItself(paper)");
    expect(read("src/vx/screens/exams/data.ts")).toMatch(/PAPER_COLUMNS =\s*"[^"]*sent_itself_at"/);
    expect(read("src/vx/screens/exams/exams-board.tsx")).toContain("hint={marksDueOn ? tx(SENDS_ITSELF_HINT) : undefined}");
  });
});

describe("the database job", () => {
  it("only sends to the exam office, after the due day, from inside the database", () => {
    const sql = migration();
    const code = sql.replace(/--[^\n]*/g, "");
    expect(code).toMatch(/p\.marks_due_on < v_today/);
    expect(code).toMatch(/set entry_status = 'submitted'/);
    expect(code).not.toMatch(/results_published|tell_parents|message_sends|net\.http_post/i);
    expect(code).toMatch(/'marks-send-themselves',\s*'7 \* \* \* \*'/);
    expect(code).toMatch(/interval '2 hours'/);
  });
});
