import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isPlausibleReceiptNumber, receiptVerifyPath } from "@/modules/receipts/domain/verify-url";

/**
 * The receipt check a parent reaches from a receipt notice.
 *
 * The fees app serves it at `/r/{receiptNumber}`. In One `/r/` is SamPark's
 * request-token route, so the link the ported `receipt-notice.ts` built landed
 * on a token page and 404'd (go-live critique A2). The page is ported to
 * `/rv/[code]`, every link is built by `receiptVerifyPath()`, and the path is
 * public so a parent with no account is not sent to the login page.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const db = vi.hoisted(() => ({
  row: null as null | { id: string; receipt_number: string; payment_date: string; total_amount: number },
  reversed: false as boolean | "throws",
  lookups: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("receipts");
      const chain = {
        select: () => chain,
        eq: (_column: string, value: string) => {
          db.lookups.push(value);
          return chain;
        },
        maybeSingle: async () => ({ data: db.row, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/modules/receipts/data/reversals", () => ({
  getReceiptReversalTotals: async () => {
    if (db.reversed === "throws") throw new Error("read failed");
    return new Map();
  },
  isReceiptReversed: () => db.reversed === true,
}));

const { default: ReceiptVerifyPage } = await import("@/app/rv/[code]/page");

async function render(code: string) {
  return renderToStaticMarkup(await ReceiptVerifyPage({ params: Promise.resolve({ code }) }));
}

beforeEach(() => {
  db.row = null;
  db.reversed = false;
  db.lookups = [];
});

describe("the receipt verify link", () => {
  it("is /rv/{receiptNumber}, never SamPark's /r/", () => {
    expect(receiptVerifyPath("TST-2026-0001")).toBe("/rv/TST-2026-0001");
    expect(receiptVerifyPath("SVP/26/1")).toBe("/rv/SVP%2F26%2F1");
  });

  it.each([
    "src/modules/whatsapp/data/receipt-notice.ts",
    "src/app/(app)/fees/receipts/[receiptId]/pdf/route.ts",
    "src/app/(app)/fees/receipts/[receiptId]/card/route.tsx",
    "src/app/api/fees/service/documents/route.ts",
  ])("%s builds it with receiptVerifyPath()", (path) => {
    const source = read(path);
    expect(source).toContain("receiptVerifyPath(receipt.receiptNumber)");
    expect(source).not.toMatch(/`\/r\/\$\{/);
  });

  it("rejects an odd code before touching the database", async () => {
    expect(isPlausibleReceiptNumber("TST-1")).toBe(true);
    expect(isPlausibleReceiptNumber("x'; drop table receipts;--")).toBe(false);
    expect(isPlausibleReceiptNumber("A".repeat(65))).toBe(false);
    expect(await render("%E0%A4%A")).toContain("Not a recognised receipt");
    expect(await render(encodeURIComponent("<script>"))).toContain("Not a recognised receipt");
    expect(db.lookups).toEqual([]);
  });
});

describe("the /rv/[code] page", () => {
  it("vouches for a real receipt, showing number, date and amount only", async () => {
    db.row = { id: "r1", receipt_number: "TST-2026-0001", payment_date: "2026-10-30", total_amount: 1500 };
    const html = await render("TST-2026-0001");
    expect(html).toContain("Valid school receipt");
    expect(html).toContain("TST-2026-0001");
    expect(db.lookups).toEqual(["TST-2026-0001"]);
  });

  it("says a reversed receipt is reversed", async () => {
    db.row = { id: "r1", receipt_number: "TST-2026-0002", payment_date: "2026-10-30", total_amount: 900 };
    db.reversed = true;
    expect(await render("TST-2026-0002")).toContain("This receipt has been reversed");
  });

  it("does not vouch either way when the reversal state cannot be read", async () => {
    db.row = { id: "r1", receipt_number: "TST-2026-0003", payment_date: "2026-10-30", total_amount: 900 };
    db.reversed = "throws";
    const html = await render("TST-2026-0003");
    expect(html).toContain("Could not verify right now");
    expect(html).not.toContain("Valid school receipt");
  });

  it("says an unknown number is not recognised", async () => {
    expect(await render("TST-9999")).toContain("Not a recognised receipt");
  });
});

describe("the path is public", () => {
  it("a signed-out parent reaches /rv/ without a login redirect", async () => {
    vi.resetModules();
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({ auth: { getClaims: async () => ({ data: null, error: null }) } }),
    }));
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    const { updateSession } = await import("@/platform/supabase/middleware");

    const open = await updateSession(new NextRequest(new URL("/rv/TST-2026-0001", "https://vppsone.test")));
    expect(open.headers.get("location")).toBeNull();

    // A neighbouring path is not opened by accident.
    const closed = await updateSession(new NextRequest(new URL("/rvx", "https://vppsone.test")));
    expect(closed.headers.get("location")).toContain("/login");
  });
});
