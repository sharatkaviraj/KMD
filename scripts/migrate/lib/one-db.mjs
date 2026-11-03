/**
 * A direct Postgres connection to One's main database, for scripts/migrate/*.
 *
 * Some migration work cannot go through PostgREST: one transaction across many
 * tables, `COPY`, `SET LOCAL`, disabling named triggers for one statement,
 * reading a catalog fingerprint. Those use `postgres` (porsager) over the
 * Supabase **session pooler** (port 5432 — session mode, so `SET`, prepared
 * statements and transactions behave as on a direct connection; the direct
 * host is IPv6-only on this plan).
 *
 * It refuses any project but ONE_MAIN_PROJECT_REF. In particular it can never
 * be pointed at the fees app's live database (FEES_SOURCE_PROJECT_REF): that
 * one is read only through a sealed select-only reader, never through this.
 *
 * Secrets by name only (I-6): the password is `SUPABASE_DEV_DB_PASSWORD` from
 * `.env.local`. Nothing here prints it, and errors carry the host, never the
 * connection string.
 *
 *   const sql = await openOneDb(env);
 *   try { … await sql`select 1` … } finally { await sql.end(); }
 */

import {
  FEES_SOURCE_PROJECT_REF,
  ONE_MAIN_PROJECT_REF,
  projectRefOf,
} from "../../target-guard.mjs";

/** ap-south-1, where `wtgxcptmucjerhufzjcf` lives. Override with SUPABASE_DB_POOLER_HOST. */
export const DEFAULT_POOLER_HOST = "aws-0-ap-south-1.pooler.supabase.com";

/**
 * The connection options for `env`, or a thrown refusal. Pure, so the refusal
 * is testable without a network or the `postgres` package.
 */
export function oneDbOptions(env, { ref } = {}) {
  const target = ref ?? projectRefOf(env?.NEXT_PUBLIC_SUPABASE_URL ?? "");

  if (target === FEES_SOURCE_PROJECT_REF) {
    throw new Error(
      "Refusing a direct connection to the fees app's live database. One only reads it, " +
        "through the sealed select-only reader (D-339).",
    );
  }
  if (target !== ONE_MAIN_PROJECT_REF) {
    throw new Error(`Refusing a direct connection to ${target ?? "an unknown project"}: only ${ONE_MAIN_PROJECT_REF} (D-338).`);
  }

  const password = env?.SUPABASE_DEV_DB_PASSWORD;
  if (!password) throw new Error("SUPABASE_DEV_DB_PASSWORD is not set in .env.local.");

  return {
    host: env.SUPABASE_DB_POOLER_HOST || DEFAULT_POOLER_HOST,
    port: 5432,
    database: "postgres",
    // The session pooler names the project in the user.
    username: `postgres.${ONE_MAIN_PROJECT_REF}`,
    password,
    ssl: "require",
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    // No notices on stdout: a migration run's output is counts and hashes.
    onnotice: () => {},
    connection: { application_name: "vppsone-migrate" },
  };
}

/** Open the connection. `postgres` is a devDependency, loaded only here. */
export async function openOneDb(env) {
  const options = oneDbOptions(env);
  const { default: postgres } = await import("postgres");
  return postgres(options);
}
