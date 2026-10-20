"""Real PG17 authority-after-wait proof; fixed disposable loopback endpoint only."""
from concurrent.futures import ThreadPoolExecutor
from itertools import product
from pathlib import Path
from time import monotonic, sleep

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[2]
URL = "postgresql://postgres:disposable-ci-only@127.0.0.1:5432/profile_photo_ci"


def connect():
    db = psycopg.connect(URL, hostaddr="127.0.0.1", sslmode="disable",
                         gssencmode="disable", autocommit=True, connect_timeout=5)
    assert db.info.dbname == "profile_photo_ci"
    assert 170000 <= db.info.server_version < 180000, "Requires disposable PostgreSQL 17"
    db.execute("SET statement_timeout = '15s'")
    db.execute("SET deadlock_timeout = '100ms'")
    return db


def scalar(db, sql, params=()):
    return db.execute(sql, params).fetchone()[0]


def ident(n):
    return f"20000000-0000-4000-8000-{n:012}"


def save(db, actor, target, payload):
    return scalar(db, "SELECT vppsone.save_staff_photo(%s,%s,%s)",
                  (actor, target, Jsonb(payload)))


def wait_for_advisory_wait(observer, waiter, future):
    """Polling is only observation: the mutation requires a proven blocked PID."""
    deadline = monotonic() + 10
    while monotonic() < deadline:
        if future.done():
            future.result()
            raise AssertionError("Save returned before the held advisory lock")
        if scalar(observer, """SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE pid=%s AND locktype='advisory' AND NOT granted
            AND %s = ANY(pg_blocking_pids(pid)))""",
                  (waiter.info.backend_pid, observer.info.backend_pid)):
            return
        sleep(0.01)
    raise AssertionError("Expected advisory-lock wait was not observed within 10s")


with connect() as a, connect() as b:
    assert scalar(a, "SELECT to_regnamespace('vppsone')") is None, "Refusing existing schema"
    assert scalar(a, "SELECT to_regclass('public.students')") is None, "Refusing existing table"
    for filename in [
        "tests/sql/teacher-tasks-fixture.sql",
        "tests/sql/profile-photos-fixture.sql",
        "supabase/migrations/20261004121311_student_photos.sql",
        "supabase/migrations/20261016070000_teacher_tasks.sql",
        "supabase/migrations/20261016080000_profile_photos.sql",
    ]:
        a.execute((ROOT / filename).read_text(encoding="utf-8"))

    failures = []
    cases = list(product(["self-inactive", "manager-inactive", "manager-permission"],
                         ["replay", "new-save"], ["command", "staff"]))
    with ThreadPoolExecutor(max_workers=1) as pool:
        for index, (policy, operation, wait_lock) in enumerate(cases):
            actor, target, old_command, new_command = map(ident, range(100 + index * 4, 104 + index * 4))
            if policy == "self-inactive":
                target = actor
            a.execute("INSERT INTO vppsone.staff_profiles(id,user_id,role,is_active) VALUES(%s,%s,'admin',true)", (actor, actor))
            if target != actor:
                a.execute("INSERT INTO vppsone.staff_profiles(id,user_id,role,is_active) VALUES(%s,%s,'teacher',true)", (target, target))
            a.execute("DELETE FROM vppsone.role_permissions WHERE role='admin' AND permission='staff:manage'")
            a.execute("INSERT INTO vppsone.role_permissions VALUES('admin','staff:manage')")
            original = {"command_id": old_command, "storage_path": f"staff/{target}/{old_command}.jpg",
                        "content_type": "image/jpeg", "byte_size": 100, "width": 40, "height": 30,
                        "sha256": "a" * 64, "expected_current": None}
            assert save(a, actor, target, original)["ok"] is True
            command = original if operation == "replay" else {
                **original, "command_id": new_command, "storage_path": f"staff/{target}/{new_command}.jpg",
                "expected_current": old_command, "sha256": "b" * 64}
            lock = (f"vppsone:staff-photo-command:{command['command_id']}" if wait_lock == "command"
                    else f"vppsone:staff-photo:{target}")
            label = f"{policy}/{operation}/{wait_lock}-wait"
            a.execute("BEGIN")
            a.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (lock,))
            queued = pool.submit(save, b, actor, target, command)
            try:
                wait_for_advisory_wait(a, b, queued)
                if policy == "manager-permission":
                    a.execute("DELETE FROM vppsone.role_permissions WHERE role='admin' AND permission='staff:manage'")
                else:
                    a.execute("UPDATE vppsone.staff_profiles SET is_active=false WHERE id=%s", (actor,))
                a.execute("COMMIT")
                try:
                    receipt = queued.result(timeout=20)
                except psycopg.errors.RaiseException as error:
                    assert error.diag.message_primary == "photos:not_permitted", error
                else:
                    failures.append(f"{label}: unauthorized result {receipt}")
                rows = a.execute("SELECT command_id::text,replaced_at FROM vppsone.staff_photos WHERE staff_id=%s", (target,)).fetchall()
                if rows != [(old_command, None)]:
                    failures.append(f"{label}: changed photo history after authority was removed")
                if not any(failure.startswith(label + ":") for failure in failures):
                    print(f"PASS: {label}; current authority refused, original portrait/history unchanged")
            finally:
                a.execute("ROLLBACK")
    assert not failures, "\n".join(failures)
print(f"PostgreSQL 17: actual photo migration, two connections, {len(cases)} observed-lock authority schedules passed.")
