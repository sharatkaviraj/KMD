import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The functions run in the same place as the database (D-240).
 *
 * Both Supabase projects — schoolfees-dev and the live fee database — are in
 * ap-south-1, Mumbai. Without `regions`, Vercel ran every function in iad1,
 * Washington, so each sequential query crossed between the two continents
 * twice: about 200 ms a round trip, and the deepest screens wait on eleven or
 * twelve of them. Removing this line is a regression no other test sees.
 */
describe("hosting region", () => {
  it("pins the functions to Mumbai, next to both databases", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { regions?: string[] };
    expect(config.regions).toEqual(["bom1"]);
  });
});
