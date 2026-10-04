import { describe, expect, it } from "vitest";

import { canonical } from "@/modules/archives/data/archive-engine";

/**
 * P11: the manifest the catalogue keeps (jsonb, keys reordered) and the copy
 * beside the files (keys as written) must compare equal when they say the
 * same thing — the browser journey found every drill failing when they did not.
 */
describe("canonical()", () => {
  it("ignores key order at every depth", () => {
    expect(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: "z" } })).toBe(canonical({ a: { c: "z", d: [1, { x: 1, y: 2 }] }, b: 1 }));
  });

  it("still sees a changed value or a reordered array", () => {
    expect(canonical({ a: 1, b: 2 })).not.toBe(canonical({ a: 1, b: 3 }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });
});
