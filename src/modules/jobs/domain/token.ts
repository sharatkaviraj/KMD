import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The per-job secret.
 *
 * One `JOBS_SECRET` is configured, and each job's token is derived from it —
 * so the four jobs have four different tokens and **none of them is the
 * secret**. A token can be handed to whatever triggers one job without handing
 * over the ability to trigger the others, and a token that leaks out of a log
 * or a cron dashboard reveals nothing about the rest.
 *
 * HMAC rather than a hash of the two strings joined: `secret + job` and
 * `secre + tjob` produce the same input to a plain hash, and while nothing
 * here would ever hit that, using the construction that is actually designed
 * for keyed derivation costs one line.
 *
 * This is pure and takes no database, so both the check and the derivation are
 * testable — which matters, because a comparison that quietly always returns
 * true is the failure nobody notices.
 */
export function jobTokenFor(secret: string, job: string): string {
  return createHmac("sha256", secret).update(job).digest("hex").slice(0, 32);
}

/**
 * Whether a presented token is the right one for this job.
 *
 * Compared in constant time. A byte-by-byte comparison that returns early
 * leaks, through timing, how much of a guess was right — which turns finding a
 * 128-bit token from impossible into tedious.
 *
 * An empty or missing secret refuses everything rather than accepting
 * everything: an unconfigured deploy should have jobs that do not run, not
 * jobs anybody can run.
 */
export function tokenMatches(
  secret: string | undefined,
  job: string,
  presented: string | null | undefined,
): boolean {
  if (!secret || !presented) return false;

  const expected = Buffer.from(jobTokenFor(secret, job), "utf8");
  const given = Buffer.from(presented, "utf8");

  // `timingSafeEqual` throws on a length mismatch, which would itself be a
  // timing signal — and a wrong-length token is simply wrong.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * Whether this is the platform's own scheduler.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on a cron request when
 * that variable is set. Accepted alongside the per-job token so the scheduled
 * path needs no per-job configuration, while anything else that wants to
 * trigger a single job still can, with a token that only opens that one.
 */
export function isPlatformCron(
  cronSecret: string | undefined,
  authorization: string | null | undefined,
): boolean {
  if (!cronSecret || !authorization) return false;

  const expected = Buffer.from(`Bearer ${cronSecret}`, "utf8");
  const given = Buffer.from(authorization, "utf8");

  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
