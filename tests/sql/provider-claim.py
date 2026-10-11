"""Disposable PostgreSQL concurrency proof. Never accepts a hosted endpoint."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import os
from urllib.parse import urlparse
import psycopg

url = os.environ["CLAIM_TEST_DATABASE_URL"]
parsed = urlparse(url)
assert parsed.hostname in ("127.0.0.1", "localhost") and parsed.path == "/provider_claim_ci"

def connect():
    return psycopg.connect(url, autocommit=True)

# Same conditional UPDATE as messages-repo.ts, with synthetic snapshots only.
claim_sql = """UPDATE claim_ci.message_sends
 SET status='failed', provider_message_id=%s, error='Provider result unknown'
 WHERE id=1 AND status IN ('draft','queued','failed') AND provider_message_id IS NULL
 AND template_id='qa-template' AND to_phone='qa-phone'
 AND rendered_hi='qa-hi' AND rendered_en='qa-en'
 AND updated_at='2026-10-11T00:00:00Z'
 RETURNING id"""
with connect() as db:
    db.execute("CREATE SCHEMA claim_ci")
    db.execute("""CREATE TABLE claim_ci.message_sends (
      id integer PRIMARY KEY, status text NOT NULL, provider_message_id text, error text,
      template_id text, to_phone text, rendered_hi text, rendered_en text, updated_at timestamptz,
      sent_at timestamptz,
      CHECK ((status='sent') = (sent_at IS NOT NULL)))""")
    db.execute("""INSERT INTO claim_ci.message_sends VALUES
      (1,'queued',NULL,NULL,'qa-template','qa-phone','qa-hi','qa-en','2026-10-11T00:00:00Z',NULL)""")

barrier = Barrier(24)
def claim(i):
    with connect() as db:
        barrier.wait(timeout=30)
        return i, db.execute(claim_sql, (f"attempt:qa-{i}",)).fetchall()
with ThreadPoolExecutor(max_workers=24) as pool:
    results = list(pool.map(claim, range(24)))
winners = [i for i, rows in results if rows]
assert len(winners) == 1, results
attempt = f"attempt:qa-{winners[0]}"
with connect() as db:
    # A worker crash/lost response after claim cannot regain transport authority.
    assert db.execute("SELECT provider_message_id FROM claim_ci.message_sends").fetchone() == (attempt,)
    assert db.execute(claim_sql, ("attempt:qa-retry",)).fetchall() == []
    # Neither manual confirmation nor cancellation can overwrite an unknown send.
    for status in ("sent", "cancelled"):
        assert db.execute("""UPDATE claim_ci.message_sends SET status=%s
          WHERE id=1 AND status IN ('draft','queued') AND provider_message_id IS NULL RETURNING id""", (status,)).fetchall() == []
    # Another attempt's result cannot stamp this attempt.
    assert db.execute("""UPDATE claim_ci.message_sends SET status='sent'
      WHERE id=1 AND status='failed' AND provider_message_id='attempt:qa-wrong' RETURNING id""").fetchall() == []
    # Only explicit provider rejection releases the original claim.
    assert db.execute("""UPDATE claim_ci.message_sends SET provider_message_id=NULL,
      error='Provider rejected this request: QA refusal'
      WHERE id=1 AND status='failed' AND provider_message_id=%s RETURNING id""", (attempt,)).fetchall() == [(1,)]
    assert db.execute(claim_sql, ("attempt:qa-after-rejection",)).fetchall() == [(1,)]
    # A matching accepted result becomes final; later claims remain refused.
    assert db.execute("""UPDATE claim_ci.message_sends SET status='sent', sent_at=now(), provider_message_id='mock:qa-accepted'
      WHERE id=1 AND status='failed' AND provider_message_id='attempt:qa-after-rejection' RETURNING id""").fetchall() == [(1,)]
    assert db.execute(claim_sql, ("attempt:qa-after-sent",)).fetchall() == []
print("PostgreSQL 17: one winner among 24 claims; crash, overwrite, wrong-result, rejection and accepted-result invariants passed.")
