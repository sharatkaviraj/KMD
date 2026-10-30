/**
 * Storage objects of a bucket, recursively, as [{ path, size }]. Works on the
 * sealed fees client (`fees.storage.from(bucket)`) and on One's own client
 * alike: both expose `list(prefix, { limit, offset })`. A folder comes back
 * with `id: null`; a file carries `metadata.size`.
 */

export const COPIED_BUCKETS = ["student-photos", "parent-documents", "defaulter-voice-notes"];
/** Never copied: each database keeps its own backups. */
export const NEVER_COPIED_BUCKETS = ["nightly-backups"];

export async function listBucket(files, prefix = "") {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await files.list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${prefix || "/"}: ${error.message}`);
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null || entry.id === undefined) {
        out.push(...(await listBucket(files, path)));
      } else if (entry.name !== ".emptyFolderPlaceholder") {
        out.push({ path, size: Number(entry.metadata?.size ?? 0) });
      }
    }
    if ((data ?? []).length < 1000) return out;
  }
}

/** Is this listing error "the bucket does not exist" (the only one that means empty)? Pure. */
export function isBucketMissing(error) {
  return /bucket not found|not_found/i.test(String(error?.message ?? error ?? ""));
}

/** Count and bytes. Pure. */
export function storageTotals(objects) {
  return { count: objects.length, bytes: objects.reduce((n, o) => n + o.size, 0) };
}

/** What a copy would do: objects missing on the target, or there with another size. Pure. */
export function storageCopyPlan(sourceObjects, targetObjects) {
  const target = new Map(targetObjects.map((o) => [o.path, o.size]));
  const copy = [];
  let same = 0;
  for (const object of sourceObjects) {
    if (target.get(object.path) === object.size) same += 1;
    else copy.push({ ...object, reason: target.has(object.path) ? "size" : "missing" });
  }
  return { copy, same };
}
