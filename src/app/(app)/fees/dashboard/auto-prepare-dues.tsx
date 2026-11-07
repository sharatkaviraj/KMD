"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { prepareDashboardDuesAction } from "./auto-prepare-actions";

/**
 * Starts the dashboard's dues preparation once the page is on screen, and
 * refreshes it when something was prepared so the totals include those
 * students. Draws nothing. See `prepareDashboardDuesAction` for why this is
 * not an `after()` in the page.
 */
export function AutoPrepareDues({ sessionLabel, studentIds }: { sessionLabel: string; studentIds: string[] }) {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || studentIds.length === 0) return;
    started.current = true;
    prepareDashboardDuesAction(sessionLabel, studentIds)
      .then((result) => {
        if (result.prepared > 0) router.refresh();
      })
      // The banner beside it already names the students; a failed background
      // attempt changes nothing on screen.
      .catch(() => {});
  }, [router, sessionLabel, studentIds]);

  return null;
}
