"use client";

import dynamic from "next/dynamic";

export type { QuickCoverTool } from "./quick-cover";

/** The quick-substitute sheet, fetched only when the "+" sheet's Photo or Speak is tapped. */
export const LazyQuickCover = dynamic(() => import("./quick-cover").then((m) => m.QuickCover), { ssr: false });

/**
 * The "+" sheet's Quick substitute row, fetched when the sheet opens for
 * someone who may use it; the bar every screen carries holds only this loader.
 */
export const LazyQuickCoverRow = dynamic(() => import("./quick-cover-row").then((m) => m.QuickCoverRow), { ssr: false });
