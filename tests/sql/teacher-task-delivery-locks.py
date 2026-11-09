"""Actual task delivery migration, observed lock waits, fixed disposable PG17 only."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from time import monotonic, sleep
import psycopg

ROOT = Path(__file__).resolve().parents[2]
URL = "postgresql://postgres:disposable-ci-only@127.0.0.1:5432/task_delivery_ci"
ACTOR = "10000000-0000-4000-8000-000000000001"
TEACHER = "10000000-0000-4000-8000-000000000002"
TASK = "10000000-0000-4000-8000-000000000006"

def connect():
    db = psycopg.connect(URL, hostaddr="127.0.0.1", sslmode="disable",
                        gssencmode="disable", autocommit=True, connect_timeout=5)
    assert db.info.dbname == "task_delivery_ci" and 170000 <= db.info.server_version < 180000
    db.execute("SET statement_timeout='15s'")
    return db

def scalar(db, sql, params=()):
    return db.execute(sql, params).fetchone()[0]

def preview(db):
    return scalar(db, "SELECT vppsone.prepare_teacher_task_delivery(%s,%s,'initial')", (ACTOR, TASK))

def queue(db, p):
    return scalar(db, "SELECT vppsone.queue_teacher_task_delivery(%s,%s,%s)", (ACTOR, p['id'], p['digest']))

def claim(db, send, attempt="attempt:synthetic-claim"):
    return scalar(db, "SELECT vppsone.claim_teacher_task_delivery(%s,%s,%s,'whatsapp',false)", (ACTOR, send, attempt))

def wait_blocked(observer, worker, future):
    deadline = monotonic() + 8
    while monotonic() < deadline:
        if future.done():
            future.result()
            raise AssertionError("Expected an observed database lock wait, but operation finished")
        if scalar(observer, "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=%s AND NOT granted AND %s=ANY(pg_blocking_pids(pid)))", (worker.info.backend_pid, observer.info.backend_pid)):
            return
        sleep(.01)
    raise AssertionError("Expected lock wait was not observed")

with connect() as a, connect() as b, ThreadPoolExecutor(max_workers=1) as pool:
    assert scalar(a, "SELECT to_regnamespace('vppsone')") is None, "Refusing an existing schema"
    assert scalar(a, "SELECT to_regclass('public.students')") is None, "Refusing an existing table"
    for file in ['tests/sql/teacher-tasks-fixture.sql','tests/sql/teacher-task-delivery-fixture.sql',
                 'supabase/migrations/20261016070000_teacher_tasks.sql',
                 'supabase/migrations/20261016090000_teacher_task_delivery.sql',
                 'supabase/migrations/20261107174655_task_delivery_queue_fix.sql',
                 'supabase/migrations/20261109062527_task_delivery_whatsapp_transport.sql',
                 'tests/sql/teacher-task-delivery-seed.sql']:
        a.execute((ROOT / file).read_text(encoding='utf-8'))
    p = preview(a)
    a.execute('BEGIN')
    first = queue(a,p)
    future = pool.submit(queue,b,p)
    wait_blocked(a,b,future)
    a.execute('COMMIT')
    assert future.result()['id'] == first['id']
    assert scalar(a,'SELECT count(*) FROM vppsone.message_sends') == 1
    print('PASS: double enqueue waited on actual task lock and reused one durable row.')

    # Staff phone mutation in progress: the final claim must wait and re-read.
    a.execute('BEGIN')
    a.execute("UPDATE vppsone.staff_profiles SET whatsapp_phone='9000000001' WHERE id=%s",(TEACHER,))
    future=pool.submit(claim,b,first['id'])
    try:
        wait_blocked(a,b,future)
    finally:
        a.execute('COMMIT')
    assert future.result()['reason']=='changed'
    print('PASS: observed staff lock wait, changed reviewed phone refused after commit.')

    # Existing task management holds the task lock and rotates its capability.
    a.execute("UPDATE vppsone.staff_profiles SET whatsapp_phone='9000000000' WHERE id=%s",(TEACHER,))
    a.execute('BEGIN')
    a.execute('SELECT id FROM vppsone.teacher_tasks WHERE id=%s FOR UPDATE',(TASK,))
    future=pool.submit(claim,b,first['id'])
    wait_blocked(a,b,future)
    a.execute("UPDATE vppsone.teacher_tasks SET token='synthetic-rotated-token' WHERE id=%s",(TASK,))
    a.execute('COMMIT')
    assert future.result()['reason']=='changed'
    print('PASS: observed task lock wait, rotated capability refused after commit.')

    # An actor losing management authority while waiting cannot dispatch.
    a.execute("UPDATE vppsone.teacher_tasks SET token='synthetic-private-token' WHERE id=%s",(TASK,))
    a.execute('BEGIN')
    a.execute('SELECT id FROM vppsone.teacher_tasks WHERE id=%s FOR UPDATE',(TASK,))
    future=pool.submit(claim,b,first['id'])
    wait_blocked(a,b,future)
    a.execute("DELETE FROM vppsone.role_permissions WHERE role='admin'")
    a.execute('COMMIT')
    try:
        future.result()
        raise AssertionError('Lost authority was accepted')
    except psycopg.errors.RaiseException as error:
        assert 'not_permitted' in str(error)
    a.execute("INSERT INTO vppsone.role_permissions VALUES('admin','collection:manage')")
    print('PASS: actor authority rechecked after observed wait.')

    # Claim committed before transport. No competing claimant or crash recovery wins.
    a.execute('BEGIN')
    assert claim(a,first['id'])['ok']
    future=pool.submit(claim,b,first['id'],'attempt:synthetic-second')
    wait_blocked(a,b,future)
    a.execute('COMMIT')
    assert future.result()['reason']=='reconcile'
    assert claim(b,first['id'])['reason']=='reconcile'
    assert scalar(a,"SELECT vppsone.teacher_task_share_link(%s,%s)",(ACTOR,TASK)) is None
    assert scalar(a,"SELECT vppsone.finish_teacher_task_delivery(%s,%s,'attempt:wrong','accepted','synthetic-receipt')",(ACTOR,first['id']))['ok'] is False
    print('PASS: one claim wins; interrupted claim/stamp/finish and copy/manual paths stay gated.')
