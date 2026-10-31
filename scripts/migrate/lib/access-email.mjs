/**
 * Before any sign-in email goes to a fees user who has no One account (plan
 * Q6, answered 31 Oct by the owner): is the address One will send to the
 * address the live fees app has for that person?
 *
 * Those users are imported with their fees id (`planAuthImport` insert /
 * update); the ones whose email is already a One account are remapped onto it
 * and keep their One login and password, so they are not asked about here.
 * Emails are compared as lowercase, trimmed SHA-256 hashes and never printed:
 * a row says only the fees role and yes / no / not loaded.
 *
 * Pure apart from `node:crypto`; tests/access-email-check.test.ts.
 */

import { createHash } from "node:crypto";

import { planAuthImport } from "./auth-import.mjs";

/** sha256 of the lowercase, trimmed address; null for none. */
export function emailHash(email) {
  const clean = String(email ?? "").trim().toLowerCase();
  return clean ? createHash("sha256").update(clean).digest("hex") : null;
}

/**
 * sourceAuthUsers: live GoTrue users; sourceFeeUsers: live `public.users` rows
 * ({ id, role }); targetAuthUsers: One's `auth.users` ({ id, email });
 * knownMap: fees id -> One id from `vppsone.migration_id_map`.
 *
 * Returns { rows: [{ role, match }], remapped, clashes } where match is
 *   "yes"        One holds this user under the fees id and the address is the same,
 *   "no"         One holds this user and the address differs (or one side has none),
 *   "not loaded" the user is not in One yet (before the first real load).
 */
export function accessEmailCheck({ sourceAuthUsers, sourceFeeUsers, targetAuthUsers, knownMap = new Map() }) {
  const roleOf = new Map(sourceFeeUsers.map((row) => [String(row.id), String(row.role ?? "")]));
  // Only the fees app's staff: auth users behind a public.users row.
  const staff = sourceAuthUsers.filter((user) => roleOf.has(String(user.id)));
  const plan = planAuthImport(staff, targetAuthUsers, knownMap);
  const targetById = new Map(targetAuthUsers.map((user) => [String(user.id), user]));
  const sourceById = new Map(staff.map((user) => [String(user.id), user]));

  const rows = [...plan.insert, ...plan.update].map((id) => {
    const role = roleOf.get(id) || "(no role)";
    const target = targetById.get(id);
    if (!target) return { role, match: "not loaded" };
    const want = emailHash(sourceById.get(id)?.email);
    const have = emailHash(target.email);
    return { role, match: want !== null && want === have ? "yes" : "no" };
  });
  rows.sort((a, b) => a.role.localeCompare(b.role) || a.match.localeCompare(b.match));
  return { rows, remapped: plan.remap.length, clashes: plan.clashes.length };
}
