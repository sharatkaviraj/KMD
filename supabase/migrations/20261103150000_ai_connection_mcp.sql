-- The AI connection, first slice (M0/M1): One's own small OAuth 2.1
-- authorization server for the MCP endpoint, and its metadata-only call log
-- (docs/plans/2026-11-03-mcp-feasibility.md §5.2 option B, §5.3, §6.3; the
-- guarantees and their tests are in docs/plans/2026-11-03-mcp-m1-security-contract.md).
--
--  * ai_oauth_clients — public clients from dynamic registration (RFC 7591).
--    Redirect URIs were checked against an allowlist in code before insert.
--  * ai_connections   — one grant: which staff member, which auth user, which
--    client and provider, 90 days at most (owner decision D8), revoked with a
--    reason and by whom.
--  * ai_oauth_codes   — single-use authorization codes, 60 seconds, bound to
--    the client, redirect URI, PKCE challenge, resource and connection.
--  * ai_tokens        — access (15 minutes) and refresh (rotated, never past
--    the connection's expiry) tokens.
--  * ai_tool_calls    — one row per tool call: staff, connection, provider,
--    tool, outcome, row count, duration. Never arguments, names or free text
--    (the assist_log rule). Kept 180 days (D8), purged by `ai_purge`.
--
-- Codes and tokens are opaque random values; only their SHA-256 (hex) is
-- stored, so a copy of these tables opens nothing. Single use is decided here,
-- not in the app: each redemption locks its row (`select … for update`), so of
-- two concurrent redemptions exactly one finds it unused, and the other is
-- treated as reuse — the whole connection and every token from it is revoked
-- (RFC 6749 §4.1.2, OAuth 2.1 refresh rotation).
--
-- Service role only, like vppsone.assist_log: RLS on with no policy, every
-- grant to anon and authenticated revoked, functions executable by
-- service_role alone. Nothing here touches fee data.
--
-- The kill switch is a new runtime_flags key, `ai_connection`, added OFF:
-- absent or unreadable is off in the app as well.
--
-- Rollback:
--   drop function vppsone.ai_purge(integer), vppsone.ai_connection_list(uuid, integer),
--     vppsone.ai_staff_for_user(uuid), vppsone.ai_call_counts(uuid),
--     vppsone.ai_revoke_token(text, text), vppsone.ai_revoke_staff_connections(uuid, text, uuid),
--     vppsone.ai_resolve_access(text), vppsone.ai_rotate_refresh(text, text, text, text, text, integer),
--     vppsone.ai_exchange_code(text, text, text, text, text, text, text, integer),
--     vppsone.ai_create_grant(uuid, uuid, text, text, text[], text, text, text, text, integer, integer),
--     vppsone.ai_revoke_connection(uuid, text, uuid), vppsone.ai_register_client(text, text, text[], integer);
--   drop table vppsone.ai_tool_calls, vppsone.ai_tokens, vppsone.ai_oauth_codes,
--     vppsone.ai_connections, vppsone.ai_oauth_clients;
--   delete from vppsone.runtime_flags where key = 'ai_connection';
--   re-add runtime_flags_key_known without it (20261031125856).

/* ------------------------------------------------------------ the switch */

alter table vppsone.runtime_flags drop constraint if exists runtime_flags_key_known;
alter table vppsone.runtime_flags add constraint runtime_flags_key_known check (
  key in (
    'cover_command',
    'staff_notice_dispatch',
    'fault_injection',
    'parent_dispatch',
    'parent_dispatch_categories',
    'absent_notice_owner',
    'parent_dispatch_test_only',
    'staff_notice_kinds_enabled',
    'staff_whatsapp_month_cap',
    'staff_notice_student_names',
    'aisensy_month_plan_cap',
    'ai_connection'
  )
);
insert into vppsone.runtime_flags (key, enabled, value, note)
values (
  'ai_connection', false, null,
  'AI connection (Claude / ChatGPT through MCP) for eligible staff. Off = every tool call is refused; connections and the call log are kept.'
)
on conflict (key) do nothing;

/* --------------------------------------------------------------- tables */

create table vppsone.ai_oauth_clients (
  client_id text primary key check (client_id ~ '^[A-Za-z0-9_-]{22,64}$'),
  -- Display only, never trusted: the consent card names the provider from
  -- the redirect host, not from this.
  client_name text check (client_name is null or char_length(client_name) <= 80),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 5),
  created_at timestamptz not null default now()
);

comment on table vppsone.ai_oauth_clients is
  'AI connection: public OAuth clients from dynamic registration. Every redirect URI matched an allowlist in code (src/modules/mcp/domain/redirects.ts).';

create index ai_oauth_clients_created on vppsone.ai_oauth_clients (created_at);

create table vppsone.ai_connections (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references vppsone.staff_profiles (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null references vppsone.ai_oauth_clients (client_id) on delete restrict,
  provider text not null check (provider in ('claude', 'chatgpt', 'local')),
  scopes text[] not null check (cardinality(scopes) between 1 and 4),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references vppsone.staff_profiles (id) on delete set null,
  revoke_reason text check (revoke_reason is null or revoke_reason ~ '^[a-z_]{2,40}$'),
  constraint ai_connections_revoked_shape check ((revoked_at is null) = (revoke_reason is null)),
  -- Re-consent every 90 days (D8): no grant outlives that, whatever the app asks.
  constraint ai_connections_lifetime check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);

comment on table vppsone.ai_connections is
  'AI connection grants: one staff member, one client, at most 90 days. Revoked rows are kept as evidence.';

create index ai_connections_staff on vppsone.ai_connections (staff_profile_id, created_at desc);
create index ai_connections_client on vppsone.ai_connections (client_id);

create table vppsone.ai_oauth_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  connection_id uuid not null references vppsone.ai_connections (id) on delete cascade,
  client_id text not null,
  redirect_uri text not null check (char_length(redirect_uri) <= 512),
  -- S256 only: base64url of a SHA-256, 43 characters.
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  resource text not null check (char_length(resource) <= 512),
  scopes text[] not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint ai_oauth_codes_short check (expires_at <= created_at + interval '5 minutes')
);

create index ai_oauth_codes_connection on vppsone.ai_oauth_codes (connection_id);
create index ai_oauth_codes_expires on vppsone.ai_oauth_codes (expires_at);

create table vppsone.ai_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('access', 'refresh')),
  connection_id uuid not null references vppsone.ai_connections (id) on delete cascade,
  resource text not null check (char_length(resource) <= 512),
  scopes text[] not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Refresh only: set once, when the token is rotated. A second presentation
  -- of a used refresh token is replay.
  used_at timestamptz,
  replaced_by uuid references vppsone.ai_tokens (id) on delete set null,
  revoked_at timestamptz,
  constraint ai_tokens_rotation_refresh_only check (kind = 'refresh' or (used_at is null and replaced_by is null))
);

create index ai_tokens_connection on vppsone.ai_tokens (connection_id);
create index ai_tokens_expires on vppsone.ai_tokens (expires_at);

create table vppsone.ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  staff_profile_id uuid references vppsone.staff_profiles (id) on delete set null,
  connection_id uuid references vppsone.ai_connections (id) on delete set null,
  provider text not null check (provider in ('claude', 'chatgpt', 'local')),
  -- A registry name, or 'unknown' for a name the registry does not have —
  -- never the text a client sent.
  tool text not null check (tool ~ '^[a-z][a-z0-9_]{1,40}$'),
  outcome text not null check (outcome ~ '^(ok|refused:[a-z_]{2,40}|error:[a-z_]{2,40})$'),
  row_count integer check (row_count is null or row_count >= 0),
  duration_ms integer not null check (duration_ms >= 0)
);

comment on table vppsone.ai_tool_calls is
  'One row per AI connection tool call: who, which connection and provider, which tool, outcome, row count, duration. Never arguments, names or free text. 180 days.';

create index ai_tool_calls_staff_created on vppsone.ai_tool_calls (staff_profile_id, created_at desc);
create index ai_tool_calls_connection_created on vppsone.ai_tool_calls (connection_id, created_at desc);
create index ai_tool_calls_created on vppsone.ai_tool_calls (created_at);

alter table vppsone.ai_oauth_clients enable row level security;
alter table vppsone.ai_connections enable row level security;
alter table vppsone.ai_oauth_codes enable row level security;
alter table vppsone.ai_tokens enable row level security;
alter table vppsone.ai_tool_calls enable row level security;

revoke all on vppsone.ai_oauth_clients, vppsone.ai_connections, vppsone.ai_oauth_codes,
  vppsone.ai_tokens, vppsone.ai_tool_calls from public, anon, authenticated;
grant all on vppsone.ai_oauth_clients, vppsone.ai_connections, vppsone.ai_oauth_codes,
  vppsone.ai_tokens, vppsone.ai_tool_calls to service_role;

/* ------------------------------------------------------------ functions */

-- Register a public client. The count and the insert happen under one lock,
-- so the hourly cap holds however many registrations arrive at once.
create function vppsone.ai_register_client(
  p_client_id text,
  p_client_name text,
  p_redirect_uris text[],
  p_max_per_hour integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_recent integer;
begin
  perform pg_advisory_xact_lock(hashtext('vppsone:ai-register'));
  select count(*) into v_recent
  from vppsone.ai_oauth_clients
  where created_at > now() - interval '1 hour';
  if v_recent >= p_max_per_hour then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  insert into vppsone.ai_oauth_clients (client_id, client_name, redirect_uris)
  values (p_client_id, nullif(btrim(p_client_name), ''), p_redirect_uris);
  return jsonb_build_object('ok', true);
end;
$$;

-- End a connection and every token issued from it. Idempotent: the tokens
-- are revoked even when the connection already was.
create function vppsone.ai_revoke_connection(
  p_connection_id uuid,
  p_reason text,
  p_by uuid default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_done boolean;
begin
  update vppsone.ai_connections
  set revoked_at = now(), revoke_reason = p_reason, revoked_by = p_by
  where id = p_connection_id and revoked_at is null;
  v_done := found;
  update vppsone.ai_tokens
  set revoked_at = now()
  where connection_id = p_connection_id and revoked_at is null;
  return v_done;
end;
$$;

-- The consent, in one transaction: the staff member's earlier live
-- connection to the same provider ends ('replaced'), the new connection is
-- created for 90 days at most, and its single-use code for 60 seconds. The
-- staff row must be active and belong to the signed-in auth user, and the
-- redirect URI must be one the client registered; eligibility (admins first,
-- D7) is checked by the app before this is called.
create function vppsone.ai_create_grant(
  p_staff_profile_id uuid,
  p_auth_user_id uuid,
  p_client_id text,
  p_provider text,
  p_scopes text[],
  p_code_hash text,
  p_redirect_uri text,
  p_code_challenge text,
  p_resource text,
  p_code_ttl_seconds integer,
  p_grant_days integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_staff vppsone.staff_profiles%rowtype;
  v_client vppsone.ai_oauth_clients%rowtype;
  v_conn uuid;
begin
  if p_code_ttl_seconds not between 1 and 300 or p_grant_days not between 1 and 90 then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  select * into v_staff from vppsone.staff_profiles where id = p_staff_profile_id;
  if not found or not v_staff.is_active or v_staff.user_id is distinct from p_auth_user_id then
    return jsonb_build_object('ok', false, 'reason', 'staff');
  end if;

  select * into v_client from vppsone.ai_oauth_clients where client_id = p_client_id;
  if not found or not (p_redirect_uri = any (v_client.redirect_uris)) then
    return jsonb_build_object('ok', false, 'reason', 'client');
  end if;

  perform vppsone.ai_revoke_connection(c.id, 'replaced', p_staff_profile_id)
  from vppsone.ai_connections c
  where c.staff_profile_id = p_staff_profile_id and c.provider = p_provider and c.revoked_at is null;

  insert into vppsone.ai_connections (staff_profile_id, auth_user_id, client_id, provider, scopes, expires_at)
  values (p_staff_profile_id, p_auth_user_id, p_client_id, p_provider, p_scopes, now() + make_interval(days => p_grant_days))
  returning id into v_conn;

  insert into vppsone.ai_oauth_codes (code_hash, connection_id, client_id, redirect_uri, code_challenge, resource, scopes, expires_at)
  values (p_code_hash, v_conn, p_client_id, p_redirect_uri, p_code_challenge, p_resource, p_scopes,
          now() + make_interval(secs => p_code_ttl_seconds));

  return jsonb_build_object('ok', true, 'connection_id', v_conn);
end;
$$;

-- Redeem a code for the first access and refresh tokens. The row is locked,
-- so a concurrent second redemption waits and then finds it used: that is
-- reuse, and the connection with every token from it is revoked. A code
-- presented with the wrong client, redirect URI, PKCE verifier or resource is
-- consumed and its connection revoked; an expired one is consumed and its
-- connection, which never had a token, ended.
create function vppsone.ai_exchange_code(
  p_code_hash text,
  p_verifier_challenge text,
  p_client_id text,
  p_redirect_uri text,
  p_resource text,
  p_access_hash text,
  p_refresh_hash text,
  p_access_ttl_seconds integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_code vppsone.ai_oauth_codes%rowtype;
  v_conn vppsone.ai_connections%rowtype;
  v_access_expires timestamptz;
begin
  select * into v_code from vppsone.ai_oauth_codes where code_hash = p_code_hash for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_code.used_at is not null then
    perform vppsone.ai_revoke_connection(v_code.connection_id, 'code_reuse', null);
    return jsonb_build_object('status', 'replayed');
  end if;

  update vppsone.ai_oauth_codes set used_at = now() where code_hash = p_code_hash;

  if v_code.expires_at <= now() then
    perform vppsone.ai_revoke_connection(v_code.connection_id, 'code_expired', null);
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_code.client_id is distinct from p_client_id
     or v_code.redirect_uri is distinct from p_redirect_uri
     or v_code.code_challenge is distinct from p_verifier_challenge
     or v_code.resource is distinct from p_resource then
    perform vppsone.ai_revoke_connection(v_code.connection_id, 'code_mismatch', null);
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_conn from vppsone.ai_connections where id = v_code.connection_id;
  if v_conn.revoked_at is not null or v_conn.expires_at <= now() then
    return jsonb_build_object('status', 'invalid');
  end if;

  v_access_expires := least(now() + make_interval(secs => p_access_ttl_seconds), v_conn.expires_at);
  insert into vppsone.ai_tokens (token_hash, kind, connection_id, resource, scopes, expires_at)
  values
    (p_access_hash, 'access', v_conn.id, v_code.resource, v_code.scopes, v_access_expires),
    (p_refresh_hash, 'refresh', v_conn.id, v_code.resource, v_code.scopes, v_conn.expires_at);

  return jsonb_build_object(
    'status', 'ok',
    'connection_id', v_conn.id,
    'scopes', to_jsonb(v_code.scopes),
    'access_expires_at', v_access_expires,
    'refresh_expires_at', v_conn.expires_at
  );
end;
$$;

-- Rotate a refresh token: the presented one is marked used and a new pair
-- issued, the refresh never past the connection's expiry. A used refresh
-- token presented again is replay: the connection and every token from it is
-- revoked. The same row lock as codes makes two concurrent rotations one
-- rotation and one replay.
create function vppsone.ai_rotate_refresh(
  p_refresh_hash text,
  p_client_id text,
  p_resource text,
  p_new_access_hash text,
  p_new_refresh_hash text,
  p_access_ttl_seconds integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_old vppsone.ai_tokens%rowtype;
  v_conn vppsone.ai_connections%rowtype;
  v_new uuid;
  v_access_expires timestamptz;
begin
  select * into v_old from vppsone.ai_tokens
  where token_hash = p_refresh_hash and kind = 'refresh'
  for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_conn from vppsone.ai_connections where id = v_old.connection_id;
  if v_conn.client_id is distinct from p_client_id then
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_old.used_at is not null then
    perform vppsone.ai_revoke_connection(v_old.connection_id, 'refresh_reuse', null);
    return jsonb_build_object('status', 'replayed');
  end if;

  if v_old.revoked_at is not null or v_old.expires_at <= now()
     or v_conn.revoked_at is not null or v_conn.expires_at <= now()
     or v_old.resource is distinct from p_resource then
    return jsonb_build_object('status', 'invalid');
  end if;

  v_access_expires := least(now() + make_interval(secs => p_access_ttl_seconds), v_conn.expires_at);

  insert into vppsone.ai_tokens (token_hash, kind, connection_id, resource, scopes, expires_at)
  values (p_new_refresh_hash, 'refresh', v_conn.id, v_old.resource, v_old.scopes, v_conn.expires_at)
  returning id into v_new;

  insert into vppsone.ai_tokens (token_hash, kind, connection_id, resource, scopes, expires_at)
  values (p_new_access_hash, 'access', v_conn.id, v_old.resource, v_old.scopes, v_access_expires);

  update vppsone.ai_tokens set used_at = now(), replaced_by = v_new where id = v_old.id;

  return jsonb_build_object(
    'status', 'ok',
    'connection_id', v_conn.id,
    'scopes', to_jsonb(v_old.scopes),
    'access_expires_at', v_access_expires,
    'refresh_expires_at', v_conn.expires_at
  );
end;
$$;

-- Step 1 and 2 of every call (§5.3): the token by its hash, with its
-- connection. Null when no such token. The app decides kind, expiry,
-- audience and revocation from the row, on every call.
create function vppsone.ai_resolve_access(p_token_hash text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', t.kind,
    'resource', t.resource,
    'scopes', to_jsonb(t.scopes),
    'expires_at', t.expires_at,
    'revoked_at', t.revoked_at,
    'connection', jsonb_build_object(
      'id', c.id,
      'staff_profile_id', c.staff_profile_id,
      'auth_user_id', c.auth_user_id,
      'client_id', c.client_id,
      'provider', c.provider,
      'scopes', to_jsonb(c.scopes),
      'expires_at', c.expires_at,
      'revoked_at', c.revoked_at
    )
  )
  from vppsone.ai_tokens t
  join vppsone.ai_connections c on c.id = t.connection_id
  where t.token_hash = p_token_hash
$$;

-- RFC 7009. Only the client the token was issued to can revoke it; anything
-- else is answered the same way and changes nothing. A refresh token ends the
-- whole grant; an access token only itself.
create function vppsone.ai_revoke_token(p_token_hash text, p_client_id text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_token vppsone.ai_tokens%rowtype;
  v_client text;
begin
  select * into v_token from vppsone.ai_tokens where token_hash = p_token_hash;
  if not found then
    return;
  end if;
  select client_id into v_client from vppsone.ai_connections where id = v_token.connection_id;
  if v_client is distinct from p_client_id then
    return;
  end if;
  if v_token.kind = 'refresh' then
    perform vppsone.ai_revoke_connection(v_token.connection_id, 'revoked_by_client', null);
  else
    update vppsone.ai_tokens set revoked_at = coalesce(revoked_at, now()) where id = v_token.id;
  end if;
end;
$$;

-- Every live connection of one staff member: Disconnect on their card, an
-- admin disabling them, or the call pipeline finding them inactive.
create function vppsone.ai_revoke_staff_connections(
  p_staff_profile_id uuid,
  p_reason text,
  p_by uuid default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in
    select id from vppsone.ai_connections
    where staff_profile_id = p_staff_profile_id and revoked_at is null
  loop
    if vppsone.ai_revoke_connection(v_id, p_reason, p_by) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Per-staff limits (§5.5): calls in the last hour and the last 24 hours,
-- counted from the log. A call already refused for the limit does not count
-- again, so a client that keeps knocking is not locked out for longer.
create function vppsone.ai_call_counts(p_staff_profile_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'hour', count(*) filter (where created_at > now() - interval '1 hour'),
    'day', count(*)
  )
  from vppsone.ai_tool_calls
  where staff_profile_id = p_staff_profile_id
    and created_at > now() - interval '24 hours'
    and outcome <> 'refused:rate_limited'
$$;

-- Step 4 of every call: the staff profile for a verified auth user, and its
-- role's permissions as the matrix holds them now — the service-role twin of
-- what `readCurrentStaff` reads with the cookie (`my_permissions()` keys on
-- auth.uid(), which a token-authenticated call does not have).
create function vppsone.ai_staff_for_user(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'display_name', s.display_name,
    'short_name', s.short_name,
    'role', s.role,
    'is_teaching', s.is_teaching,
    'is_active', s.is_active,
    'preferred_language', s.preferred_language,
    'is_test_account', s.is_test_account,
    'permissions', coalesce(
      (select jsonb_agg(rp.permission order by rp.permission)
       from vppsone.role_permissions rp where rp.role = s.role),
      '[]'::jsonb
    )
  )
  from vppsone.staff_profiles s
  where s.user_id = p_user_id
$$;

-- The connections list (admin page) and one person's card. Last used and the
-- 30-day count come from the log; no argument or result is stored anywhere.
create function vppsone.ai_connection_list(p_staff_profile_id uuid default null, p_limit integer default 200)
returns table (
  id uuid,
  staff_profile_id uuid,
  staff_name text,
  provider text,
  created_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  last_used_at timestamptz,
  calls_30d integer
)
language sql
stable
set search_path = ''
as $$
  select
    c.id,
    c.staff_profile_id,
    s.display_name,
    c.provider,
    c.created_at,
    c.expires_at,
    c.revoked_at,
    c.revoke_reason,
    (select max(l.created_at) from vppsone.ai_tool_calls l where l.connection_id = c.id),
    (select count(*)::integer from vppsone.ai_tool_calls l
      where l.connection_id = c.id and l.created_at > now() - interval '30 days')
  from vppsone.ai_connections c
  join vppsone.staff_profiles s on s.id = c.staff_profile_id
  where p_staff_profile_id is null or c.staff_profile_id = p_staff_profile_id
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

-- The scheduled clean-up (job `ai-connection-purge`): call rows older than
-- the retention (180 days, D8); codes a day past expiry; tokens a day past
-- expiry or revocation (a used refresh token lives until its connection
-- expires, so replay is still recognised while the grant could be used);
-- connections ended longer ago than the retention; and registered clients
-- nobody connected with within a day.
create function vppsone.ai_purge(p_keep_days integer default 180)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_calls integer;
  v_codes integer;
  v_tokens integer;
  v_connections integer;
  v_clients integer;
begin
  if p_keep_days is null or p_keep_days < 30 then
    raise exception 'ai_purge keeps at least 30 days';
  end if;

  delete from vppsone.ai_tool_calls where created_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_calls = row_count;

  delete from vppsone.ai_oauth_codes where expires_at < now() - interval '1 day';
  get diagnostics v_codes = row_count;

  delete from vppsone.ai_tokens
  where expires_at < now() - interval '1 day'
     or (revoked_at is not null and revoked_at < now() - interval '1 day');
  get diagnostics v_tokens = row_count;

  delete from vppsone.ai_connections
  where coalesce(revoked_at, expires_at) < now() - make_interval(days => p_keep_days);
  get diagnostics v_connections = row_count;

  delete from vppsone.ai_oauth_clients c
  where c.created_at < now() - interval '1 day'
    and not exists (select 1 from vppsone.ai_connections x where x.client_id = c.client_id);
  get diagnostics v_clients = row_count;

  return jsonb_build_object(
    'calls', v_calls,
    'codes', v_codes,
    'tokens', v_tokens,
    'connections', v_connections,
    'clients', v_clients
  );
end;
$$;

revoke all on function vppsone.ai_register_client(text, text, text[], integer) from public, anon, authenticated;
revoke all on function vppsone.ai_revoke_connection(uuid, text, uuid) from public, anon, authenticated;
revoke all on function vppsone.ai_create_grant(uuid, uuid, text, text, text[], text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function vppsone.ai_exchange_code(text, text, text, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function vppsone.ai_rotate_refresh(text, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function vppsone.ai_resolve_access(text) from public, anon, authenticated;
revoke all on function vppsone.ai_revoke_token(text, text) from public, anon, authenticated;
revoke all on function vppsone.ai_revoke_staff_connections(uuid, text, uuid) from public, anon, authenticated;
revoke all on function vppsone.ai_call_counts(uuid) from public, anon, authenticated;
revoke all on function vppsone.ai_staff_for_user(uuid) from public, anon, authenticated;
revoke all on function vppsone.ai_connection_list(uuid, integer) from public, anon, authenticated;
revoke all on function vppsone.ai_purge(integer) from public, anon, authenticated;

grant execute on function vppsone.ai_register_client(text, text, text[], integer) to service_role;
grant execute on function vppsone.ai_revoke_connection(uuid, text, uuid) to service_role;
grant execute on function vppsone.ai_create_grant(uuid, uuid, text, text, text[], text, text, text, text, integer, integer) to service_role;
grant execute on function vppsone.ai_exchange_code(text, text, text, text, text, text, text, integer) to service_role;
grant execute on function vppsone.ai_rotate_refresh(text, text, text, text, text, integer) to service_role;
grant execute on function vppsone.ai_resolve_access(text) to service_role;
grant execute on function vppsone.ai_revoke_token(text, text) to service_role;
grant execute on function vppsone.ai_revoke_staff_connections(uuid, text, uuid) to service_role;
grant execute on function vppsone.ai_call_counts(uuid) to service_role;
grant execute on function vppsone.ai_staff_for_user(uuid) to service_role;
grant execute on function vppsone.ai_connection_list(uuid, integer) to service_role;
grant execute on function vppsone.ai_purge(integer) to service_role;
