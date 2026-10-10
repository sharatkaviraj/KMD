"use client";

import dynamic from "next/dynamic";

/**
 * The search palette is only needed once someone presses Ctrl K or taps
 * search, so its code loads after the page rather than with every first
 * paint (the eager-JS budget in scripts/performance-bundles.mjs).
 */
export const LazySearchPalette = dynamic(() => import("./palette").then((m) => m.SearchPalette), { ssr: false });
