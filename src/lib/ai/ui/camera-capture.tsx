"use client";

import { useRef, useState } from "react";

import { AI_IMAGE_LONG_EDGE, AI_MAX_FILE_BYTES, AI_MAX_PAGES } from "@/lib/ai/media-limits";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";
import { Btn } from "@/vx/ui/primitives";
import { useVx } from "@/vx/i18n";

/** A small JPEG data URL of each compressed page, made while compressing; no object URLs to revoke. */
const previews = new WeakMap<Blob, string>();

/** Small previews of the pages taken, so a teacher can see the photo is the right sheet before it is read. */
function Thumbs({ files, disabled, onRemove }: { files: Blob[]; disabled?: boolean; onRemove: (index: number) => void }) {
  const { tx } = useVx();
  if (!files.length) return null;
  return <ul className="mt-3 flex flex-wrap gap-2" aria-label={tx(p("Pages", "पन्ने"))}>
    {files.map((file, i) => <li key={i} style={{ position: "relative", width: 76, height: 96 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL, never optimised */}
      <img src={previews.get(file)} alt={tx(p("Page " + (i + 1), "पन्ना " + (i + 1)))}
        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12, border: "1px solid var(--bd)" }} />
      <button type="button" className="tap" disabled={disabled} onClick={() => onRemove(i)}
        aria-label={tx(p("Remove page " + (i + 1), "पन्ना हटाएँ " + (i + 1)))}
        style={{ position: "absolute", top: -8, right: -8, width: 32, height: 32, borderRadius: 16, border: "2px solid var(--card)",
          background: "var(--fg)", color: "var(--card)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Ic n="x" size={16} />
      </button>
    </li>)}
  </ul>;
}

export async function compressAiPhoto(source: File): Promise<Blob> {
  if (source.size > 25 * 1024 * 1024) throw new Error("Image too large");
  const url = URL.createObjectURL(source);
  try {
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    if (!picture.naturalWidth || !picture.naturalHeight) throw new Error("Empty image");
    const scale = Math.min(1, AI_IMAGE_LONG_EDGE / Math.max(picture.naturalWidth, picture.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Image processing unavailable");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!result || result.type !== "image/jpeg" || result.size > AI_MAX_FILE_BYTES) throw new Error("Image too large");
    const small = document.createElement("canvas");
    const fit = Math.min(1, 192 / Math.max(canvas.width, canvas.height));
    small.width = Math.max(1, Math.round(canvas.width * fit));
    small.height = Math.max(1, Math.round(canvas.height * fit));
    small.getContext("2d")?.drawImage(canvas, 0, 0, small.width, small.height);
    previews.set(result, small.toDataURL("image/jpeg", 0.7));
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function CameraCapture({ files, onChange, disabled }: {
  files: Blob[];
  onChange: (files: Blob[]) => void;
  disabled?: boolean;
}) {
  const { tx } = useVx();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(false);

  async function add(input: HTMLInputElement) {
    const selected = Array.from(input.files ?? []);
    input.value = "";
    if (!selected.length) return;
    setError(false);
    if (files.length + selected.length > AI_MAX_PAGES) return setError(true);
    setPreparing(true);
    try {
      const compressed: Blob[] = [];
      for (const file of selected) compressed.push(await compressAiPhoto(file));
      onChange([...files, ...compressed]);
    } catch {
      setError(true);
    } finally {
      setPreparing(false);
    }
  }

  const locked = disabled || preparing || files.length >= AI_MAX_PAGES;
  return (
    <div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void add(e.currentTarget)} />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.currentTarget)} />
      <div className="grid grid-cols-2 gap-2">
        <Btn variant="sec" big icon="camera" disabled={locked} onClick={() => camera.current?.click()}>
          {files.length ? tx(p("Add page", "पन्ना जोड़ें")) : tx(p("Take photo", "फ़ोटो लें"))}
        </Btn>
        <Btn variant="ghost" big disabled={locked} onClick={() => gallery.current?.click()}>{tx(p("From gallery", "गैलरी से"))}</Btn>
      </div>
      <Thumbs files={files} disabled={disabled || preparing} onRemove={(i) => onChange(files.filter((_, j) => i !== j))} />
      <p className="mt-2 text-sm" role="status" style={{ color: "var(--mut)" }}>
        {preparing ? tx(p("Preparing photos…", "फ़ोटो तैयार हो रही हैं…")) :
          tx(p(files.length + " of " + AI_MAX_PAGES + " pages", AI_MAX_PAGES + " में से " + files.length + " पन्ने"))}
      </p>
      {error && <p role="alert">{tx(p("Choose up to four readable photos, or retake the page.", "अधिकतम चार साफ़ फ़ोटो चुनें, या पन्ने की फ़ोटो फिर लें।"))}</p>}
    </div>
  );
}
