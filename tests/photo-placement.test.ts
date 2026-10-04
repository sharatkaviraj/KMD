import { describe, expect, it } from "vitest";

import { matchPhotoFilename, placePhotos, sanitiseKey, tokensOf } from "@/modules/collection/domain/photo-placement";

/**
 * P10c: which child a photograph is of, from its filename. Ported from
 * SamPark's photo-filename tests, without the name tier (D-236). Synthetic ids.
 */

const roster = [
  { studentId: "c0000000-0000-0000-0000-000000000001", externalId: "S1001", srNo: "0101" },
  { studentId: "c0000000-0000-0000-0000-000000000002", externalId: "228/12RTE", srNo: "0102" },
  { studentId: "c0000000-0000-0000-0000-000000000003", externalId: null, srNo: "0103" },
];

describe("tokensOf()", () => {
  it("drops the extension and splits on anything that is not a letter or digit", () => {
    expect(tokensOf("IMG_20260903_S1001 (2).jpeg")).toEqual(["IMG", "20260903", "S1001", "2"]);
    expect(tokensOf("1234.jpg")).toEqual(["1234"]);
  });

  it("sanitises both sides the same way", () => {
    expect(sanitiseKey("228/12rte")).toBe("22812RTE");
  });
});

describe("matchPhotoFilename()", () => {
  it("matches SamPark's id as a whole token", () => {
    expect(matchPhotoFilename("S1001.jpg", roster)).toEqual({ kind: "matched", studentId: roster[0]!.studentId, by: "id" });
  });

  it("recovers an id a filename had to split", () => {
    expect(matchPhotoFilename("228 12RTE.jpg", roster)).toMatchObject({ kind: "matched", studentId: roster[1]!.studentId });
    expect(matchPhotoFilename("22812RTE.jpg", roster)).toMatchObject({ kind: "matched", studentId: roster[1]!.studentId });
  });

  it("matches by SR number, keeping leading zeros", () => {
    expect(matchPhotoFilename("class6_0103.png", roster)).toEqual({ kind: "matched", studentId: roster[2]!.studentId, by: "sr" });
    expect(matchPhotoFilename("class6_103.png", roster)).toEqual({ kind: "none" });
  });

  it("refuses a name holding two children's ids", () => {
    expect(matchPhotoFilename("S1001 and 0102.jpg", roster)).toMatchObject({ kind: "matched", by: "id" });
    expect(matchPhotoFilename("0101-0102.jpg", roster)).toMatchObject({ kind: "ambiguous", why: "several_srs" });
  });

  it("never matches by name — a file named for a child goes to the tray", () => {
    expect(matchPhotoFilename("Test Child One.jpg", roster)).toEqual({ kind: "none" });
  });
});

describe("placePhotos()", () => {
  it("refuses both files when a drop holds two for the same child", () => {
    const placed = placePhotos(["S1001.jpg", "S1001 (1).jpg", "0102.jpg"], roster);
    expect(placed[0]!.match).toMatchObject({ kind: "ambiguous", why: "same_child_twice" });
    expect(placed[1]!.match).toMatchObject({ kind: "ambiguous", why: "same_child_twice" });
    expect(placed[2]!.match).toMatchObject({ kind: "matched", studentId: roster[1]!.studentId });
  });

  it("keeps the drop's order", () => {
    expect(placePhotos(["b.jpg", "a.jpg"], roster).map((entry) => entry.filename)).toEqual(["b.jpg", "a.jpg"]);
  });
});
