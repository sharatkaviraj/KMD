"use client";

import dynamic from "next/dynamic";

/**
 * "Refresh roster now" and the quiet photo copy, fetched with the roster card
 * rather than carried by every page: the card sits in the shell, and the
 * button is for administrators only (D-554, the attendance page's budget).
 */
export const LazyRefreshRosterButton = dynamic(() => import("./refresh-roster-button").then((m) => m.RefreshRosterButton));
