import { describe, expect, it } from "vitest";

import { matchWhy, searchTerm } from "@/vx/shell/student-search-query";

// Synthetic names and numbers only.
describe("searchTerm", () => {
  it("collapses whitespace and keeps names as typed", () => {
    expect(searchTerm("  Aarav   Test ")).toBe("Aarav Test");
  });

  it("reduces a phone in its usual shapes to ten digits", () => {
    for (const typed of ["9000000002", "+91 90000 00002", "+91-9000000002", "09000000002", "(900) 000-0002", "91 9000000002"]) {
      expect(searchTerm(typed)).toBe("9000000002");
    }
  });

  it("leaves short numbers alone, so an SR stays exact", () => {
    expect(searchTerm("0101")).toBe("0101");
    expect(searchTerm("SVP-20261002-4")).toBe("SVP-20261002-4");
  });
});

describe("matchWhy", () => {
  const row = { name: "Aarav Test", sr: "0101", father: "Ramesh Sample", mother: "Sita Sample", phones: ["9000000001", null] };

  it("needs no reason when the child's own name or SR matched", () => {
    expect(matchWhy("aarav", row)).toBeNull();
    expect(matchWhy("0101", row)).toBeNull();
  });

  it("names the parent who matched", () => {
    expect(matchWhy("ramesh", row)).toEqual({ kind: "father", text: "Ramesh Sample" });
    expect(matchWhy("sita", row)).toEqual({ kind: "mother", text: "Sita Sample" });
  });

  it("shows only the last four digits of a matched phone", () => {
    expect(matchWhy("9000000001", row)).toEqual({ kind: "phone", text: "••••0001" });
  });

  it("gives no reason it cannot see", () => {
    expect(matchWhy("class 7", row)).toBeNull();
  });
});
