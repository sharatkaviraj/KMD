import sharp from "sharp";

/*
 * D-442. Fees answers both of its photo variants with the original, up to
 * 512 KB, and a Students page draws fifty of them in a 46 px circle. Shrunk
 * here to 192 px wide (a 46 px avatar on a 3x phone screen is 138 px, with
 * room to spare), the same photo is a few kilobytes. The aspect ratio is kept;
 * the avatar's `object-fit: cover` does the cropping, as it did before.
 *
 * Nothing is stored: the bytes are shrunk in memory on the way through and
 * travel under the route's own private, ten-minute browser cache. If the
 * shrink fails the original is sent, so a photo never disappears over it.
 */
export const LIST_AVATAR_WIDTH = 192;

export async function listAvatar(photo: { bytes: ArrayBuffer; contentType: string }): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  try {
    const out = await sharp(Buffer.from(photo.bytes), { limitInputPixels: 40_000_000, failOn: "error" })
      .rotate()
      .resize({ width: LIST_AVATAR_WIDTH, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
    if (out.byteLength === 0 || out.byteLength >= photo.bytes.byteLength) return photo;
    return { bytes: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer, contentType: "image/webp" };
  } catch {
    return photo;
  }
}
