import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The migration behind staff WhatsApp (go-live Phase F,
 * `20261031101234_staff_whatsapp_consent_and_gates`, applied to wtgx on 31 Oct).
 * The grants are pinned because wtgx is production: a column the app reads
 * without a grant sends every signed-in page to /login (the Phase B lesson).
 * Checked on wtgx after applying with has_table_privilege /
 * has_column_privilege / has_function_privilege: authenticated SELECT on its
 * own prefs only, no consent column, no function; service_role all; anon none.
 */

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261031101234_staff_whatsapp_consent_and_gates.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const statements = sql.replace(/--[^\n]*/g, "");

describe("consent and the switches", () => {
  it("adds the three consent columns with a known source, opt-in and source together", () => {
    for (const column of ["whatsapp_opt_in_at timestamptz", "whatsapp_opt_in_source text", "whatsapp_opt_out_at timestamptz"]) {
      expect(statements).toContain(`add column if not exists ${column}`);
    }
    expect(statements).toContain("whatsapp_opt_in_source in ('form', 'self', 'admin_recorded')");
    expect(statements).toContain("(whatsapp_opt_in_at is null) = (whatsapp_opt_in_source is null)");
  });

  it("seeds every new switch fail-closed: new kinds off, names off, a cap of 1000", () => {
    expect(statements).toContain("('staff_whatsapp_month_cap', true, '1000'::jsonb");
    expect(statements).toContain("('staff_notice_student_names', false, null");
    expect(statements).toMatch(/"money_request": false/);
    expect(statements).toContain("on conflict (key) do nothing");
  });

  it("never seeds a phone number or a consent", () => {
    expect(statements).not.toMatch(/insert into vppsone\.message_test_recipients/i);
    expect(statements).not.toMatch(/update vppsone\.staff_profiles/i);
    expect(statements).not.toMatch(/[6-9]\d{9}/);
  });
});

describe("grants", () => {
  it("lets the browser read only its own prefs, write nothing", () => {
    expect(statements).toContain("revoke all on vppsone.staff_notice_prefs from public, anon, authenticated;");
    expect(statements).toContain("grant select on vppsone.staff_notice_prefs to authenticated;");
    expect(statements).toContain("using (staff_profile_id = (select vppsone.current_staff_profile_id()))");
    expect(statements).toContain("grant select, insert, update, delete on vppsone.staff_notice_prefs to service_role;");
    // The consent columns are read with the service role; no column grant to authenticated.
    expect(statements).not.toMatch(/grant select \([^)]*whatsapp_opt/i);
  });

  it.each([
    "vppsone.queue_staff_notice(text, text, uuid, text, jsonb, timestamptz, uuid)",
    "vppsone.queue_staff_notice_to_permission(text, text, text, text, jsonb, timestamptz, uuid, uuid)",
    "vppsone.student_notice_facts(uuid)",
    "vppsone.claim_staff_notice(text, integer, text, uuid)",
    "vppsone.release_staff_notice(uuid, text, text, text, timestamptz)",
    "vppsone.digest_staff_notices(uuid, text)",
  ])("%s: service role only", (fn) => {
    expect(statements).toContain(`revoke all on function ${fn} from public, anon, authenticated;`);
    expect(statements).toContain(`grant execute on function ${fn} to service_role;`);
  });

  it("every function is security definer with an empty search path", () => {
    const functions = [...statements.matchAll(/create or replace function (vppsone\.\w+)\([\s\S]*?\nas \$\$/g)];
    expect(functions.length).toBe(8);
    for (const [body] of functions) {
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
    }
  });
});

describe("the claim and the events", () => {
  it("never tells a test account about a real session, at queue and at claim", () => {
    expect(statements).toContain("if v_test and not vppsone.is_test_session_label(p_session) then");
    expect(statements).toContain("v_why := 'test_account_real_session';");
  });

  it("skips a held notice until its time, and numbers attempts past a hand-back", () => {
    expect(statements).toContain("(status = 'pending' and (next_attempt_at is null or next_attempt_at <= now()))");
    expect(statements).toContain("select coalesce(max(attempt_no), 0) + 1 into v_attempt_no");
  });

  it("reads every gate fact in the claim", () => {
    for (const fact of ["optInAt", "optOutAt", "isTestAccount", "isTestSession", "prefEnabled", "kindsEnabled", "sentToday", "recentSameKind", "pendingSameKind", "heldForDigest", "monthSent", "monthCap", "allowlisted"]) {
      expect(statements, fact).toContain(`'${fact}'`);
    }
  });

  it("queues money and leave notices from triggers that can never stop the request", () => {
    expect(statements).toContain("after insert or update of status on vppsone.fee_desk_requests");
    expect(statements).toContain("after insert or update of status on vppsone.teacher_leave");
    expect((statements.match(/exception when others then/g) ?? []).length).toBe(2);
    // The leave note never goes in a payload.
    expect(statements).not.toMatch(/'note', new\.note/);
  });

  it("alters no fee table and writes no fee row", () => {
    expect(statements).not.toMatch(/alter\s+table\s+public\./i);
    expect(statements).not.toMatch(/(insert\s+into|update|delete\s+from)\s+public\./i);
  });
});
