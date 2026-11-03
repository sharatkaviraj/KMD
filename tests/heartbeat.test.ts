import { afterEach, describe, expect, it, vi } from "vitest";

import { heartbeatEnvName, sendHeartbeat } from "@/platform/observability/heartbeat";

/**
 * Scheduled-job heartbeat: one variable per job, off without it, and a ping
 * that fails never reaches the job that sent it. Synthetic URLs only.
 */

const URL_FOR_BACKUP = "https://checkins.example.test/abc123";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the heartbeat", () => {
  it("names one variable per job", () => {
    expect(heartbeatEnvName("drive-backup")).toBe("HEARTBEAT_URL_DRIVE_BACKUP");
    expect(heartbeatEnvName("fee-day-not-closed")).toBe("HEARTBEAT_URL_FEE_DAY_NOT_CLOSED");
  });

  it("does nothing when the job has no URL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("HEARTBEAT_URL_DRIVE_BACKUP", "");

    await sendHeartbeat("drive-backup");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pings the job's own URL", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("HEARTBEAT_URL_DRIVE_BACKUP", URL_FOR_BACKUP);

    await sendHeartbeat("drive-backup");

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe(URL_FOR_BACKUP);
  });

  it("never throws when the watcher is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    vi.stubEnv("HEARTBEAT_URL_DRIVE_BACKUP", URL_FOR_BACKUP);

    await expect(sendHeartbeat("drive-backup")).resolves.toBeUndefined();
  });
});
