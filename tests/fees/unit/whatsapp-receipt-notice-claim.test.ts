import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { templateMessageBody } from "@/platform/whatsapp/payload";

// The fees app mocks these once in tests/setup.ts; One has no shared setup
// file, so each ported test carries the same three (go-live Phase D).
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache:
    <T extends (...args: unknown[]) => unknown>(callback: T) =>
    callback,
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});


const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const NOTICE = read("src/modules/whatsapp/data/receipt-notice.ts");
const PARENT_SEND = read("src/modules/whatsapp/data/parent-send.ts");
const MIGRATION = read(
  "tests/fees/fixtures/fee-migrations/20260912165421_a_second_receipt_deserves_its_own_notice.sql",
);
const PAYMENTS_ACTION = read("src/app/(app)/fees/payments/actions.ts");

/**
 * A second receipt on the same day is a second receipt.
 *
 * `receipt-notice.ts` inserted its claim row without `sent_on`, so the column
 * defaulted to the IST date and collided with the DAY index — which was unique
 * on (student_id, session_label, sent_on, campaign_name, destination_role) and
 * NOT partial. A family paying twice in one day got one notice, and the 23505
 * was reported as "already sent for this receipt", which was untrue.
 *
 * `20260903172053_whatsapp_receipt_notices.sql:24-27` says the opposite is
 * intended. Invisible in production only because the feature is switched off.
 */
describe("a receipt notice claims on the receipt, not on the day", () => {
  it("states sent_on and notice_kind rather than leaning on a column default", () => {
    expect(NOTICE).toContain("sent_on: istTodayIso()");
    expect(NOTICE).toContain('notice_kind: "receipt"');
  });

  it("makes the day index partial so receipt-shaped notices skip it", () => {
    // The day index still guards reminders and covered_by_sibling rows, which
    // carry receipt_id is null. Receipt-shaped notices are guarded by the
    // receipt index alone — which is what the 2026-09-03 comment always meant.
    expect(MIGRATION).toMatch(
      /create unique index[\s\S]*whatsapp_reminder_sends_reminder_day_idx[\s\S]*where receipt_id is null/,
    );
    expect(MIGRATION).toContain(
      "drop index if exists public.whatsapp_reminder_sends_student_day_campaign_role_idx",
    );
  });

  it("re-keys the receipt index so a reversal can share the receipt", () => {
    // One receipt may legitimately produce one "payment received" and later one
    // "payment reversed". On the old (receipt_id) key the second collided with
    // the first and was reported as a duplicate.
    expect(MIGRATION).toMatch(
      /create unique index[\s\S]*whatsapp_reminder_sends_receipt_kind_idx[\s\S]*\(receipt_id, notice_kind\)/,
    );
    expect(MIGRATION).toContain("drop index if exists public.whatsapp_reminder_sends_receipt_idx");
  });

  it("keeps notice_kind NOT NULL, because NULLS DISTINCT would void the guard", () => {
    // A nullable notice_kind lets Postgres treat two rows with the same
    // receipt_id and a null kind as different — silently deleting the "one
    // notice per receipt, ever" guarantee the index exists to provide.
    expect(MIGRATION).toContain("add column if not exists notice_kind text not null default");
  });

  it("creates each new index before dropping the one it replaces", () => {
    // Dropping first leaves a window in which nothing stops a duplicate.
    const createReceipt = MIGRATION.indexOf("whatsapp_reminder_sends_receipt_kind_idx");
    const dropReceipt = MIGRATION.indexOf(
      "drop index if exists public.whatsapp_reminder_sends_receipt_idx",
    );
    const createDay = MIGRATION.indexOf("whatsapp_reminder_sends_reminder_day_idx");
    const dropDay = MIGRATION.indexOf(
      "drop index if exists public.whatsapp_reminder_sends_student_day_campaign_role_idx",
    );
    expect(createReceipt).toBeGreaterThan(-1);
    expect(createReceipt).toBeLessThan(dropReceipt);
    expect(createDay).toBeGreaterThan(-1);
    expect(createDay).toBeLessThan(dropDay);
  });

  it("backfills before building the index it feeds", () => {
    const backfill = MIGRATION.indexOf("set notice_kind = 'receipt'");
    const index = MIGRATION.indexOf("whatsapp_reminder_sends_receipt_kind_idx");
    expect(backfill).toBeGreaterThan(-1);
    expect(backfill).toBeLessThan(index);
  });
});

describe("a document header never becomes a body slot", () => {
  it("hands the PDF to the service as the header's document, and only when there is one", () => {
    expect(PARENT_SEND).toContain("document: args.media ?? null");
    expect(PARENT_SEND).not.toMatch(/templateParams[^\n]*media/);
  });

  it("keeps the document a header component, never a body value", () => {
    // Meta enforces the template's parameter count exactly. A header is a
    // separate component with its own document parameter; adding the filename
    // as a body slot is the mistake this pins against.
    const wire = templateMessageBody({
      to: "+919000000001",
      name: "vpps_receipt_hi_v1",
      languageCode: "hi",
      bodyParams: ["a", "b"],
      document: { url: "https://example.test/r.pdf", filename: "Receipt.pdf" },
    }) as { template: { components: Array<{ type: string; parameters: unknown[] }> } };
    const [header, body] = wire.template.components;
    expect(header).toEqual({ type: "header", parameters: [{ type: "document", document: { link: "https://example.test/r.pdf", filename: "Receipt.pdf" } }] });
    expect(body!.parameters).toHaveLength(2);
    // A body-only send has no header at all.
    const plain = templateMessageBody({ to: "+919000000001", name: "x", languageCode: "hi", bodyParams: ["a"] }) as { template: { components: Array<{ type: string }> } };
    expect(plain.template.components.map((part) => part.type)).toEqual(["body"]);
  });
});

describe("the receipt notice is off the cashier's critical path", () => {
  it("sends from inside after(), and after the matview drain", () => {
    // A bare await in the action body runs BEFORE after(), so the balance
    // quoted could predate the payment — and it put a provider round trip, soon
    // a PDF render, in front of the cashier.
    const afterBlock = PAYMENTS_ACTION.slice(
      PAYMENTS_ACTION.indexOf("after(async () =>"),
      PAYMENTS_ACTION.indexOf("return {", PAYMENTS_ACTION.indexOf("after(async () =>")),
    );
    expect(afterBlock).toContain("drainFinancialViewRefresh()");
    expect(afterBlock).toContain("sendReceiptNotice({");
    expect(afterBlock.indexOf("drainFinancialViewRefresh()")).toBeLessThan(
      afterBlock.indexOf("sendReceiptNotice({"),
    );
  });

  it("still swallows every failure, so a WhatsApp hiccup cannot fail a posting", () => {
    expect(PAYMENTS_ACTION).toMatch(
      /try \{\s*await sendReceiptNotice\([\s\S]*?\} catch \(caught\) \{[\s\S]*?console\.warn/,
    );
  });

  it("declares a maxDuration, because after() work still runs in this route", () => {
    expect(read("src/app/(app)/fees/payments/page.tsx")).toContain("export const maxDuration = 60");
  });
});
