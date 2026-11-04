"use client";

import { useRef, useState } from "react";

import { AI_IMAGE_LONG_EDGE, AI_MAX_FILE_BYTES, AI_MAX_PAGES } from "@/lib/ai/media-limits";
import { p } from "@/vx/text";
import { Btn } from "@/vx/ui/primitives";
import { useVx } from "@/vx/i18n";

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
      <div className="flex flex-wrap gap-2">
        <Btn variant="sec" disabled={locked} onClick={() => camera.current?.click()}>{tx(p("Take photo", "फ़ोटो लें"))}</Btn>
        <Btn variant="ghost" disabled={locked} onClick={() => gallery.current?.click()}>{tx(p("Choose photos", "फ़ोटो चुनें"))}</Btn>
      </div>
      <p className="mt-2 text-sm" role="status">
        {preparing ? tx(p("Preparing photos…", "फ़ोटो तैयार हो रही हैं…")) :
          tx(p(files.length + " of " + AI_MAX_PAGES + " pages", AI_MAX_PAGES + " में से " + files.length + " पन्ने"))}
      </p>
      {!!files.length && <div className="flex flex-wrap gap-2">
        {files.map((_, i) => <Btn key={i} variant="ghost" disabled={disabled || preparing} onClick={() => onChange(files.filter((_, j) => i !== j))}>
          {tx(p("Remove page " + (i + 1), "पन्ना हटाएँ " + (i + 1)))}
        </Btn>)}
      </div>}
      {error && <p role="alert">{tx(p("Choose up to four readable photos, or retake the page.", "अधिकतम चार साफ़ फ़ोटो चुनें, या पन्ने की फ़ोटो फिर लें।"))}</p>}
    </div>
  );
}
