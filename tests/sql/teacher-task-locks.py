"""Two-connection proof against the real task migration on disposable PG17.

The endpoint is deliberately fixed: no URL argument, environment override,
hosted database, or pre-existing application schema is accepted.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from time import monotonic, sleep

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[2]
URL = "postgresql://postgres:disposable-ci-only@127.0.0.1:5432/teacher_task_ci"
LOCK = "vppsone:teacher-task-create:QA"


def connect():
    # Explicit hostaddr also prevents libpq's PGHOSTADDR/service defaults from
    # redirecting the literal localhost URL. No TLS/GSS credentials are used.
    db = psycopg.connect(URL, hostaddr="127.0.0.1", sslmode="disable",
                         gssencmode="disable", autocommit=True, connect_timeout=5)
    assert db.info.dbname == "teacher_task_ci"
    assert 170000 <= db.info.server_version < 180000, "Requires disposable PostgreSQL 17"
    db.execute("SET statement_timeout = '15s'")
    db.execute("SET deadlock_timeout = '100ms'")
    return db


def scalar(db, sql, params=()):
    return db.execute(sql, params).fetchone()[0]


def ident(n):
    return f"10000000-0000-4000-8000-{n:012}"


ACTOR, TEACHER, CLASS, FIELD, CHILD = map(ident, range(1, 6))
PAYLOAD = {
    "session": "QA", "kind": "collection", "title": "Synthetic lock proof",
    "fieldIds": [FIELD], "dueDate": None,
    "groups": [{
        "teacherId": TEACHER, "label": "Synthetic class",
        "scope": {"kind": "class", "value": CLASS}, "studentIds": [CHILD],
        "members": [{"id": CHILD, "classId": CLASS, "house": None, "routeId": None}],
    }],
}


def prepare(db):
    return scalar(db, "SELECT vppsone.prepare_teacher_tasks(%s,%s)", (ACTOR, Jsonb(PAYLOAD)))


def create(db, preview):
    return scalar(db, "SELECT vppsone.create_teacher_tasks(%s,%s,%s)",
                  (ACTOR, preview["id"], preview["digest"]))


def restart(db, task_id):
    return scalar(db, "SELECT vppsone.restart_teacher_task(%s,%s)", (ACTOR, task_id))


def hold_session(db):
    db.execute("BEGIN")
    db.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (LOCK,))


def wait_for_advisory_wait(observer, waiter, future):
    """Synchronize by observed lock wait, never by assuming a thread ran first."""
    deadline = monotonic() + 10
    while monotonic() < deadline:
        if future.done():
            future.result()  # Surface any unexpected SQL exception.
            raise AssertionError("Operation returned without waiting for the session lock")
        if scalar(observer, """SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE pid=%s AND locktype='advisory' AND NOT granted
            AND %s = ANY(pg_blocking_pids(pid)))""",
                  (waiter.info.backend_pid, observer.info.backend_pid)):
            return
        sleep(0.01)
    raise AssertionError("Did not observe the expected advisory-lock wait within 10s")


def expect_refusal(future, reason):
    try:
        future.result(timeout=20)
    except psycopg.errors.RaiseException as error:
        assert error.diag.message_primary == f"tasks:{reason}", error
    else:
        raise AssertionError(f"Expected tasks:{reason}")


with connect() as a, connect() as b:
    # The database must be pristine. Never drop or overwrite an existing schema.
    assert scalar(a, "SELECT to_regnamespace('vppsone')") is None
    assert scalar(a, "SELECT to_regclass('public.students')") is None
    a.execute((ROOT / "tests/sql/teacher-tasks-fixture.sql").read_text(encoding="utf-8"))
    a.execute((ROOT / "supabase/migrations/20261016070000_teacher_tasks.sql").read_text(encoding="utf-8"))
    a.execute("""INSERT INTO vppsone.staff_profiles(id,user_id,role,is_active,display_name)
      VALUES(%s,%s,'admin',true,'Synthetic admin'),(%s,%s,'teacher',true,'Synthetic teacher')""",
              (ACTOR, ACTOR, TEACHER, TEACHER))
    a.execute("INSERT INTO vppsone.role_permissions VALUES('admin','collection:manage')")
    a.execute("""INSERT INTO vppsone.class_teachers(staff_profile_id,class_id,session_label,role,effective_from)
      VALUES(%s,%s,'QA','class_teacher','2026-01-01')""", (TEACHER, CLASS))
    a.execute("INSERT INTO vppsone.collection_fields VALUES(%s,'phone','phone',true)", (FIELD,))
    a.execute("INSERT INTO public.students VALUES(%s,'Synthetic child',null,null,'0000000000')", (CHILD,))
    a.execute("INSERT INTO vppsone.enrolments VALUES(%s,%s,'QA','enrolled','1')", (CHILD, CLASS))
    original = create(a, prepare(a))[0]
    pending = prepare(a)  # Real, unconsumed preview matching the existing source.

    with ThreadPoolExecutor(max_workers=1) as pool:
        # A owns the session lock. B runs the real restart function. Old code
        # first owns the task row, then waits for A inside nested create. A's
        # real create now needs that row: an actual PostgreSQL deadlock.
        # Fixed code makes B wait *before* owning the row, so A can finish.
        hold_session(a)
        restarting = pool.submit(restart, b, original["id"])
        try:
            wait_for_advisory_wait(a, b, restarting)
            reused = create(a, pending)[0]
            assert reused["id"] == original["id"] and reused["reused"] is True
            assert restarting.done() is False
            a.execute("COMMIT")
            fresh = restarting.result(timeout=20)
        finally:
            a.execute("ROLLBACK")
        assert fresh["id"] != original["id"]
        assert scalar(a, "SELECT count(*) FROM vppsone.teacher_tasks WHERE revoked_at IS NULL") == 1
        assert scalar(a, "SELECT vppsone.teacher_task_access(%s,%s,null)", (fresh["id"], TEACHER)) is True
        print("PASS: new-preview create completes while restart waits; restart then creates one accessible fresh round")

        # Cached receipts must join the same lock order too. After A's restart,
        # B's old receipt is revalidated and explicitly refused, never deadlocked
        # or reported as a successful assignment to a now-revoked task.
        receipt = prepare(a)
        assert create(a, receipt)[0]["id"] == fresh["id"]
        hold_session(a)
        replaying = pool.submit(create, b, receipt)
        try:
            wait_for_advisory_wait(a, b, replaying)
            latest = restart(a, fresh["id"])
            a.execute("COMMIT")
            expect_refusal(replaying, "scope_changed")
        finally:
            a.execute("ROLLBACK")
        assert latest["id"] != fresh["id"]
        assert scalar(a, "SELECT count(*) FROM vppsone.teacher_tasks WHERE revoked_at IS NULL") == 1
        print("PASS: cached replay waits before row locking and refuses the revoked receipt after restart")

        # The unlocked session lookup is not the authoritative preview read.
        # Mutate only this synthetic preview while its creator is waiting;
        # the post-lock re-read must reject the old reviewed digest.
        changed = prepare(a)
        hold_session(a)
        creating = pool.submit(create, b, changed)
        try:
            wait_for_advisory_wait(a, b, creating)
            a.execute("UPDATE vppsone.teacher_task_previews SET payload=jsonb_set(payload,'{session}','\"QA-other\"') WHERE id=%s", (changed["id"],))
            a.execute("COMMIT")
            expect_refusal(creating, "preview_changed")
        finally:
            a.execute("ROLLBACK")
        assert scalar(a, "SELECT count(*) FROM vppsone.teacher_tasks WHERE revoked_at IS NULL") == 1
        print("PASS: preview/session is re-read after acquiring the lock; changed digest cannot authorize creation")

        # Both mutation rows may block management. Observe each real row wait,
        # withdraw authority while blocked, then require no token/owner change.
        for locked_table in ("teacher_tasks", "collection_requests"):
            for loss in ("permission", "actor_active", "target_active"):
                task_id = latest["id"]
                before = a.execute("SELECT token,assigned_staff_id,request_id FROM vppsone.teacher_tasks WHERE id=%s", (task_id,)).fetchone()
                request_id = before[2]
                a.execute("BEGIN")
                lock_id = task_id if locked_table == "teacher_tasks" else request_id
                a.execute(f"SELECT id FROM vppsone.{locked_table} WHERE id=%s FOR UPDATE", (lock_id,))
                managing = pool.submit(scalar, b, "SELECT vppsone.manage_teacher_task(%s,%s,%s)", (ACTOR,task_id,TEACHER))
                try:
                    deadline = monotonic() + 10
                    while not scalar(a, "SELECT %s = ANY(pg_blocking_pids(%s))", (a.info.backend_pid,b.info.backend_pid)):
                        assert not managing.done(), "Management did not wait on the held row"
                        assert monotonic() < deadline, "Expected row wait not observed"
                        sleep(0.01)
                    if loss == "permission":
                        a.execute("DELETE FROM vppsone.role_permissions WHERE role='admin' AND permission='collection:manage'")
                    else:
                        a.execute("UPDATE vppsone.staff_profiles SET is_active=false WHERE id=%s", (TEACHER if loss == "target_active" else ACTOR,))
                    a.execute("COMMIT")
                    expect_refusal(managing, "not_owner" if loss == "target_active" else "not_permitted")
                finally:
                    a.execute("ROLLBACK")
                    a.execute("UPDATE vppsone.staff_profiles SET is_active=true WHERE id IN (%s,%s)", (ACTOR,TEACHER))
                    if loss == "permission":
                        a.execute("INSERT INTO vppsone.role_permissions VALUES('admin','collection:manage')")
                assert a.execute("SELECT token,assigned_staff_id,request_id FROM vppsone.teacher_tasks WHERE id=%s", (task_id,)).fetchone() == before
                print(f"PASS: management refuses {loss} after observed {locked_table} row wait; task unchanged")

print("PostgreSQL 17: real task migration, two connections, deterministic advisory/row lock schedules passed.")
