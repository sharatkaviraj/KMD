import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LIST_AVATAR_WIDTH, listAvatar } from "@/platform/fees-bridge/list-avatar";
import { bridgeStudentPhotoHref } from "@/platform/fees-bridge/student-photo";

/* D-442: a list avatar is the Fees photo shrunk on the way through, never a bigger or broken one. */
async function jpeg(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 37) % 251;
  const buf = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, contentType: "image/jpeg" };
}

describe("list avatar", () => {
  it("shrinks a 600x800 photo to a small webp of the same shape", async () => {
    const input = await jpeg(600, 800);
    const out = await listAvatar(input);
    expect(out.contentType).toBe("image/webp");
    expect(out.bytes.byteLength).toBeLessThan(input.bytes.byteLength / 4);
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.width).toBe(LIST_AVATAR_WIDTH);
    expect(meta.height).toBe(256);
  });
  it("sends the original when the bytes cannot be read", async () => {
    const broken = { bytes: new Uint8Array([1, 2, 3, 4]).buffer, contentType: "image/jpeg" };
    expect(await listAvatar(broken)).toBe(broken);
  });
  it("never enlarges a photo already smaller than an avatar", async () => {
    const tiny = await jpeg(40, 50);
    const out = await listAvatar(tiny);
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.width).toBeLessThanOrEqual(40);
  });
  it("the list variant is a URL the route accepts", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(bridgeStudentPhotoHref(id, "2026-27", "list")).toBe(`/api/fees-bridge/students/${id}/photo?session=2026-27&variant=list`);
  });
});
