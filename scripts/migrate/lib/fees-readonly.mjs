/**
 * The ONLY way scripts/migrate/* reach the fees app's live database
 * `vgqyilgstjvgohrsiwkb` (D-339; plan I-2, I-3; critique0 #22).
 *
 * It is sealed twice, so that no caller — and no mistake — can write to it:
 *
 *  1. **The surface.** `openFeesReadOnly()` does not hand out a supabase-js
 *     client. It hands out an object with exactly these reads:
 *        from(table).select(...)  -> filters / order / range / limit / single
 *        storage.listBuckets()
 *        storage.from(bucket).list / download / createSignedUrl / createSignedUrls
 *        authAdmin.listUsers() / getUserById()  -> GoTrue admin reads (no password hashes)
 *        openApi()                -> the PostgREST OpenAPI document (GET)
 *     Anything else — insert, update, upsert, delete, rpc, schema(),
 *     storage remove / upload / move / copy / update / createBucket /
 *     deleteBucket / emptyBucket, auth createUser / deleteUser / updateUserById
 *     / inviteUserByEmail / generateLink, channel, functions — throws a
 *     `FeesReadOnlyError`. A query builder is wrapped too: setting a property
 *     on it (say `method = "DELETE"`) throws, and so does any method that is
 *     not on the read list.
 *  2. **The wire.** The client's `fetch` refuses every request that is not a
 *     GET or HEAD, except the two POSTs Storage uses to *read*
 *     (`/storage/v1/object/list/…` and `/storage/v1/object/sign/…`). So even
 *     a builder that escaped the first seal cannot send a write.
 *
 * tests/migrate-readonly.test.ts proves both seals.
 *
 * An optional direct Postgres path (`openFeesReadOnlyPg`) exists for the day a
 * `LIVE_DB_URL` is put in the secrets file. It is SECONDARY: REST is the
 * default extractor because there is no live Postgres password today. When
 * used, the connection is opened with `default_transaction_read_only=on`,
 * every read runs inside one `REPEATABLE READ READ ONLY` transaction, and
 * `pg_export_snapshot()` names the snapshot.
 *
 * Secrets by name only: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
 * and `LIVE_DB_URL` from the fees secrets file. Nothing here prints a value.
 */

import { createClient } from "@supabase/supabase-js";

import { FEES_SOURCE_PROJECT_REF, projectRefOf } from "../../target-guard.mjs";

export class FeesReadOnlyError extends Error {
  constructor(what) {
    super(`The fees app's live database is read-only from One (D-339): ${what} is not allowed.`);
    this.name = "FeesReadOnlyError";
  }
}

/* -------------------------------------------------------------- the wire */

/**
 * Anchored, so an upload whose path merely CONTAINS one of these
 * (`/storage/v1/object/<bucket>/x/storage/v1/object/list/y`) is refused:
 *   list  POST /storage/v1/object/list/<bucket>             (one segment)
 *   sign  POST /storage/v1/object/sign/<bucket>[/<path>]    (createSignedUrl(s))
 */
const STORAGE_READ_POSTS = [/^\/storage\/v1\/object\/list\/[^/]+$/, /^\/storage\/v1\/object\/sign\/[^/]+(\/.*)?$/];

/** Is this request a read? Pure, so it is tested without a network. */
export function isReadOnlyRequest(url, method) {
  const verb = String(method ?? "GET").toUpperCase();
  if (verb === "GET" || verb === "HEAD") return true;
  if (verb === "POST") {
    const pathname = (() => {
      try {
        return new URL(String(url)).pathname;
      } catch {
        return "";
      }
    })();
    return STORAGE_READ_POSTS.some((pattern) => pattern.test(pathname));
  }
  return false;
}

/** A fetch that throws before sending anything that is not a read. */
export function readOnlyFetch(baseFetch = globalThis.fetch) {
  return async function sealedFetch(input, init = {}) {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const method = init?.method ?? (typeof input === "object" && input?.method) ?? "GET";
    if (!isReadOnlyRequest(url, method)) {
      throw new FeesReadOnlyError(`${String(method).toUpperCase()} ${safePath(url)}`);
    }
    return baseFetch(input, init);
  };
}

function safePath(url) {
  try {
    return new URL(String(url)).pathname;
  } catch {
    return "a request";
  }
}

/* ----------------------------------------------------------- the surface */

/** Builder methods that only shape a read. Everything else on a builder throws. */
const BUILDER_READS = new Set([
  "select", "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "likeAllOf", "likeAnyOf",
  "ilikeAllOf", "ilikeAnyOf", "is", "in", "contains", "containedBy", "overlaps", "not", "or",
  "filter", "match", "order", "limit", "range", "single", "maybeSingle", "abortSignal",
  "returns", "overrideTypes", "textSearch", "isDistinct", "regexMatch", "regexIMatch",
]);

function sealBuilder(builder, label) {
  const method = String(builder?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new FeesReadOnlyError(`${label} (${method})`);

  return new Proxy(builder, {
    get(target, prop) {
      if (prop === "then") {
        const verb = String(target.method ?? "GET").toUpperCase();
        if (verb !== "GET" && verb !== "HEAD") throw new FeesReadOnlyError(`${label} (${verb})`);
        return target.then.bind(target);
      }
      if (typeof prop === "symbol") return undefined;
      if (BUILDER_READS.has(prop) && typeof target[prop] === "function") {
        return (...args) => {
          const next = target[prop](...args);
          return next && typeof next === "object" && "method" in next ? sealBuilder(next, label) : next;
        };
      }
      throw new FeesReadOnlyError(`${label}.${String(prop)}`);
    },
    set(_target, prop) {
      throw new FeesReadOnlyError(`setting ${label}.${String(prop)}`);
    },
    defineProperty(_target, prop) {
      throw new FeesReadOnlyError(`defining ${label}.${String(prop)}`);
    },
    deleteProperty(_target, prop) {
      throw new FeesReadOnlyError(`deleting ${label}.${String(prop)}`);
    },
  });
}

/** An object that throws on every property but the ones named. */
function onlyThese(label, allowed) {
  return new Proxy(Object.freeze({ ...allowed }), {
    get(target, prop) {
      if (typeof prop === "symbol" || prop === "then" || prop === "toJSON") return undefined;
      if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
      throw new FeesReadOnlyError(`${label}.${String(prop)}`);
    },
    set(_target, prop) {
      throw new FeesReadOnlyError(`setting ${label}.${String(prop)}`);
    },
  });
}

/**
 * Seal an already-made supabase-js client. Exported for the tests, which pass
 * a client built against a fake URL with a fetch that never leaves the
 * process. Production code calls `openFeesReadOnly()`.
 */
/**
 * @param {any} client
 * @param {{ url?: string, serviceRoleKey?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {any}
 */
export function sealClient(client, { url, serviceRoleKey, fetchImpl = globalThis.fetch } = {}) {
  const from = (table) => {
    if (typeof table !== "string" || !/^[a-z_][a-z0-9_]*$/.test(table)) throw new FeesReadOnlyError(`from(${String(table)})`);
    const query = client.from(table);
    return onlyThese(`from(${table})`, {
      select: (...args) => sealBuilder(query.select(...args), `from(${table}).select`),
    });
  };

  const storage = onlyThese("storage", {
    listBuckets: (...args) => client.storage.listBuckets(...args),
    from: (bucket) => {
      const files = client.storage.from(bucket);
      return onlyThese(`storage.from(${bucket})`, {
        list: (...args) => files.list(...args),
        download: (...args) => files.download(...args),
        createSignedUrl: (...args) => files.createSignedUrl(...args),
        createSignedUrls: (...args) => files.createSignedUrls(...args),
      });
    },
  });

  const authAdmin = onlyThese("authAdmin", {
    listUsers: (...args) => client.auth.admin.listUsers(...args),
    getUserById: (...args) => client.auth.admin.getUserById(...args),
  });

  const openApi = async () => {
    const response = await readOnlyFetch(fetchImpl)(`${new URL(url).origin}/rest/v1/`, {
      method: "GET",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: "application/openapi+json" },
    });
    if (!response.ok) throw new Error(`OpenAPI read failed with HTTP ${response.status}.`);
    return response.json();
  };

  return onlyThese("fees", { from, storage, authAdmin, openApi, projectRef: FEES_SOURCE_PROJECT_REF });
}

/**
 * Open the fees app's live database for reading. Refuses any URL whose host
 * is not exactly `vgqyilgstjvgohrsiwkb.supabase.co`.
 */
export function openFeesReadOnly(secrets, { fetchImpl = globalThis.fetch } = {}) {
  const url = secrets?.NEXT_PUBLIC_SUPABASE_URL ?? secrets?.SUPABASE_URL;
  const serviceRoleKey = secrets?.SUPABASE_SERVICE_ROLE_KEY;
  if (projectRefOf(url ?? "") !== FEES_SOURCE_PROJECT_REF) {
    throw new Error(`The fees secrets file does not point at ${FEES_SOURCE_PROJECT_REF}; refusing.`);
  }
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing from the fees secrets file.");

  const sealed = readOnlyFetch(fetchImpl);
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: "public" },
    global: { fetch: sealed, headers: { "x-client-info": "vppsone-migrate-readonly" } },
  });
  return sealClient(client, { url, serviceRoleKey, fetchImpl: sealed });
}

/* ------------------------------------------- the optional Postgres path */

/** Connection options for LIVE_DB_URL, or a refusal. Pure. */
export function feesPgOptions(secrets) {
  const raw = secrets?.LIVE_DB_URL;
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("LIVE_DB_URL is not a URL.");
  }
  const host = parsed.hostname.toLowerCase();
  const user = decodeURIComponent(parsed.username);
  const names = `${host} ${user}`;
  if (!names.includes(FEES_SOURCE_PROJECT_REF)) {
    throw new Error(`LIVE_DB_URL does not name ${FEES_SOURCE_PROJECT_REF}; refusing.`);
  }
  if (parsed.port === "6543") {
    throw new Error("LIVE_DB_URL is the transaction pooler; an exported snapshot needs a session or direct connection (critique0 #27).");
  }
  return {
    url: raw,
    options: {
      max: 1,
      ssl: "require",
      onnotice: () => {},
      connection: { application_name: "vppsone-migrate-readonly", default_transaction_read_only: "on" },
    },
  };
}

/**
 * Run `work(tx, snapshot)` inside one REPEATABLE READ READ ONLY transaction on
 * live, with the snapshot exported and `now()` read inside it. Secondary path.
 */
export async function withFeesReadOnlySnapshot(secrets, work) {
  const config = feesPgOptions(secrets);
  if (!config) throw new Error("LIVE_DB_URL is not set; the REST extractor is the default.");
  const { default: postgres } = await import("postgres");
  const sql = postgres(config.url, config.options);
  try {
    return await sql.begin("isolation level repeatable read read only", async (tx) => {
      const [row] = await tx`select pg_export_snapshot() as snapshot_id, now() as snapshot_at,
        current_setting('transaction_read_only') as read_only`;
      if (row.read_only !== "on") throw new Error("The live transaction is not read-only; refusing.");
      return work(tx, { snapshotId: row.snapshot_id, snapshotAt: row.snapshot_at });
    });
  } finally {
    await sql.end();
  }
}
