/**
 * RFC 4122 version-5 UUIDs (SHA-1, name-based), so a re-keyed row gets the
 * same new id on every run and a re-run of quarantine or promote is
 * idempotent (plan §4.3: "a new uuid v5 from `dev:<table>:<id>`").
 *
 * Computed here rather than with `extensions.uuid_generate_v5()` so the
 * mapping is known before the transaction opens (the dry run reports it) and
 * is pinned by a test against the RFC's own example. Pure.
 */

import { createHash } from "node:crypto";

/**
 * The namespace every One migration id is derived in. A fixed value, never
 * changed: changing it would re-key every shell on the next run.
 */
export const ONE_MIGRATION_NAMESPACE = "6d1f6f9e-3b0a-4c55-9d1e-0f2a7c4b8e31";

function uuidBytes(uuid) {
  const hex = String(uuid).replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`Not a uuid: ${uuid}`);
  return Buffer.from(hex, "hex");
}

/** uuidV5("dev:students:<id>") → the shell's id. */
export function uuidV5(name, namespace = ONE_MIGRATION_NAMESPACE) {
  const hash = createHash("sha1").update(uuidBytes(namespace)).update(Buffer.from(String(name), "utf8")).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The id a dev row is re-keyed to: `dev:<table>:<id>`. */
export function devId(table, id) {
  return uuidV5(`dev:${table}:${id}`);
}
