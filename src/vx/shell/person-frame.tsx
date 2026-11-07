"use client";

import { useEffect } from "react";

import { VIEW_AS_DOCUMENT_FLAG } from "@/platform/supabase/view-as-browser";

/**
 * An amber edge round the whole screen while an administrator sees One as
 * somebody else (D-544), so a scrolled page still says so. It also tells the
 * browser's own data clients that the view is on, so an upload straight from
 * the phone is refused too (`platform/supabase/view-as-browser.ts`).
 *
 * Kept apart from the banner, whose code loads only while a view is on
 * (`lazy.tsx`): this is the part that must be there from the first paint,
 * and it is a few lines. Styled inline for the same reason; the banner's
 * stylesheet only hides it when printing.
 */
export function PersonFrame() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(VIEW_AS_DOCUMENT_FLAG, "1");
    return () => root.removeAttribute(VIEW_AS_DOCUMENT_FLAG);
  }, []);
  return (
    <div
      className="vxp-frame"
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, zIndex: 70, pointerEvents: "none", border: "3px solid #D9902F" }}
    />
  );
}
