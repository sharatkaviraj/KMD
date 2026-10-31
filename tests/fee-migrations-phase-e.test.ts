import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The three go-live Phase E fee-migrations, as files (applied to
 * wtgxcptmucjerhufzjcf on 31 Oct 2026, ledger 20261031064009 / 064037 /
 * 064046). What the database does with them is proven in
 * scripts/migrate/verify-online-vp1-and-floor.sql (rolled back); this pins
 * the parts a later edit could quietly lose — above all the grants (the Phase
 * B lesson: a missing grant sent every signed-in page to /login).
 */

const read = (name: string) =>
  readFileSync(path.resolve(__dirname, "..", "supabase", "fee-migrations", name), "utf8").replace(/\r\n/g, "\n");

const vp1 = read("20261031120000_online_vp1_ownership.sql");
const floor = read("20261031120100_receipt_suffix_floor.sql");
const switches = read("20261031120200_online_switches_default_off.sql");

describe("each file says why it differs from the fees app", () => {
  it.each([
    ["vp1", vp1],
    ["floor", floor],
    ["switches", switches],
  ])("%s", (_name, source) => {
    expect(source.startsWith("-- ============================================================================\n-- VPPS One fee-migration (One-only)")).toBe(true);
    expect(source).toContain("Why this differs from the fees app");
  });
});

describe("vp1_ ownership", () => {
  it("mints vp1_ and vp1_o_, inside Razorpay's 40 characters", () => {
    expect(vp1).toContain("'''vp1_'' /* [vppsone:vp1-ownership] */ || replace(v_id::text'");
    expect(vp1).toContain("'''vp1_o_'' /* [vppsone:vp1-ownership] */ || replace(gen_random_uuid()::text'");
    expect("vp1_".length + 32).toBeLessThanOrEqual(40);
    expect("vp1_o_".length + 32).toBeLessThanOrEqual(40);
  });

  it("refuses vpps_ in all four record/apply functions", () => {
    for (const fn of [
      "public.online_payment_record_capture(jsonb)",
      "public.online_payment_record_order_capture(jsonb)",
      "public.online_payment_apply_capture(uuid,text)",
      "public.online_payment_apply_order_capture(uuid,text)",
    ]) {
      expect(vp1).toContain(`('${fn}',`);
    }
    expect(vp1.match(/'(?:reason|status)', 'not_ours'\)/g)).toHaveLength(4);
  });

  it("keeps the rewrite helpers away from every API role", () => {
    expect(vp1).toContain(
      "revoke all on function vppsone.replace_in_fee_function(regprocedure, text, text, text) from public, anon, authenticated, service_role;",
    );
    expect(vp1).toContain(
      "revoke all on function vppsone.undo_replace_in_fee_function(regprocedure, text, text) from public, anon, authenticated, service_role;",
    );
  });
});

describe("the receipt suffix floor", () => {
  it("floors all three numbering functions", () => {
    expect(floor.match(/greatest\(coalesce\(/g)).toHaveLength(3);
    expect(floor.match(/vppsone\.receipt_suffix_floor\(\)\) \/\* \[vppsone:receipt-suffix-floor\] \*\//g)).toHaveLength(3);
  });

  it("keeps the next number four digits, and refuses a value it cannot read", () => {
    expect(floor).toContain("v_raw !~ '^[0-9]{1,4}$' or v_raw::integer > 9998");
    expect(floor).toContain("errcode = 'VPP02'");
    // The day's highest is still read by the fees app's four-digit pattern,
    // which reads 5001 like any other suffix.
    expect(/-([0-9]{4})$/.exec("SVP20261213-5001")?.[1]).toBe("5001");
  });

  it("is callable by the roles that post money, and not by anon", () => {
    for (const fn of ["vppsone.receipt_suffix_floor()", "vppsone.online_receipt_prefix(uuid)"]) {
      expect(floor).toContain(`revoke all on function ${fn} from public, anon;`);
      expect(floor).toContain(`grant execute on function ${fn} to authenticated, service_role;`);
    }
  });

  it("posts online receipts with the session's own prefix, not a hard-coded SVP", () => {
    expect(floor).toContain("vppsone.online_receipt_prefix(v_intent.student_id) /* [vppsone:online-receipt-prefix] */");
    expect(floor).toContain("vppsone.online_receipt_prefix(v_line.student_id) /* [vppsone:online-receipt-prefix] */");
    expect(floor).toContain("join public.fee_policy_configs f on f.academic_session_label = c.session_label");
  });
});

describe("the switches start off", () => {
  it("writes all seven (and the staff-alert switch) 'false', and registers them One-owned", () => {
    for (const key of [
      "online_payment_links_enabled",
      "online_payment_checkout_enabled",
      "online_payment_auto_posting_enabled",
      "online_payment_receipts_enabled",
      "online_payment_checkout_all_sessions",
      "online_payment_checkout_modal_enabled",
      "online_payment_waive_late_fees",
      "online_payment_staff_whatsapp_enabled",
    ]) {
      expect(switches.match(new RegExp(`\\('${key}'\\)`, "g"))).toHaveLength(2);
    }
    expect(switches).toContain("on conflict (key) do update set value = 'false'");
    expect(switches).toContain("insert into vppsone.one_owned_fee_settings");
  });
});
