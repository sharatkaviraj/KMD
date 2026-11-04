"use client";

import { useState } from "react";

import { schoolToday } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";

import { BoloSheet } from "./bolo-panel";
import { CoverPhotoPanel } from "./cover-photo-panel";

/** What the "+" sheet's quick substitute opened: a photo already taken, or the microphone. */
export type QuickCoverTool = { kind: "photo"; files: File[]; key: number } | { kind: "voice"; key: number };

/**
 * Quick substitute from the phone's "+" button: read today's substitution
 * register from the photo just taken, or say the cover to Bolo. Loaded only
 * when one of the two is tapped (`LazyQuickCover`), so the bottom bar every
 * screen carries stays small.
 */
export function QuickCover({ tool, onClose }: { tool: QuickCoverTool; onClose: () => void }) {
  const { tx } = useVx();
  const [open, setOpen] = useState(true);
  // Let the sheet play its closing animation before it is removed.
  const close = () => {
    setOpen(false);
    window.setTimeout(onClose, 220);
  };
  if (tool.kind === "voice") return <BoloSheet open={open} onClose={close} cover />;
  return <Sheet open={open} onClose={close} backCloses icon="camera"
    title={tx(p("Substitute from a photo", "फ़ोटो से बदली"))}
    sub={tx(p("Today’s substitution register", "आज का व्यवस्था रजिस्टर"))}>
    <CoverPhotoPanel day={schoolToday()} initial={null} embedded initialPhotos={tool.files} />
  </Sheet>;
}
