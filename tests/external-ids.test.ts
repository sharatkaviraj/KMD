import { describe, expect, it } from "vitest";

import { schoolApp } from "@/platform/config/apps";
import {
  isExternalId,
  mappingApplies,
  mappingFor,
  normaliseExternalId,
  type ExternalStudentId,
} from "@/modules/students/domain/external-ids";

/**
 * Which child in another app is this child (S-10).
 *
 * The rules worth testing are all refusals. A mapping that produces a link
 * when it should not does not fail loudly — it opens somebody else's record,
 * with their name at the top, and looks exactly like working software.
 */

const mapping = (over: Partial<ExternalStudentId> = {}): ExternalStudentId => ({
  appId: "sampark",
  externalId: "S1001",
  studentId: "11111111-2222-4333-8444-555555555555",
  sourceEnvironment: "dev",
  matchedOn: "admission_no",
  ...over,
});

describe("an id as it is stored", () => {
  it.each([
    ["S1001", "S1001"],
    ["s1001", "S1001"],
    ["  S1001  ", "S1001"],
    ["\ts1001\n", "S1001"],
  ])("%o normalises to %o", (raw, expected) => {
    expect(normaliseExternalId(raw)).toBe(expected);
  });

  it("does not strip punctuation, because that may be part of the id", () => {
    // A school issuing both `S1001` and `S-1001` is a school where deciding
    // they are the same child is a matcher's judgement, not a string's.
    expect(normaliseExternalId("S-1001")).toBe("S-1001");
  });

  it("rejects what could not be an id before a lookup is worth doing", () => {
    expect(isExternalId("")).toBe(false);
    expect(isExternalId("   ")).toBe(false);
    expect(isExternalId("S1001")).toBe(true);
    expect(isExternalId("x".repeat(65))).toBe(false);
  });
});

describe("whether a mapping may become a link", () => {
  it("applies in the dataset it was matched in", () => {
    expect(mappingApplies(mapping({ sourceEnvironment: "dev" }), "dev")).toBe(true);
    expect(mappingApplies(mapping({ sourceEnvironment: "live" }), "live")).toBe(true);
  });

  it("does not apply across datasets", () => {
    // **The one that matters.** A dev-matched uuid pointed at live records
    // does not 404 — it names a different child. Refusing is the only safe
    // answer, and the link falls back to a search box nobody is harmed by.
    expect(mappingApplies(mapping({ sourceEnvironment: "dev" }), "live")).toBe(false);
    expect(mappingApplies(mapping({ sourceEnvironment: "live" }), "dev")).toBe(false);
  });
});

describe("finding the one mapping for a child", () => {
  const studentId = "11111111-2222-4333-8444-555555555555";
  const other = "22222222-3333-4444-8555-666666666666";

  it("finds it", () => {
    expect(mappingFor([mapping()], "sampark", studentId, "dev")?.externalId).toBe(
      "S1001",
    );
  });

  it("does not find another child's", () => {
    expect(mappingFor([mapping()], "sampark", other, "dev")).toBeNull();
  });

  it("does not find another app's", () => {
    expect(mappingFor([mapping()], "schoolfees", studentId, "dev")).toBeNull();
  });

  it("does not find one matched in a different dataset", () => {
    expect(mappingFor([mapping()], "sampark", studentId, "live")).toBeNull();
  });

  it("treats two as none", () => {
    // A matcher re-run before the unique index existed leaves two rows. A link
    // that picks one by row order is a link that will one day pick the other.
    const twice = [mapping(), mapping({ externalId: "S2002" })];
    expect(mappingFor(twice, "sampark", studentId, "dev")).toBeNull();
  });

  it("finds nothing in nothing", () => {
    expect(mappingFor([], "sampark", studentId, "dev")).toBeNull();
  });
});

describe("what the SamPark link actually becomes", () => {
  const studentId = "11111111-2222-4333-8444-555555555555";
  const sampark = schoolApp("sampark");

  it("is a search when we hold no mapping", () => {
    const link = sampark.student({ studentId, search: "TEST-CL6-002" }, "live");

    expect(link.kind).toBe("search");
    expect(link.href).toContain("/students?");
    expect(link.href).not.toContain(studentId);
  });

  it("is a search when we hold a mapping but the datasets differ", () => {
    // SamPark reads live records; this app reads schoolfees-dev. Holding an
    // id is not the same as being allowed to use it.
    const link = sampark.student({ studentId, externalId: "S1001" }, "dev");

    expect(link.kind).toBe("search");
    expect(link.href).not.toContain("S1001");
  });

  it("is a deep link once both are true", () => {
    const link = sampark.student({ studentId, externalId: "S1001" }, "live");

    expect(link.kind).toBe("detail");
    expect(link.href).toBe("https://sampark-theta-eight.vercel.app/students/S1001");
  });

  it("never puts VPPS One's own id in a SamPark URL", () => {
    // The failure this whole mechanism exists to prevent: a uuid from
    // `public.students` is meaningless to SamPark, and a URL carrying one is
    // either a 404 or a stranger.
    for (const from of ["dev", "live"] as const) {
      for (const externalId of [null, "S1001"]) {
        const link = sampark.student({ studentId, externalId }, from);
        expect(link.href).not.toContain(studentId);
      }
    }
  });
});
