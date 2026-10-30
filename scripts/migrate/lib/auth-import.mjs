/**
 * The fees app's staff auth users, copied into One's `auth` so that
 * `public.users` (FK to auth.users) and every `created_by` column can load
 * (plan §2.4; critique0 #28).
 *
 *  - Upsert by id. An email that already belongs to a DIFFERENT One user is a
 *    clash, and the whole load refuses (never silently merged or renamed).
 *  - The password hash is never copied and never overwritten: the REST
 *    extractor cannot read it, a new user gets an empty one (no password
 *    sign-in until they reset — Q6), and an existing user keeps theirs, so a
 *    nightly re-copy never undoes a password change made in One.
 *  - Identities are inserted when missing, never changed.
 */

/** Pure. sourceUsers: GoTrue user objects; targetUsers: [{ id, email }]. */
export function planAuthImport(sourceUsers, targetUsers) {
  const byId = new Map(targetUsers.map((u) => [String(u.id), u]));
  const byEmail = new Map(targetUsers.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]));
  const plan = { insert: [], update: [], clashes: [] };
  for (const user of sourceUsers) {
    const email = user.email ? String(user.email).toLowerCase() : null;
    const sameEmail = email ? byEmail.get(email) : null;
    if (sameEmail && String(sameEmail.id) !== String(user.id)) {
      plan.clashes.push(String(user.id));
      continue;
    }
    if (byId.has(String(user.id))) plan.update.push(String(user.id));
    else plan.insert.push(String(user.id));
  }
  return plan;
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
