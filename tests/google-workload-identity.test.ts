import { beforeEach, expect, it, vi } from "vitest";

import {
  DRIVE_SCOPE,
  GoogleAuthError,
  forgetGoogleToken,
  googleAccessToken,
  poolAudience,
} from "@/platform/google/workload-identity";

const config = {
  projectNumber: "123456789012",
  poolId: "vercel-pool",
  providerId: "vercel-vppsone",
  serviceAccountEmail: "vppsone-drive@synthetic-project.iam.gserviceaccount.com",
};

function google(overrides: { sts?: number; iam?: number; throwOn?: "sts" | "iam" } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://sts.googleapis.com/")) {
      if (overrides.throwOn === "sts") throw new TypeError("fetch failed");
      if (overrides.sts) return Response.json({ error: "invalid_grant", error_description: "synthetic" }, { status: overrides.sts });
      return Response.json({ access_token: "federated-token", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.includes(":generateAccessToken")) {
      if (overrides.throwOn === "iam") throw new TypeError("fetch failed");
      if (overrides.iam) return Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: overrides.iam });
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer federated-token");
      return Response.json({ accessToken: "drive-token", expireTime: "2026-10-27T12:00:00Z" });
    }
    throw new Error(`unexpected ${url}`);
  });
}

beforeEach(() => forgetGoogleToken());

it("trades the Vercel token for a one-hour Drive token, keyless", async () => {
  const fetch = google();
  const token = await googleAccessToken(config, "vercel-oidc", { fetch, now: () => Date.parse("2026-10-27T11:00:00Z") });
  expect(token).toBe("drive-token");

  const sts = JSON.parse(String(fetch.mock.calls[0]![1]!.body)) as Record<string, string>;
  expect(sts.audience).toBe(poolAudience(config));
  expect(sts.subjectToken).toBe("vercel-oidc");
  expect(sts.subjectTokenType).toBe("urn:ietf:params:oauth:token-type:jwt");

  expect(String(fetch.mock.calls[1]![0])).toContain(encodeURIComponent(config.serviceAccountEmail));
  const iam = JSON.parse(String(fetch.mock.calls[1]![1]!.body)) as { scope: string[]; lifetime: string };
  expect(iam).toEqual({ scope: [DRIVE_SCOPE], lifetime: "3600s" });
});

it("reuses the token until five minutes before it expires", async () => {
  const fetch = google();
  await googleAccessToken(config, "vercel-oidc", { fetch, now: () => Date.parse("2026-10-27T11:00:00Z") });
  await googleAccessToken(config, "vercel-oidc", { fetch, now: () => Date.parse("2026-10-27T11:50:00Z") });
  expect(fetch).toHaveBeenCalledTimes(2);
  await googleAccessToken(config, "vercel-oidc", { fetch, now: () => Date.parse("2026-10-27T11:56:00Z") });
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("refuses without a Vercel identity: a laptop or a script gets nothing", async () => {
  const fetch = google();
  await expect(googleAccessToken(config, null, { fetch, now: Date.now })).rejects.toMatchObject({ kind: "no_identity" });
  expect(fetch).not.toHaveBeenCalled();
});

it("reports a removed pool binding or Drive membership as revoked", async () => {
  await expect(googleAccessToken(config, "t", { fetch: google({ sts: 400 }), now: Date.now })).rejects.toMatchObject({ kind: "revoked" });
  await expect(googleAccessToken(config, "t", { fetch: google({ iam: 403 }), now: Date.now })).rejects.toMatchObject({ kind: "revoked" });
});

it("reports Google being unreachable as worth retrying", async () => {
  const failure = await googleAccessToken(config, "t", { fetch: google({ throwOn: "sts" }), now: Date.now }).catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(GoogleAuthError);
  expect(failure).toMatchObject({ kind: "unavailable" });
  await expect(googleAccessToken(config, "t", { fetch: google({ iam: 503 }), now: Date.now })).rejects.toMatchObject({ kind: "unavailable" });
});
