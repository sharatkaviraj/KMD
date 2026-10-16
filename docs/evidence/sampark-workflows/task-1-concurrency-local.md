# Task 1 local PostgreSQL concurrency evidence

Verified commit: `9043eae91258e44e217e2a0db77e8ee7e93536e0`.

On 16 October 2026, the controller ran the committed `tests/sql/teacher-task-locks.py` unchanged against a fresh local PostgreSQL 17.10 cluster. This supersedes the Task 1 report's earlier statement that actual two-connection execution was pending. The GitHub CI job is still required before merge.

## Isolation

- Portable runtimes reside outside the repository, within this task's workspace: `../pg-test-runtime` and `../python-test-runtime`.
- PostgreSQL package: `embedded-postgres@17.10.0-beta.17`, installed with npm scripts disabled. The package's Windows binaries reported PostgreSQL 17.10. Package reference: [embedded-postgres](https://github.com/leinelissen/embedded-postgres).
- Python: official [Python 3.12.10 Windows embeddable package](https://www.python.org/downloads/release/python-31210/); test driver `psycopg` / `psycopg-binary` 3.3.6.
- No system installation, service, user, application dependency, environment file, hosted database, school record or real capability was used or changed.
- The harness refused an occupied port and an existing cluster directory. It started PostgreSQL on `127.0.0.1` only, queried and verified the exact workspace data directory before creating `teacher_task_ci`, and used only the committed synthetic schema and migration.
- Test credentials are the fixed disposable CI fixture credentials, not school credentials.
- Both initial sandbox attempts started PostgreSQL but were unable to connect because loopback TCP returned `EACCES`. Both servers were stopped. The subsequent approved execution with loopback access succeeded.

## Command and result

From the parent task workspace:

```powershell
node run-task-locks-local.mjs
```

The workspace-only harness invoked:

```powershell
python-test-runtime/python.exe -B vppsone/tests/sql/teacher-task-locks.py
```

Observed output:

```text
Disposable PostgreSQL 17.10; verified workspace data directory; loopback only.
PASS: new-preview create completes while restart waits; restart then creates one accessible fresh round
PASS: cached replay waits before row locking and refuses the revoked receipt after restart
PASS: preview/session is re-read after acquiring the lock; changed digest cannot authorize creation
PostgreSQL 17: real task migration, two connections, deterministic advisory/row lock schedules passed.
Disposable PostgreSQL stopped; no system service installed.
```

Exit code: 0. Follow-up checks found no listener on port 5432, no test `postmaster.pid`, and no remaining temporary password file.

The runner executes the real task functions and observes `pg_locks` / `pg_blocking_pids`; it does not substitute a JavaScript lock mock. Its prerequisite schema still uses the explicitly documented canonical academic-writer doubles, so this proves the task lock schedules rather than re-proving all existing marks/attendance audit and lock rules. Browser acceptance and complete integrated checks remain Task 4.
