#!/usr/bin/env node
/**
 * The Smoke Lab's accounts on the test database.
 *
 *   npm run smoke:pool               # create or repair every seat (safe to re-run)
 *   npm run smoke:pool -- status     # list the seats and what each is linked to
 *   npm run smoke:pool -- release    # take the pool apart again
 *
 * **Test database only.** It refuses anything but the dev project (rule 3),
 * and it only ever creates `smoke.*@qa.vpps.local` addresses — no real member
 * of staff, no password. A teacher seat is attached to an existing teacher
 * profile that has no login (a real class and timetable on the test data); every
 * other seat gets a profile of its own. Signing in still needs a pass from an
 * open run on `/smoke`; an account with no live pass is banned by the
 * database (`vppsone.smoke_enforce`) and refused by the app.
 *
 * Every account carries `app_metadata.smoke_lab = true`. Only the service role
 * can set app metadata, so the app still knows a smoke account if it changes
 * its own email (D-314).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { SMOKE_SEATS, isSmokeEmail } from "../src/modules/smoke/domain/pool.ts";
import { assertDevTarget } from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);
assertDevTarget(env.NEXT_PUBLIC_SUPABASE_URL, "smoke:pool");

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "vppsone" },
});

const command = process.argv[2] ?? "ensure";

async function authUsersByEmail() {
  const byEmail = new Map();
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list sign-in accounts: ${error.message}`);
    for (const user of data.users) if (user.email) byEmail.set(user.email.toLowerCase(), user);
    if (data.users.length < 1000) break;
  }
  return byEmail;
}

async function poolRows() {
  const { data, error } = await admin.from("smoke_pool").select("email, auth_user_id, staff_profile_id, role, label, linked_existing, original_language");
  if (error) throw new Error(`Could not read the pool: ${error.message}`);
  return new Map(data.map((row) => [row.email, row]));
}

/** Teacher profiles a seat may borrow: active, no login, a current class teacher. */
async function freeTeacherProfiles(taken) {
  const [{ data: profiles, error: pErr }, { data: held, error: hErr }] = await Promise.all([
    admin.from("staff_profiles").select("id").eq("role", "teacher").eq("is_active", true).is("user_id", null).order("id"),
    admin.from("class_teachers").select("staff_profile_id").eq("role", "class_teacher").is("effective_to", null),
  ]);
  if (pErr || hErr) throw new Error(`Could not read teacher profiles: ${(pErr ?? hErr).message}`);
  const classTeachers = new Set(held.map((row) => row.staff_profile_id));
  return profiles.map((p) => p.id).filter((id) => classTeachers.has(id) && !taken.has(id));
}

async function ensure() {
  const users = await authUsersByEmail();
  const pool = await poolRows();
  const taken = new Set([...pool.values()].map((row) => row.staff_profile_id));
  let free = null;
  for (const seat of SMOKE_SEATS) {
    if (!isSmokeEmail(seat.email)) throw new Error(`Refusing a non-smoke address: ${seat.email}`);
    let user = users.get(seat.email);
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({ email: seat.email, email_confirm: true, app_metadata: { smoke_lab: true }, user_metadata: { smoke_lab: true } });
      if (error) throw new Error(`Could not create ${seat.email}: ${error.message}`);
      user = data.user;
      console.log(`created sign-in  ${seat.email}`);
    } else if (user.app_metadata?.smoke_lab !== true) {
      const { error } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, smoke_lab: true } });
      if (error) throw new Error(`Could not flag ${seat.email}: ${error.message}`);
      console.log(`flagged          ${seat.email}`);
    }
    if (pool.has(seat.email)) {
      console.log(`ok               ${seat.email}`);
      continue;
    }
    let profileId;
    let linked = false;
    let originalLanguage = null;
    if (seat.role === "teacher") {
      free ??= await freeTeacherProfiles(taken);
      profileId = free.shift();
      if (!profileId) throw new Error(`No free class-teacher profile left for ${seat.email}`);
      const { data: before, error: readError } = await admin.from("staff_profiles").select("preferred_language").eq("id", profileId).single();
      if (readError) throw new Error(`Could not read the profile for ${seat.email}: ${readError.message}`);
      originalLanguage = before.preferred_language;
      const { data, error } = await admin.from("staff_profiles").update({ user_id: user.id, preferred_language: seat.language }).eq("id", profileId).is("user_id", null).select("id");
      if (error || data.length !== 1) throw new Error(`Could not link ${seat.email}: ${error?.message ?? "the profile was taken meanwhile"}`);
      linked = true;
    } else {
      // A profile left behind by an earlier `release` is reused, not duplicated.
      const { data: old, error: oldError } = await admin.from("staff_profiles").select("id").eq("short_name", seat.shortName).eq("role", seat.role).is("user_id", null).limit(1);
      if (oldError) throw new Error(`Could not look for an old profile for ${seat.email}: ${oldError.message}`);
      const fields = { user_id: user.id, display_name: seat.label, short_name: seat.shortName, role: seat.role, is_teaching: false, is_active: true, preferred_language: seat.language };
      const { data, error } = old.length
        ? await admin.from("staff_profiles").update(fields).eq("id", old[0].id).is("user_id", null).select("id").single()
        : await admin.from("staff_profiles").insert(fields).select("id").single();
      if (error) throw new Error(`Could not set up a profile for ${seat.email}: ${error.message}`);
      profileId = data.id;
    }
    taken.add(profileId);
    const { error } = await admin.from("smoke_pool").insert({ email: seat.email, auth_user_id: user.id, staff_profile_id: profileId, role: seat.role, label: seat.label, linked_existing: linked, original_language: originalLanguage });
    if (error) throw new Error(`Could not record ${seat.email}: ${error.message}`);
    console.log(`${linked ? "linked teacher " : "created profile"}  ${seat.email}`);
  }
  // New accounts are banned at once, not at the next two-minute sweep.
  const { error } = await admin.rpc("smoke_enforce");
  if (error) throw new Error(`Could not apply bans: ${error.message}`);
  console.log("bans applied: only accounts with a live pass can sign in");
}

async function status() {
  const pool = await poolRows();
  for (const seat of SMOKE_SEATS) {
    const row = pool.get(seat.email);
    console.log(`${seat.email.padEnd(38)} ${seat.role.padEnd(22)} ${row ? (row.linked_existing ? "linked to an existing teacher" : "own profile") : "NOT SET UP"}`);
  }
}

async function release() {
  const pool = await poolRows();
  for (const row of pool.values()) {
    const { error: profileError } = row.linked_existing
      ? await admin.from("staff_profiles").update({ user_id: null, ...(row.original_language ? { preferred_language: row.original_language } : {}) }).eq("id", row.staff_profile_id).eq("user_id", row.auth_user_id)
      : await admin.from("staff_profiles").update({ is_active: false, user_id: null }).eq("id", row.staff_profile_id);
    if (profileError) throw new Error(`Could not detach the profile of ${row.email}: ${profileError.message}`);
    const { error } = await admin.from("smoke_pool").delete().eq("email", row.email);
    if (error) throw new Error(`Could not release ${row.email}: ${error.message}`);
    const { error: userError } = await admin.auth.admin.deleteUser(row.auth_user_id);
    if (userError) console.warn(`could not delete the sign-in for ${row.email}: ${userError.message}`);
    console.log(`released        ${row.email}`);
  }
}

const run = { ensure, status, release }[command];
if (!run) {
  console.error("Usage: npm run smoke:pool [-- status | release]");
  process.exit(1);
}
await run();
