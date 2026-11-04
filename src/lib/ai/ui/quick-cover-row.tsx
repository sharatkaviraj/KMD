"use client";

import Link from "next/link";
import { useRef } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";

import type { QuickCoverTool } from "./quick-cover";

const QR = {
  cover: { en: "Quick substitute", hi: "जल्दी बदली" },
  coverSub: { en: "Photograph the register or say who covers", hi: "रजिस्टर की फ़ोटो लें या बोलकर बताएँ" },
  photo: { en: "Photo", hi: "फ़ोटो" },
  speak: { en: "Speak", hi: "बोलें" },
  arrange: { en: "Arrange", hi: "व्यवस्था" },
};

let toolSeq = 0;

/**
 * Quick substitute (the "+" sheet's first row, for people who may arrange
 * cover while built-in AI is on). Photo opens the phone camera on the same
 * tap — a file input must be clicked inside the tap to be allowed to open —
 * and the picture goes straight to the register reader. Speak opens Bolo.
 */
export function QuickCoverRow({ onPick, onClose }: { onPick: (tool: QuickCoverTool) => void; onClose: () => void }) {
  const { tx } = useVx();
  const camera = useRef<HTMLInputElement>(null);
  const tile = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 84, padding: "10px 6px", borderRadius: 18, border: 0, fontSize: 14, fontWeight: 700, textAlign: "center" } as const;
  return (
    <section aria-label={tx(QR.cover)} style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 22, background: "var(--accs)", animation: "xRise .42s var(--ease) both" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(QR.cover)}</span>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(QR.coverSub)}</span>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          if (!files.length) return;
          onClose();
          onPick({ kind: "photo", files, key: ++toolSeq });
        }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <button type="button" className="tap" onClick={() => camera.current?.click()} style={{ ...tile, background: "var(--pri)", color: "var(--prifg)" }}>
          <Ic n="camera" size={26} />
          {tx(QR.photo)}
        </button>
        <button type="button" className="tap" onClick={() => { onClose(); onPick({ kind: "voice", key: ++toolSeq }); }} style={{ ...tile, background: "var(--card)", color: "var(--fg)", border: "1px solid var(--bd)" }}>
          <Ic n="mic" size={26} />
          {tx(QR.speak)}
        </button>
        <Link href="/substitutions/arrange" onClick={onClose} className="tap" style={{ ...tile, background: "var(--card)", color: "var(--fg)", border: "1px solid var(--bd)" }}>
          <Ic n="swap" size={26} />
          {tx(QR.arrange)}
        </Link>
      </div>
    </section>
  );
}
