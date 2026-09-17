import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every PostgREST embed can actually be resolved.
 *
 * **A table that points at another one twice has no default embed.** Ask for
 * `staff_profiles(display_name)` on a table with both `requested_by` and
 * `staff_profile_id` and PostgREST does not pick one — it answers *"more than
 * one relationship was found"*, the page throws, and the person sees an error
 * card. It is a schema-shaped bug: nothing about the query looks wrong, it
 * compiles, it typechecks, and it fails identically on every row.
 *
 * `/collection/messages` shipped in Phase 5 with exactly this and stayed broken
 * until somebody signed in and opened the screen, because no unit test touches
 * PostgREST and no SQL probe issues the app's own select.
 *
 * So this reads the migrations for the fact and the repos for the query, and
 * compares them — no database, no network, and it grows with the schema rather
 * than needing to be remembered.
 */

const repoRoot = process.cwd();

/**
 * These files are checked out with CRLF on Windows.
 *
 * Every pattern below anchors on `\n`, and against `\r\n` those silently match
 * nothing — so the check finds no queries, compares them against no schema, and
 * passes. The first version of this test did exactly that: it went green
 * against the very bug it was written to catch, which is worse than not having
 * written it. Normalising once here is what makes the rest of it mean anything.
 */
const normalise = (text: string) => text.replace(/\r\n/g, "\n");

/** `table -> referenced table -> how many foreign keys` */
function foreignKeyCounts(): Map<string, Map<string, number>> {
  const dir = path.join(repoRoot, "supabase/migrations");
  const counts = new Map<string, Map<string, number>>();

  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
    const sql = normalise(readFileSync(path.join(dir, file), "utf8"));

    // Split into `create table vppsone.<name> ( … );` blocks and read the
    // `references` inside each. Crude on purpose: a parser that understood SQL
    // would be a bigger thing to trust than the check it supports.
    for (const match of sql.matchAll(
      /create\s+table\s+vppsone\.(\w+)\s*\(([\s\S]*?)\n\);/gi,
    )) {
      const table = match[1];
      const body = match[2];
      const inner = counts.get(table) ?? new Map<string, number>();

      for (const ref of body.matchAll(/references\s+vppsone\.(\w+)\s*\(/gi)) {
        inner.set(ref[1], (inner.get(ref[1]) ?? 0) + 1);
      }

      counts.set(table, inner);
    }

    // **And the columns added afterwards.** A table gains most of its second
    // and third foreign keys by `alter table`, not in the block it was born
    // in — which is how R3.1 gave `collection_requests` two more references
    // to `staff_profiles` and broke `/collection` for every role while this
    // test stayed green. Reading only `create table` made the check strongest
    // on the day a table was written and blind ever after.
    for (const match of sql.matchAll(
      /alter\s+table\s+vppsone\.(\w+)([\s\S]*?);/gi,
    )) {
      const table = match[1];
      const body = match[2];
      if (!/add\s+(column|constraint)/i.test(body)) continue;

      const inner = counts.get(table) ?? new Map<string, number>();

      for (const ref of body.matchAll(/references\s+vppsone\.(\w+)\s*\(/gi)) {
        inner.set(ref[1], (inner.get(ref[1]) ?? 0) + 1);
      }

      counts.set(table, inner);
    }
  }

  return counts;
}

/** Every `.from("x")` … `.select("…")` pair in the data layer, as source text. */
function selectsByTable(): { file: string; table: string; select: string }[] {
  const found: { file: string; table: string; select: string }[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) collect(full);
    }
  };

  const collect = (file: string) => {
    const source = normalise(readFileSync(file, "utf8"));

    // A `.from("table")` followed by a `.select(…)` before the next `.from(`.
    for (const match of source.matchAll(/\.from\("(\w+)"\)([\s\S]*?)(?=\.from\("|$)/g)) {
      const table = match[1];
      const after = match[2];

      const select = after.match(/\.select\(\s*([\s\S]*?)\)\s*\n/);
      if (!select) continue;

      // Constants are referenced by name; pull their text in too.
      let text = select[1];
      for (const name of text.matchAll(/\b([A-Z][A-Z_0-9]*)\b/g)) {
        const constant = source.match(
          new RegExp(`const\\s+${name[1]}\\s*=\\s*([\\s\\S]*?);\\n`),
        );
        if (constant) text += constant[1];
      }

      found.push({
        file: path.relative(repoRoot, file),
        table,
        select: text,
      });
    }
  };

  walk(path.join(repoRoot, "src/modules"));
  return found;
}

describe("PostgREST embeds", () => {
  const counts = foreignKeyCounts();
  const selects = selectsByTable();

  it("finds the schema and the queries at all", () => {
    // A check that finds nothing has not passed, it has broken.
    expect(counts.size).toBeGreaterThan(10);
    expect(selects.length).toBeGreaterThan(20);
  });

  it("knows which tables point at another one more than once", () => {
    // The fact this whole test rests on, asserted rather than assumed: if a
    // migration is ever rewritten so these collapse to one FK, this fails and
    // somebody re-reads the test instead of trusting a tick.
    const ambiguous = [...counts.entries()]
      .filter(([, refs]) => [...refs.values()].some((n) => n > 1))
      .map(([table]) => table)
      .sort();

    expect(ambiguous).toContain("message_sends");
    // Added by `alter table`, so this one is also the proof that the second
    // half of the parser above runs at all.
    expect(ambiguous).toContain("collection_requests");
    expect(ambiguous).toContain("attendance_registers");
    expect(ambiguous).toContain("attendance_corrections");
    expect(ambiguous).toContain("substitution_assignments");
  });

  it("names the relationship whenever an embed would be ambiguous", () => {
    const problems: string[] = [];

    for (const { file, table, select } of selects) {
      const refs = counts.get(table);
      if (!refs) continue;

      for (const [target, howMany] of refs) {
        if (howMany < 2) continue;

        // An embed of `target` that does not name which foreign key it means.
        const unqualified = new RegExp(`(^|[^!\\w])${target}\\s*\\(`);
        if (unqualified.test(select)) {
          problems.push(
            `${file}: .from("${table}") embeds ${target}(…) but ${table} ` +
              `references ${target} ${howMany} times — name the constraint, ` +
              `e.g. ${target}!${table}_<column>_fkey(…)`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
