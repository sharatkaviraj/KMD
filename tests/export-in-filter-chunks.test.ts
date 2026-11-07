import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The defaulters PDF (and every export that adds the student master fields)
 * answered 500 on live, 7 Nov 2026: `getStudentMasterFieldsByIds` sent the
 * whole school in chunks of 500, and with its long select that URL is about
 * 20,000 characters, past the guarded fetch's 12,000. Chunks must come from
 * IN_FILTER_CHUNK_SIZE, not a local number.
 */
describe("student master fields for exports", () => {
  it("chunks its id filter at IN_FILTER_CHUNK_SIZE", () => {
    const source = readFileSync("src/modules/students-fees/data/queries.ts", "utf8");
    const start = source.indexOf("export async function getStudentMasterFieldsByIds");
    const body = source.slice(start, source.indexOf("\n}\n", start));
    expect(body).toContain("const chunkSize = IN_FILTER_CHUNK_SIZE;");
    expect(body).not.toMatch(/chunkSize = \d+/);
  });
});
