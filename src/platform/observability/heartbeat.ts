/**
 * Scheduled-job heartbeat.
 *
 * The jobs console answers "did the cron fire?" for somebody who opens it. A
 * heartbeat answers it for nobody-opened-it: each scheduled run ends by pinging
 * a URL that an outside watcher expects to hear from on schedule, and the
 * watcher raises the alarm when it does not.
 *
 * The URL is whatever the monitoring service hands out for a "check-in" —
 * Honeybadger today, any other ping-a-URL service later — so changing provider
 * is an environment-variable change, not a code change. No variable set means
 * no ping, and a ping never fails or slows the job it reports on.
 *
 * One variable per job: `HEARTBEAT_URL_DRIVE_BACKUP` for `drive-backup`, and so on.
 */

import { logWarn } from "@/platform/observability/log";

const HEARTBEAT_TIMEOUT_MS = 3_000;

/** `drive-backup` → `HEARTBEAT_URL_DRIVE_BACKUP`. */
export function heartbeatEnvName(job: string): string {
  return `HEARTBEAT_URL_${job.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

export async function sendHeartbeat(job: string): Promise<void> {
  const url = process.env[heartbeatEnvName(job)];
  if (!url) return;

  try {
    await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    });
  } catch (error) {
    logWarn("heartbeat.failed", { job, cause: error });
  }
}
