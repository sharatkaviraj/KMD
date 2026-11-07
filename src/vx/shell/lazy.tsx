"use client";

import dynamic from "next/dynamic";

/**
 * The search palette is only needed once someone presses Ctrl K or taps
 * search, so its code loads after the page rather than with every first
 * paint (the eager-JS budget in scripts/performance-bundles.mjs).
 */
export const LazySearchPalette = dynamic(() => import("./palette").then((m) => m.SearchPalette), { ssr: false });

/**
 * "You are seeing One as…" (D-544) is drawn only while an administrator looks
 * at One as somebody else, so its code is fetched then and nobody else
 * downloads it. Still rendered on the server, so it is there at first paint.
 */
export const LazyPersonBanner = dynamic(() => import("./person-banner").then((m) => m.PersonBanner));
