"use client";

import dynamic from "next/dynamic";

export type { QuickCoverTool } from "./quick-cover";

/** The quick-substitute sheet, fetched only when the "+" sheet's Photo or Speak is tapped. */
export const LazyQuickCover = dynamic(() => import("./quick-cover").then((m) => m.QuickCover), { ssr: false });
