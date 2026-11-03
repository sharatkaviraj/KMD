import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The review fixes for staff WhatsApp (`20261031111241_staff_whatsapp_review_fixes`,
 * applied to wtgx on 31 Oct; the file is byte-for-byte the ledger's
 * statement). Checked on wtgx after applying, with has_table_privilege /
 * has_column_privilege / has_function_privilege: authenticated reads no
 * `staff_notices.payload` and no `staff_notice_attempts.params` but every
 * column it read before; the new functions and the pace table are the
 * service role's only. `scripts/verify-staff-whatsapp.sql` steps H, K–N prove
 * the behaviour against the real functions in a rolled-back transaction.
 */

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261031111241_staff_whatsapp_review_fixes.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const statements = sql.replace(/--[^\n]*/g, "");

const NOTICE_COLUMNS = [
  "id", "notice_key", "kind", "duty_id", "duty_revision", "staff_profile_id", "session_label", "day", "period",
  "status", "status_reason", "not_after", "command_id", "created_at", "updated_at", "attempts", "next_attempt_at",
  "reconciled_by", "reconciled_at", "class_id", "class_label", "requested_by", "digest_into",
];
const ATTEMPT_COLUMNS = [
  "id", "notice_id", "attempt_no", "state", "lease_owner", "lease_expires_at", "destination", "contact_version",
  "transport", "template_code", "language", "link", "policy_version", "provider_message_id", "provider_status",
  "error", "authorized_by", "started_at", "stamped_at", "finished_at",
];

function grantedColumns(table: string): string[] {
  const match = statements.match(new RegExp(`grant select \\(([^)]*)\\) on vppsone\\.${table} to authenticated;`));
  expect(match, table).not.toBeNull();
  return match![1].split(",").map((column) => column.trim());
}

describe("the browser's columns", () => {
  it("replaces the table-wide SELECT on the outbox with columns that leave out the payload", () => {
    expect(statements).toContain("revoke select on vppsone.staff_notices from authenticated;");
    const columns = grantedColumns("staff_notices");
    expect(columns).not.toContain("payload");
    expect(columns.sort()).toEqual([...NOTICE_COLUMNS].sort());
  });

  it("and on the attempts, columns that leave out what was sent", () => {
    expect(statements).toContain("revoke select on vppsone.staff_notice_attempts from authenticated;");
    const columns = grantedColumns("staff_notice_attempts");
    expect(columns).not.toContain("params");
    expect(columns.sort()).toEqual([...ATTEMPT_COLUMNS].sort());
  });
});

describe("no child's name in the outbox", () => {
  it("student_notice_facts writes the id and class, never the name", () => {
    const facts = statements.slice(statements.indexOf("function vppsone.student_notice_facts"), statements.indexOf("$$;", statements.indexOf("function vppsone.student_notice_facts")));
    expect(facts).toContain("'student_id', s.id");
    expect(facts).not.toContain("full_name");
  });

  it("the claim reads the name only while the switch is on, and strips it otherwise", () => {
    expect(statements).toContain("v_names boolean := vppsone.flag_enabled('staff_notice_student_names');");
    expect(statements).toContain("when v_names and n.payload ? 'student_id' then");
    expect(statements).toContain("else n.payload - 'student_name'");
    expect(statements).toContain("'payload', v_payload");
    expect(statements).not.toMatch(/'payload', n\.payload/);
  });
});

describe("confinement, the digest, the pace and the count", () => {
  it("a confined claim never touches a real session; null reads as confined", () => {
    expect(statements).toContain("p_test_only boolean default false");
    expect(statements).toContain("and (not coalesce(p_test_only, true) or vppsone.is_test_session_label(session_label))");
    expect(statements).toContain("drop function if exists vppsone.claim_staff_notice(text, integer, text, uuid);");
  });

  it("folds a burst only once the provider took the digest", () => {
    expect(statements).toContain("a.state not in ('accepted', 'unknown')");
    expect(statements).not.toMatch(/a\.state <> 'sending' or a\.lease_owner/);
  });

  it("one AiSensy second per request across every dispatcher, from one row", () => {
    expect(statements).toContain("create table if not exists vppsone.staff_send_pace");
    expect(statements).toContain("set next_at = greatest(next_at, clock_timestamp()) + v_gap");
  });

  it("counts the teacher-task link's AiSensy claims in the month, and the claim uses that count", () => {
    expect(statements).toContain("e ->> 'event' = 'claim' and e ->> 'transport' = 'aisensy'");
    expect(statements).toContain("'monthSent', vppsone.staff_whatsapp_month_sent(),");
  });
});

describe("grants", () => {
  it("the pace table is the service role's only", () => {
    expect(statements).toContain("revoke all on vppsone.staff_send_pace from public, anon, authenticated;");
    expect(statements).toContain("grant select, insert, update on vppsone.staff_send_pace to service_role;");
  });

  it.each([
    "vppsone.claim_staff_notice(text, integer, text, uuid, boolean)",
    "vppsone.student_notice_facts(uuid)",
    "vppsone.digest_staff_notices(uuid, text)",
    "vppsone.staff_whatsapp_month_sent()",
    "vppsone.reserve_staff_send_slot(integer)",
  ])("%s: service role only", (fn) => {
    expect(statements).toContain(`revoke all on function ${fn} from public, anon, authenticated;`);
    expect(statements).toContain(`grant execute on function ${fn} to service_role;`);
  });

  it("every function is security definer with an empty search path", () => {
    const functions = [...statements.matchAll(/create or replace function (vppsone\.\w+)\([\s\S]*?\nas \$\$/g)];
    expect(functions.length).toBe(5);
    for (const [body] of functions) {
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
    }
  });

  it("alters no fee table and writes no fee row", () => {
    expect(statements).not.toMatch(/alter\s+table\s+public\./i);
    expect(statements).not.toMatch(/(insert\s+into|update|delete\s+from)\s+public\./i);
  });
});
