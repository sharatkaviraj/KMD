"""Two-connection proof of the AI connection's single-use guarantees on PG17.

The real migration (supabase/migrations/20261104022925_ai_connection_mcp.sql)
over the synthetic fixture. Each schedule is forced by an observed lock wait,
never by assuming a thread ran first:

  1. two redemptions of one code: exactly one is issued tokens, the other is
     reuse and revokes the connection and every token from it;
  2. two rotations of one refresh token: one rotation, one replay that
     revokes the grant;
  3. two approvals redeemed at once (the advisory lock per staff member and
     provider): exactly one connection is left live.

The endpoint is deliberately fixed: no URL argument, environment override,
hosted database, or pre-existing application schema is accepted.
"""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
from secrets import token_bytes, token_urlsafe
from time import monotonic, sleep

import psycopg

ROOT = Path(__file__).resolve().parents[2]
URL = "postgresql://postgres:disposable-ci-only@127.0.0.1:5432/ai_connection_ci"
RESOURCE = "https://one.vpps.co.in/api/mcp"
CALLBACK = "https://claude.ai/api/mcp/auth_callback"
CLIENT = "client-aaaaaaaaaaaaaaaaaaaaaa"


def connect():
    db = psycopg.connect(URL, hostaddr="127.0.0.1", sslmode="disable",
                         gssencmode="disable", autocommit=True, connect_timeout=5)
    assert db.info.dbname == "ai_connection_ci"
    assert 170000 <= db.info.server_version < 180000, "Requires disposable PostgreSQL 17"
    db.execute("SET statement_timeout = '15s'")
    db.execute("SET deadlock_timeout = '100ms'")
    return db


def scalar(db, sql, params=()):
    return db.execute(sql, params).fetchone()[0]


def ident(n):
    return f"30000000-0000-4000-8000-{n:012}"


def hexhash():
    return sha256(token_bytes(32)).hexdigest()


def challenge():
    return token_urlsafe(32)[:43]


ADMIN, ADMIN_USER = ident(1), ident(2)


def grant(db):
    code, chall = hexhash(), challenge()
    created = scalar(db, "SELECT vppsone.ai_create_grant(%s,%s,%s,'claude',array['one.read'],%s,%s,%s,%s,60,90)",
                     (ADMIN, ADMIN_USER, CLIENT, code, CALLBACK, chall, RESOURCE))
    assert created["ok"] is True, created
    return {"code": code, "challenge": chall, "connection": created["connection_id"]}


def exchange(db, g, access=None, refresh=None):
    return scalar(db, "SELECT vppsone.ai_exchange_code(%s,%s,%s,%s,%s,%s,%s,900)",
                  (g["code"], g["challenge"], CLIENT, CALLBACK, RESOURCE, access or hexhash(), refresh or hexhash()))


def rotate(db, presented):
    return scalar(db, "SELECT vppsone.ai_rotate_refresh(%s,%s,%s,%s,%s,900)",
                  (presented, CLIENT, RESOURCE, hexhash(), hexhash()))


def wait_until_blocked(observer, waiter, future):
    """Synchronize by an observed lock wait of `waiter` on `observer`."""
    deadline = monotonic() + 10
    while monotonic() < deadline:
        if future.done():
            future.result()
            raise AssertionError("The second call returned without waiting for the first")
        if scalar(observer, "SELECT %s = ANY(pg_blocking_pids(%s))",
                  (observer.info.backend_pid, waiter.info.backend_pid)):
            return
        sleep(0.01)
    raise AssertionError("Did not observe the expected lock wait within 10s")


def revoke_reason(db, connection):
    return scalar(db, "SELECT revoke_reason FROM vppsone.ai_connections WHERE id=%s", (connection,))


with connect() as a, connect() as b:
    # The database must be pristine. Never drop or overwrite an existing schema.
    assert scalar(a, "SELECT to_regnamespace('vppsone')") is None
    a.execute((ROOT / "tests/sql/ai-connection-fixture.sql").read_text(encoding="utf-8"))
    a.execute((ROOT / "supabase/migrations/20261104022925_ai_connection_mcp.sql").read_text(encoding="utf-8"))
    a.execute("INSERT INTO auth.users VALUES (%s)", (ADMIN_USER,))
    a.execute("INSERT INTO vppsone.staff_profiles(id,user_id,display_name,short_name,role) VALUES (%s,%s,'Synthetic Admin','SA','admin')",
              (ADMIN, ADMIN_USER))
    registered = scalar(a, "SELECT vppsone.ai_register_client(%s,'Claude',array[%s],%s,'production',5,100,0)",
                        (CLIENT, CALLBACK, hexhash()))
    assert registered["ok"] is True, registered
    for db in (a, b):
        db.execute("SET ROLE service_role")

    with ThreadPoolExecutor(max_workers=1) as pool:
        # 1. One code, two redemptions. A redeems inside an open transaction
        #    and so holds the code row; B's redemption must wait for it.
        g = grant(a)
        a.execute("BEGIN")
        try:
            first = exchange(a, g)
            assert first["status"] == "ok", first
            second = pool.submit(exchange, b, g)
            wait_until_blocked(a, b, second)
            a.execute("COMMIT")
        finally:
            a.execute("ROLLBACK")
        assert second.result(timeout=20)["status"] == "replayed"
        assert revoke_reason(a, g["connection"]) == "code_reuse"
        assert scalar(a, "SELECT count(*) FROM vppsone.ai_tokens WHERE connection_id=%s", (g["connection"],)) == 2
        assert scalar(a, "SELECT count(*) FROM vppsone.ai_tokens WHERE connection_id=%s AND revoked_at IS NULL", (g["connection"],)) == 0
        print("PASS: two redemptions of one code: one pair issued, the second waits, is reuse, and revokes the grant")

        # 2. One refresh token, two rotations.
        g = grant(a)
        refresh = hexhash()
        assert exchange(a, g, refresh=refresh)["status"] == "ok"
        a.execute("BEGIN")
        try:
            assert rotate(a, refresh)["status"] == "ok"
            second = pool.submit(rotate, b, refresh)
            wait_until_blocked(a, b, second)
            a.execute("COMMIT")
        finally:
            a.execute("ROLLBACK")
        assert second.result(timeout=20)["status"] == "replayed"
        assert revoke_reason(a, g["connection"]) == "refresh_reuse"
        assert scalar(a, "SELECT count(*) FROM vppsone.ai_tokens WHERE connection_id=%s AND revoked_at IS NULL", (g["connection"],)) == 0
        print("PASS: two rotations of one refresh token: one rotation, the second waits, is replay, and revokes the grant")

        # 3. Two approvals, redeemed at once: the advisory lock per staff member
        #    and provider makes the second wait, then re-read its connection.
        first_grant, second_grant = grant(a), grant(a)
        a.execute("BEGIN")
        try:
            assert exchange(a, first_grant)["status"] == "ok"
            second = pool.submit(exchange, b, second_grant)
            wait_until_blocked(a, b, second)
            a.execute("COMMIT")
        finally:
            a.execute("ROLLBACK")
        second.result(timeout=20)
        live = scalar(a, """SELECT count(*) FROM vppsone.ai_connections
          WHERE staff_profile_id=%s AND provider='claude' AND activated_at IS NOT NULL AND revoked_at IS NULL""", (ADMIN,))
        assert live == 1, live
        print("PASS: two approvals redeemed at once leave exactly one live connection")

print("PostgreSQL 17: real AI-connection migration, two connections, observed row/advisory lock schedules passed.")
