/**
 * The fees app's staff auth users, copied into One's `auth` so that
 * `public.users` (FK to auth.users) and every `created_by` column can load
 * (plan §2.4; critique0 #28).
 *
 *  - Upsert by id.
 *  - A fees user whose email (case-insensitive) already belongs to a
 *    DIFFERENT One user is the same person (D-350, plan §1.4): no second auth
 *    user is created. The fees id is REMAPPED onto One's id — every reference
 *    in the loaded rows is rewritten (`remapUserReferences`) and the pair is
 *    recorded in `vppsone.migration_id_map` (source_table 'auth.users'), so
 *    the next run maps it the same way even if an email changes. Only an
 *    ambiguous case still refuses: two fees users claiming one One user.
 *  - The password hash is never copied and never overwritten: the REST
 *    extractor cannot read it, a new user gets an empty one (no password
 *    sign-in until they reset — Q6), and an existing user keeps theirs, so a
 *    nightly re-copy never undoes a password change made in One.
 *  - Identities are inserted when missing, never changed.
 */

/**
 * Pure. sourceUsers: GoTrue user objects; targetUsers: [{ id, email }];
 * knownMap: fees id -> One id already recorded in migration_id_map.
 */
export function planAuthImport(sourceUsers, targetUsers, knownMap = new Map()) {
  const byId = new Map(targetUsers.map((u) => [String(u.id), u]));
  const byEmail = new Map(targetUsers.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]));
  const plan = { insert: [], update: [], clashes: [], remap: [] };
  const claimed = new Map();
  const claim = (sourceId, targetId) => {
    if (claimed.has(targetId) && claimed.get(targetId) !== sourceId) {
      plan.clashes.push(sourceId);
      return;
    }
    claimed.set(targetId, sourceId);
    plan.remap.push({ sourceId, targetId });
  };
  for (const user of sourceUsers) {
    const id = String(user.id);
    const known = knownMap.get(id);
    if (known && known !== id && byId.has(String(known))) {
      claim(id, String(known));
      continue;
    }
    const email = user.email ? String(user.email).toLowerCase() : null;
    const sameEmail = email ? byEmail.get(email) : null;
    if (sameEmail && String(sameEmail.id) !== id) {
      claim(id, String(sameEmail.id));
      continue;
    }
    if (byId.has(id)) plan.update.push(id);
    else plan.insert.push(id);
  }
  return plan;
}

/**
 * The source rows with every remapped fees user id replaced by One's id.
 * Pure; returns a new Map and leaves `source` as it was.
 *
 * Every top-level value equal to a remapped id is replaced, in every column
 * of every table: `public.users.id`, `created_by`, `posted_by`, `received_by`,
 * `resolved_by` and the rest. A uuid equal to a user id by accident is not a
 * thing that happens, so matching on the value is both complete and safe.
 * Ids nested inside jsonb (audit payloads) are left as the fees app wrote
 * them: they are history, not references.
 */
export function remapUserReferences(source, remap) {
  if (!remap?.length) return source;
  const map = new Map(remap.map((r) => [String(r.sourceId), String(r.targetId)]));
  const out = new Map();
  for (const [table, rows] of source) {
    out.set(
      table,
      rows.map((row) => {
        let copy = null;
        for (const [column, value] of Object.entries(row)) {
          if (typeof value === "string" && map.has(value)) {
            copy ??= { ...row };
            copy[column] = map.get(value);
          }
        }
        return copy ?? row;
      }),
    );
  }
  return out;
}

/**
 * A fees role, as `public.users.role` holds it, to the One role a fees user
 * with no One account is given (D-350). The forward map — One role to fee
 * role — is `vppsone.fee_role_map`; this is its inverse for the five fees
 * roles, and an unknown role is the least: view_only.
 */
export function oneRoleForFeeRole(feeRole) {
  switch (feeRole) {
    case "admin":
    case "accountant":
    case "fee_collector":
    case "teacher":
    case "view_only":
      return feeRole;
    default:
      return "view_only";
  }
}

/** A short name for a new profile: initials, made unique (case-insensitive) with a number. Pure. */
export function shortNameFor(fullName, taken) {
  const words = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const base = (words.map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "FEE").slice(0, 4);
  const lower = new Set([...taken].map((t) => String(t).toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n += 1) if (!lower.has(`${base}${n}`.toLowerCase())) return `${base}${n}`;
  throw new Error("Could not find a free short name.");
}

function nullIfBlank(value) {
  return value === "" || value === undefined ? null : value;
}

/** Apply inside the load transaction. Returns counts. */
export async function applyAuthImport(tx, sourceUsers, plan) {
  const wanted = new Set([...plan.insert, ...plan.update]);
  let identities = 0;
  for (const user of sourceUsers) {
    if (!wanted.has(String(user.id))) continue;
    const row = {
      id: user.id,
      aud: user.aud ?? "authenticated",
      role: user.role ?? "authenticated",
      email: nullIfBlank(user.email),
      phone: nullIfBlank(user.phone),
      email_confirmed_at: user.email_confirmed_at ?? null,
      phone_confirmed_at: user.phone_confirmed_at ?? null,
      raw_app_meta_data: user.app_metadata ?? {},
      raw_user_meta_data: user.user_metadata ?? {},
      banned_until: user.banned_until ?? null,
      created_at: user.created_at ?? null,
      updated_at: user.updated_at ?? null,
      is_anonymous: user.is_anonymous ?? false,
    };
    await tx`
      insert into auth.users (instance_id, id, aud, role, email, phone, email_confirmed_at, phone_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, banned_until, created_at, updated_at, is_anonymous, encrypted_password)
      values ('00000000-0000-0000-0000-000000000000', ${row.id}, ${row.aud}, ${row.role}, ${row.email}, ${row.phone},
        ${row.email_confirmed_at}, ${row.phone_confirmed_at}, ${tx.json(row.raw_app_meta_data)}, ${tx.json(row.raw_user_meta_data)},
        ${row.banned_until}, coalesce(${row.created_at}::timestamptz, now()), coalesce(${row.updated_at}::timestamptz, now()), ${row.is_anonymous}, '')
      on conflict (id) do update set
        email = excluded.email,
        phone = excluded.phone,
        email_confirmed_at = excluded.email_confirmed_at,
        raw_app_meta_data = excluded.raw_app_meta_data,
        raw_user_meta_data = excluded.raw_user_meta_data,
        banned_until = excluded.banned_until,
        updated_at = excluded.updated_at
    `;
    for (const identity of user.identities ?? []) {
      const result = await tx`
        insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
        values (${identity.identity_id ?? identity.id}, ${user.id}, ${identity.provider_id ?? identity.id}, ${identity.provider},
          ${tx.json(identity.identity_data ?? {})}, ${identity.last_sign_in_at ?? null}, coalesce(${identity.created_at ?? null}::timestamptz, now()),
          coalesce(${identity.updated_at ?? null}::timestamptz, now()))
        on conflict do nothing
      `;
      identities += result.count;
    }
  }
  return { users: wanted.size, identitiesInserted: identities };
}
