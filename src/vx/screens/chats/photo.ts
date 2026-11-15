/*
 * A photo made ready to send (D-616): turned the right way up, no side longer
 * than 1600 px, saved as a JPEG. A phone's camera photo is 3-6 MB and WhatsApp
 * takes 5 MB at most; this one is a few hundred KB, goes up on a slow school
 * connection, and leaves the camera's hidden details (where it was taken)
 * behind, because only the picture is drawn again.
 *
 * Browser only: it needs a canvas.
 */

const LONGEST_SIDE = 1600;
const QUALITY = 0.82;

export type ReadyPhoto = { blob: Blob; width: number; height: number };

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Older Safari: fall through to an <img>, which also turns it the right way up.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (caught) {
    URL.revokeObjectURL(url);
    throw caught;
  }
}

/** The photo, smaller and as a JPEG; throws when the browser cannot read it. */
export async function readyPhoto(file: Blob): Promise<ReadyPhoto> {
  const decoded = await decode(file);
  try {
    const scale = Math.min(1, LONGEST_SIDE / Math.max(decoded.width, decoded.height, 1));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas.");
    // A transparent PNG would turn black as a JPEG: paint it on white first.
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) throw new Error("The photo could not be saved as a JPEG.");
    return { blob, width, height };
  } finally {
    decoded.close();
  }
}
