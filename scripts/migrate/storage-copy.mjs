#!/usr/bin/env node
/**
 * Copy the fees app's stored files into One's buckets at the same paths
 * (plan §2.6; critique0 #22).
 *
 *   node scripts/migrate/storage-copy.mjs                    # dry run (default)
 *   node scripts/migrate/storage-copy.mjs --apply            # copy
 *     --bucket student-photos     one bucket only
 *     --allow-dev-target          a rehearsal on a target not marked production
 *     --overwrite-different       also replace One objects whose size differs
 *
 * Buckets: student-photos, parent-documents, defaulter-voice-notes. Never
 * nightly-backups (each database keeps its own).
 *
 * Source: the sealed fees client — `list` and `download` are the only Storage
 * methods it has; remove / upload / move throw (lib/fees-readonly.mjs).
 * Target: One's main project only (scripts/target-guard.mjs), with One's own
 * service-role client.
 *
 * Idempotent by path + size: an object already on One with the same size is
 * skipped. Only objects MISSING on One are copied (created, not upserted).
 * An object on One with a different size is reported and kept — a photo or
 * document replaced in One is not reverted to the fees copy — unless
 * --overwrite-different. A failed listing of One's bucket stops the run
 * (only "bucket not found" counts as empty). Nothing on One is ever deleted.
 * Counts and bytes only on screen; no file name is printed (paths carry
 * student ids).
 */

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { isMain, loadFeesSecrets, loadOneEnv, parseArgs } from "./lib/env.mjs";
import { openFeesReadOnly } from "./lib/fees-readonly.mjs";
import { decideStorageGuard } from "./lib/guards.mjs";
import { COPIED_BUCKETS, isBucketMissing, listBucket, NEVER_COPIED_BUCKETS, storageCopyPlan, storageTotals } from "./lib/storage-list.mjs";
import { assertOneMainTarget, readDeploymentEnvironment } from "../target-guard.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = Boolean(args.apply);
  const buckets = typeof args.bucket === "string" ? [args.bucket] : COPIED_BUCKETS;
  for (const bucket of buckets) {
    if (NEVER_COPIED_BUCKETS.includes(bucket) || !COPIED_BUCKETS.includes(bucket)) throw new Error(`Bucket ${bucket} is not copied.`);
  }

  const oneEnv = loadOneEnv();
  assertOneMainTarget(oneEnv.NEXT_PUBLIC_SUPABASE_URL, "storage-copy");
  const one = createClient(oneEnv.NEXT_PUBLIC_SUPABASE_URL, oneEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const fees = openFeesReadOnly(loadFeesSecrets());

  if (apply) {
    const environment = await readDeploymentEnvironment({ url: oneEnv.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: oneEnv.SUPABASE_SERVICE_ROLE_KEY });
    const guard = decideStorageGuard({ environment, allowDevTarget: Boolean(args["allow-dev-target"]) });
    if (!guard.ok) {
      console.error(`storage-copy: refusing --apply. ${guard.reasons.join(" ")}`);
      process.exit(1);
    }
  }

  const overwrite = Boolean(args["overwrite-different"]);
  let failed = 0;
  for (const bucket of buckets) {
    const source = await listBucket(fees.storage.from(bucket));
    // Only a bucket that does not exist on One counts as empty. Any other
    // listing error stops the run: read as "empty", it would re-upload — and
    // overwrite — every object One already has.
    const target = await listBucket(one.storage.from(bucket)).catch((error) => {
      if (isBucketMissing(error)) return [];
      throw new Error(`listing One's ${bucket} failed (${error.message}); nothing copied.`);
    });
    const plan = storageCopyPlan(source, target);
    const differ = plan.copy.filter((c) => c.reason === "size");
    const copy = overwrite ? plan.copy : plan.copy.filter((c) => c.reason === "missing");
    const s = storageTotals(source);
    const t = storageTotals(target);
    console.log(
      `${bucket}: fees ${s.count} objects / ${s.bytes} bytes; One ${t.count} / ${t.bytes}; same ${plan.same}; missing on One ${plan.copy.length - differ.length}; different size on One ${differ.length}${differ.length && !overwrite ? " (kept: One's copy may be newer; --overwrite-different replaces them)" : ""}`,
    );
    if (!apply) continue;

    let copied = 0;
    for (const object of copy) {
      const { data, error } = await fees.storage.from(bucket).download(object.path);
      if (error || !data) {
        failed += 1;
        continue;
      }
      const body = Buffer.from(await data.arrayBuffer());
      if (body.length !== object.size) {
        failed += 1;
        continue;
      }
      // A missing object is created, never upserted: if One wrote that path
      // since the listing, the upload fails rather than replacing it.
      const { error: upErr } = await one.storage.from(bucket).upload(object.path, body, {
        upsert: object.reason === "size" && overwrite,
        contentType: data.type || undefined,
      });
      if (upErr) failed += 1;
      else copied += 1;
    }
    console.log(`  ${bucket}: copied ${copied} of ${copy.length}.`);
  }
  if (!apply) console.log("storage-copy: dry run, nothing written.");
  if (failed) {
    console.error(`storage-copy: ${failed} object(s) failed; run again (it skips what is already there).`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`storage-copy: ${error.message}`);
    process.exit(1);
  });
}
