import { describe, expect, it } from "vitest";

import { isMissingColumn } from "@/platform/supabase/missing-column";

describe("isMissingColumn", () => {
  it("recognises PostgREST's write error and Postgres's read error for that column only", () => {
    expect(isMissingColumn({ code: "PGRST204", message: "Could not find the 'pay_scope' column" }, "pay_scope")).toBe(true);
    expect(isMissingColumn({ code: "42703", message: "column whatsapp_reminder_sends.pay_scope does not exist" }, "pay_scope")).toBe(true);
  });

  it("never swallows another error", () => {
    expect(isMissingColumn({ code: "42703", message: "column other does not exist" }, "pay_scope")).toBe(false);
    expect(isMissingColumn({ code: "23505", message: "duplicate key pay_scope" }, "pay_scope")).toBe(false);
    expect(isMissingColumn(null, "pay_scope")).toBe(false);
  });
});
