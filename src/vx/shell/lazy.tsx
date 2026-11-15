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

/**
 * The rest of "See the app as" is an administrator's too: the sidebar's list
 * of people and roles, and the role preview's banner. Every page used to carry
 * their code for everybody; now only an administrator fetches it, and the
 * server still draws both.
 */
export const LazyPreviewLinks = dynamic(() => import("./preview-links").then((m) => m.PreviewLinks));
export const LazyPreviewBanner = dynamic(() => import("./preview-banner").then((m) => m.PreviewBanner));

/**
 * "Parents are waiting for your reply" and the new-message card (D-618): only
 * people who answer parents' chats fetch it. Drawn on the server too, so the
 * strip is there at first paint.
 */
export const LazyChatsNudge = dynamic(() => import("./chats-nudge").then((m) => m.ChatsNudge));
