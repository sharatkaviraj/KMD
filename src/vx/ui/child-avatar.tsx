"use client";

import { Face } from "./face";
import { avatarColor } from "./primitives";

/**
 * The design's round `Avatar` (`primitives.tsx`) for a child: the photo, found
 * by the child's id when the screen has none, opening large on a tap. Kept
 * apart from `primitives.tsx` and `face.tsx`, because the shell itself draws `Avatar` and
 * every page would then carry the photo lookup (the attendance budget).
 */
export function ChildAvatar({ text, seed, size = 40, bg, photo, student, zoom, zoomSub }: { text: string; seed?: string; size?: number; bg?: string; photo?: string | null; student?: string | null; zoom?: string | null; zoomSub?: string | null }) {
  return (
    <Face
      photo={photo}
      student={student}
      zoom={zoom}
      zoomSub={zoomSub}
      style={{ flex: "none", width: size, height: size, borderRadius: size / 2, background: bg ?? avatarColor(seed ?? text), color: "#082F49", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: Math.max(11, Math.round(size * 0.34)), fontWeight: 700 }}
    >
      {text}
    </Face>
  );
}
