"use client";

import { useEffect } from "react";

/**
 * The teachers' photo copy carries on by itself when a real admin opens One
 * (owner, 8 Nov 2026, D-555). This mounts in the shell for that admin only;
 * everything it does is in `photo-catch-up-run.ts`, loaded a few seconds
 * after the page opens, so no page carries it up front.
 */
export function PhotoCatchUp() {
  useEffect(() => {
    let gone = false;
    const timer = setTimeout(() => {
      void import("./photo-catch-up-run").then(({ catchUpPhotos }) => catchUpPhotos(() => gone)).catch(() => {});
    }, 5_000);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, []);
  return null;
}
