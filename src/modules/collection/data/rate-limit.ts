import "server-only";

import { headers } from "next/headers";

import { createAdminClient } from "@/platform/supabase/admin";

/**
 * Rate limiting for the public token links.
 *
 * Ported from `sampark/src/lib/ratelimit.ts`. The reason it is counted in
 * Postgres rather than in memory is the one that matters: Vercel runs many
 * instances and each would keep its own private tally, so an in-memory limit
 * of 30 across ten instances is really a limit of 300 — which is not a limit.
 *
 * The whole check is one function call, and the window is reset inside the
 * same statement that increments it, so two concurrent requests cannot both
 * decide the window has expired and both reset the count to 1.
 *
 * Service-role because there is no session here: these routes are open by
 * design, and the token is the authorization. That is exactly why they need a
 * budget — a guess has to cost something.
 */

export const LIMITS = {
  /** One link, being worked through by one teacher. */
  perToken: { limit: 60, windowMs: 60_000 },
  /**
   * One address. Generous, because a staff room shares a wifi connection and
   * three teachers on the same one must not lock each other out.
   */
  perIp: { limit: 300, windowMs: 60 * 60_000 },
  /** Guessing a token. Deliberately mean: a wrong token is never innocent. */
  perIpUnknownToken: { limit: 20, windowMs: 60 * 60_000 },
} as const;

export type LimitVerdict = {
  allowed: boolean;
  hits: number;
  retryAfterMs: number;
};

const ALLOW: LimitVerdict = { allowed: true, hits: 0, retryAfterMs: 0 };

async function bump(
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<LimitVerdict> {
  const { data, error } = await createAdminClient().rpc("bump_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_ms: windowMs,
  });

  // A limiter that cannot count must not become a door that will not open:
  // the school's teachers are the overwhelming majority of this traffic, and
  // locking them out to punish a hypothetical guesser is the wrong trade.
  if (error) return ALLOW;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return ALLOW;

  return {
    allowed: Boolean(row.allowed),
    hits: Number(row.hits ?? 0),
    retryAfterMs: Number(row.retry_after_ms ?? 0),
  };
}

/**
 * The caller's address, as far as anything here can tell.
 *
 * `x-forwarded-for` is the first hop Vercel records. It can be spoofed by
 * somebody who wants to; the point of the IP budget is to make casual
 * enumeration expensive, not to be an identity.
 */
export async function clientIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || headerList.get("x-real-ip") || "unknown";
}

export async function limitByToken(token: string): Promise<LimitVerdict> {
  return bump(`token:${token}`, LIMITS.perToken.limit, LIMITS.perToken.windowMs);
}

export async function limitByIp(ip: string): Promise<LimitVerdict> {
  return bump(`ip:${ip}`, LIMITS.perIp.limit, LIMITS.perIp.windowMs);
}

/**
 * Charged only when a token turns out not to exist.
 *
 * Kept separate so that a teacher working steadily through her own link never
 * spends the guesser's budget, and a guesser never hides inside hers.
 */
export async function limitUnknownToken(ip: string): Promise<LimitVerdict> {
  return bump(
    `guess:${ip}`,
    LIMITS.perIpUnknownToken.limit,
    LIMITS.perIpUnknownToken.windowMs,
  );
}
