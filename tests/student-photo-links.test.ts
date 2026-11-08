import { describe, expect, it } from "vitest";

import { fullPhotoHref } from "@/modules/collection/domain/photo-href";
import { checkPhotoLink, photoLinkDay, photoLinkHref, photoLinkSecondsLeft } from "@/modules/collection/domain/photo-link";

/*
 * Children's photo links the phone can keep (owner, 8 Nov 2026): the same
 * address all day, so a class list, a note and a child sheet fetch each face
 * once, and a token that only the server can make.
 */

const SECRET = "synthetic-photo-secret";
const CHILD = "00000000-0000-4000-8000-000000000001";
const ROW = "00000000-0000-4000-8000-0000000000aa";
const NOON = Date.UTC(2026, 10, 8, 6, 30);
const DAY = 86_400_000;

const params = (href: string) => new URL(href, "https://one.example").searchParams;

describe("student photo links", () => {
  it("gives the same address all day and a new one the next day", () => {
    const morning = photoLinkHref(SECRET, CHILD, ROW, "list", Date.UTC(2026, 10, 8, 0, 1));
    const evening = photoLinkHref(SECRET, CHILD, ROW, "list", Date.UTC(2026, 10, 8, 23, 59));
    expect(morning).toBe(evening);
    expect(morning.startsWith(`/api/photos/students/${CHILD}?`)).toBe(true);
    expect(photoLinkHref(SECRET, CHILD, ROW, "list", NOON + DAY)).not.toBe(morning);
  });

  it("accepts its own link until the end of the next day, and never after", () => {
    const href = photoLinkHref(SECRET, CHILD, ROW, "list", NOON);
    const checked = checkPhotoLink(SECRET, CHILD, params(href), NOON);
    expect(checked).toEqual({ studentId: CHILD, photoId: ROW, size: "list", secondsLeft: photoLinkSecondsLeft(photoLinkDay(NOON), NOON) });
    expect(checked!.secondsLeft).toBeGreaterThan(DAY / 1000);
    expect(checkPhotoLink(SECRET, CHILD, params(href), NOON + DAY)).not.toBeNull();
    expect(checkPhotoLink(SECRET, CHILD, params(href), NOON + 2 * DAY)).toBeNull();
  });

  it("refuses a link for another child, another photo, another size, a bad token or no secret", () => {
    const href = photoLinkHref(SECRET, CHILD, ROW, "list", NOON);
    const other = "00000000-0000-4000-8000-000000000002";
    expect(checkPhotoLink(SECRET, other, params(href), NOON)).toBeNull();
    const swapped = params(href);
    swapped.set("v", "00000000-0000-4000-8000-0000000000bb");
    expect(checkPhotoLink(SECRET, CHILD, swapped, NOON)).toBeNull();
    const forged = params(href);
    forged.set("t", "A".repeat(32));
    expect(checkPhotoLink(SECRET, CHILD, forged, NOON)).toBeNull();
    const weird = params(href);
    weird.set("s", "original");
    expect(checkPhotoLink(SECRET, CHILD, weird, NOON)).toBeNull();
    expect(checkPhotoLink("", CHILD, params(href), NOON)).toBeNull();
    expect(checkPhotoLink("another-secret", CHILD, params(href), NOON)).toBeNull();
  });

  it("refuses a link from the future, so a token cannot be made to last longer", () => {
    const later = photoLinkHref(SECRET, CHILD, ROW, "list", NOON + 3 * DAY);
    expect(checkPhotoLink(SECRET, CHILD, params(later), NOON)).toBeNull();
  });

  it("makes no link for something that is not a child's photo row", () => {
    expect(() => photoLinkHref(SECRET, "../secret", ROW)).toThrow("invalid_photo_identity");
    expect(() => photoLinkHref(SECRET, CHILD, "row")).toThrow("invalid_photo_identity");
  });

  it("turns any list photo into its large one for the open photo", () => {
    const list = photoLinkHref(SECRET, CHILD, ROW, "list", NOON);
    const full = fullPhotoHref(list);
    expect(params(full).get("s")).toBe("full");
    // The large photo is its own address with the same token: the size is not signed.
    expect(checkPhotoLink(SECRET, CHILD, params(full), NOON)?.size).toBe("full");
    expect(fullPhotoHref(`/api/fees-bridge/students/${CHILD}/photo?session=2026-27&variant=list`)).toBe(`/api/fees-bridge/students/${CHILD}/photo?session=2026-27&variant=full`);
    expect(fullPhotoHref("https://elsewhere.example/a.jpg")).toBe("https://elsewhere.example/a.jpg");
  });
});
