/**
 * P10c, against the database and the bucket: a photograph is placed by one
 * command, a replaced one is kept, a replace that did not see the current
 * photograph is refused, and the bytes are private.
 *
 *   npm run verify:photos            # exit 1 on any broken promise
 *   npm run verify:photos -- --json  # and write docs/evidence/P10-photos-<date>.json
 *
 * Synthetic 1×1 images on one enrolled child; every row and object it makes
 * is removed at the end. Rule 3: dev only. Rule 6: no real photograph.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { toolScope } from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

// Rule 3 / D-346, Phase 3: One's main project only, confined to TEST-2026-27 and test accounts on every marker.
const scope = await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "verify-photos", mode: "test-scoped" });

const options = { db: { schema: "vppsone" }, auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);
const BUCKET = "vppsone-photos";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// Confined (Phase 3): the QA accounts are test accounts, so the run lives in TEST-2026-27.
const { data: setting } = scope.confined ? { data: { value: scope.sessionLabel } } : await db.schema("public").from("app_settings").select("value").eq("key", "active_session_label").maybeSingle();
const SESSION = setting?.value;
const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
const profileOf = async (email) => {
  const user = users.users.find((entry) => entry.email === email);
  if (!user) throw new Error(`${email} has no account — run npm run qa:seed`);
  const { data } = await db.from("staff_profiles").select("id").eq("user_id", user.id).single();
  return data.id;
};
const office = await profileOf("qa.accountant@qa.vpps.local");
const teacher = await profileOf("qa.teacher@qa.vpps.local");

// A child with no photograph yet, so the scene starts from nothing.
const { data: enrolled } = await db.from("enrolments").select("student_id").eq("session_label", SESSION).eq("status", "enrolled").limit(50);
const { data: photographed } = await db.from("student_photos").select("student_id").in("student_id", enrolled.map((row) => row.student_id));
const taken = new Set((photographed ?? []).map((row) => row.student_id));
const CHILD = enrolled.map((row) => row.student_id).find((id) => !taken.has(id));
if (!CHILD) throw new Error("No enrolled child without a photograph in the first fifty.");

// A 1×1 PNG, a different byte each time so the hashes differ.
const pixel = (n) =>
  Buffer.from(
    `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8z8BQDwAEhQGA${String.fromCharCode(65 + n)}AABUlEQVQ=`,
    "base64",
  );

const objects = [];
async function place({ commandId = randomUUID(), expected = null, actor = office, student = CHILD, n = 0 }) {
  const bytes = pixel(n);
  const pathName = `${student}/${commandId}.png`;
  const upload = await db.storage.from(BUCKET).upload(pathName, bytes, { contentType: "image/png", upsert: false });
  if (!upload.error) objects.push(pathName);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const payload = { student, sha256, expected: expected ?? "", source: "file" };
  const { data, error } = await db.rpc("place_student_photo", {
    p: {
      command_id: commandId,
      actor_staff_id: actor,
      student_id: student,
      session_label: SESSION,
      storage_path: pathName,
      content_type: "image/png",
      byte_size: bytes.length,
      sha256,
      width: 1,
      height: 1,
      source: "file",
      source_ref: `qa-${n}.png`,
      expected_current: expected,
      payload_hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    },
  });
  return error ? { ok: false, reason: "raised", message: error.message } : data;
}
const current = async () =>
  (await db.from("student_photos").select("id, storage_path").eq("student_id", CHILD).is("replaced_at", null)).data ?? [];

console.log("\nP10c — photographs, against the database and the bucket\n");

try {
  const refused = await place({ actor: teacher });
  check("1. a teacher cannot place a photograph", refused.reason === "not_permitted" && (await current()).length === 0, refused.reason);

  const command = randomUUID();
  const first = await place({ commandId: command, n: 1 });
  const now = await current();
  check("2. the first photograph is placed and is the child's current one", first.ok && now.length === 1 && now[0].id === first.photo_id);

  const replay = await place({ commandId: command, n: 1 });
  check("3. the same command again returns what it did, and places nothing more", replay.replayed === true && replay.photo_id === first.photo_id);

  const blind = await place({ expected: null, n: 2 });
  check(
    "4. a photograph placed without seeing the current one is refused, not put on top",
    blind.reason === "stale" && blind.current === first.photo_id && (await current())[0].id === first.photo_id,
    blind.reason,
  );

  const second = await place({ expected: first.photo_id, n: 3 });
  const { data: old } = await db.from("student_photos").select("replaced_by, replaced_at, storage_path").eq("id", first.photo_id).single();
  const { data: oldBytes } = await db.storage.from(BUCKET).download(old.storage_path);
  check(
    "5. a retake replaces it, and the earlier photograph is kept — row and bytes — pointing at its replacement",
    second.ok && second.replaced === first.photo_id && old.replaced_by === second.photo_id && Boolean(oldBytes) && (await current()).length === 1,
  );

  const [a, b] = await Promise.all([place({ expected: second.photo_id, n: 4 }), place({ expected: second.photo_id, n: 5 })]);
  const winners = [a, b].filter((receipt) => receipt.ok).length;
  const stale = [a, b].filter((receipt) => receipt.reason === "stale").length;
  check("6. two retakes at once: one is placed, the other is told", winners === 1 && stale === 1 && (await current()).length === 1, `${winners} placed, ${stale} told`);

  const nobody = await place({ student: randomUUID(), n: 6 });
  check("7. a photograph of nobody on the roll is refused", nobody.reason === "no_such_child");

  const anonymous = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
  const { data: leaked } = await anonymous.storage.from(BUCKET).download((await current())[0].storage_path);
  const { data: bucket } = await db.storage.getBucket(BUCKET);
  check("8. the bucket is private: no key, no bytes", bucket?.public === false && !leaked);
} finally {
  await db.from("student_photos").update({ replaced_by: null, replaced_at: null }).eq("student_id", CHILD);
  await db.from("student_photos").delete().eq("student_id", CHILD);
  if (objects.length > 0) await db.storage.from(BUCKET).remove(objects);
}

const { count } = await db.from("student_photos").select("id", { count: "exact", head: true }).eq("student_id", CHILD);
check("9. nothing synthetic is left behind", count === 0);

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} held.\n`);

if (asJson) {
  const day = new Date().toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P10-photos-${day}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, out)}`);
}

process.exit(failed.length > 0 ? 1 : 0);
