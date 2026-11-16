import "server-only";

import { feesCopyFreshness, type FeesCopyFreshness } from "@/modules/coexistence/domain/fees-copy";
import { createAdminClient } from "@/platform/supabase/admin";

/**
 * The night's copy of the Fees app into One (D-644, D-648), as One's app sees
 * it. Three reads, all of One's own database (the `vppsone` schema): the copy
 * itself runs in Postgres and never in Vercel.
 */

type Db = ReturnType<typeof createAdminClient>;

/**
 * Is this the Bearer secret the night's request carries? It lives in Vault as
 * `FEES_COPY_CRON_SECRET` and is compared in Postgres
 * (`vppsone.fees_copy_secret_matches`), so no copy of it sits in Vercel.
 */
export async function feesCopySecretMatches(secret: string, db: Db = createAdminClient()): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(secret)) return false;
  const { data, error } = await db.rpc("fees_copy_secret_matches", { p_secret: secret });
  return !error && data === true;
}

/**
 * The cache tags of every real year and every child in one, named from the
 * copied rows (`vppsone.fees_copy_cache_tags`). Throws when they cannot be
 * read: clearing half the screens and answering "done" would be worse.
 */
export async function readFeesCopyCacheTags(db: Db = createAdminClient()): Promise<unknown[]> {
  const { data, error } = await db.rpc("fees_copy_cache_tags");
  if (error) throw new Error(`fees_copy_cache_tags: ${error.message}`);
  if (!Array.isArray(data)) throw new Error("fees_copy_cache_tags did not answer a list");
  return data as unknown[];
}

/**
 * When the last copy that wrote finished. null when none has, and when it
 * cannot be read: the line then says so rather than guessing a time.
 */
export async function readLastFeesCopy(db: Db = createAdminClient()): Promise<{ finishedAt: string | null } | null> {
  const { data, error } = await db
    .from("fees_copy_runs")
    .select("finished_at")
    .eq("mode", "apply")
    .eq("status", "applied")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<{ finished_at: string | null }>();
  if (error) return null;
  return { finishedAt: data?.finished_at ?? null };
}

/**
 * The shell's "updated from Fees" line: when the last copy that wrote
 * finished, and whether that counts as last night's. `unread` when it could
 * not be read, so the line never claims a copy it did not see.
 */
export async function readFeesCopyStatus(now: Date = new Date()): Promise<{ freshness: FeesCopyFreshness | "unread"; finishedAt: string | null }> {
  const last = await readLastFeesCopy().catch(() => null);
  if (!last) return { freshness: "unread", finishedAt: null };
  return { freshness: feesCopyFreshness(last.finishedAt, now), finishedAt: last.finishedAt };
}
