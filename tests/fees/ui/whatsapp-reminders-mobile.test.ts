import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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


/**
 * The reminders screens on a phone.
 *
 * This route has TWO opposite bottom-spacing rules, and getting them backwards
 * is invisible on a desk and obvious on a handset:
 *
 * - `/fees/reminders` is a top-level TAB. `MobileBottomNav` is really
 *   there, so anything pinned to the bottom must clear it with
 *   `--mobile-bottom-nav-offset`.
 * - `/fees/reminders/` — every sub-page — is in `mobileTakeoverRoutes`, so
 *   the bar renders nothing and the same variable would reserve 68px for a bar
 *   that is not on screen.
 *
 * `tests/ui/mobile-action-reachability.test.ts` holds the first rule for
 * `reminders-workspace.tsx`. This file holds the second for everything added
 * after it, plus the three traps this codebase has hit before.
 */

const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

const NAV_CLEARANCE = "var(--mobile-bottom-nav-offset,0px)";
const SAFE_AREA = "var(--mobile-safe-area-bottom, 0px)";

/** Everything added to this feature that a phone renders. */
const NEW_SURFACES = [
  "src/modules/whatsapp/ui/audience-builder.tsx",
  "src/modules/whatsapp/ui/notice-picker.tsx",
  "src/modules/whatsapp/ui/due-today-card.tsx",
  "src/modules/whatsapp/ui/holdout-control.tsx",
  "src/modules/whatsapp/ui/run-measurement-panel.tsx",
  "src/modules/whatsapp/ui/run-comparisons.tsx",
  "src/app/(app)/fees/reminders/unreachable/page.tsx",
  "src/app/(app)/fees/reminders/runs/[runId]/run-delivery-panel.tsx",
  "src/app/pay/[code]/page.tsx",
  // 2026-10-26: profiles, the reminder plan and school notices.
  "src/app/(app)/fees/reminders/families/page.tsx",
  "src/app/(app)/fees/reminders/ladder/page.tsx",
  "src/app/(app)/fees/reminders/notices/page.tsx",
  "src/modules/whatsapp/ui/reminders-nav.tsx",
  "src/modules/whatsapp/ui/audience-panels.tsx",
  "src/modules/whatsapp/ui/notice-preview.tsx",
  "src/modules/whatsapp/ui/profile-badge.tsx",
];

/** The sub-pages, where the tab bar is NOT rendered. */
const TAKEOVER_SURFACES = [
  "src/app/(app)/fees/reminders/unreachable/page.tsx",
  "src/app/(app)/fees/reminders/runs/[runId]/run-delivery-panel.tsx",
  "src/app/(app)/fees/reminders/families/page.tsx",
  "src/app/(app)/fees/reminders/ladder/page.tsx",
  "src/app/(app)/fees/reminders/notices/page.tsx",
];

describe("reminders sub-pages are takeovers, not tab screens", () => {
  it.each(TAKEOVER_SURFACES)("%s pads for the safe area, not for a tab bar", (path) => {
    const source = read(path);

    // The bar is not rendered on a takeover, so reserving room for it leaves a
    // 68px band of nothing above the home indicator.
    expect(source).not.toContain(NAV_CLEARANCE);
    expect(source).toContain(SAFE_AREA);
  });
});

describe("the phone traps this codebase has already hit", () => {
  it.each(NEW_SURFACES)("%s uses dvh, never vh", (path) => {
    // 100vh is taller than the visible viewport on a phone browser with a
    // chrome bar, so a button positioned against it lands underneath.
    const source = read(path);
    expect(source).not.toMatch(/\b(h-screen|min-h-screen)\b/);
    expect(source).not.toContain("100vh");
  });

  it.each(NEW_SURFACES)("%s reads no window during render", (path) => {
    // `window` exists during hydration, so reading it in a `useState`
    // initializer mismatches the server and throws a hydration error. The
    // pattern here is `useSyncExternalStore` with a server snapshot.
    const source = read(path);
    expect(source).not.toMatch(/useState\([^)]*window/);
    expect(source).not.toMatch(/useState\(\(\)\s*=>\s*window/);
  });

  it.each(NEW_SURFACES)("%s spaces conditional blocks with flex gap", (path) => {
    // Tailwind's `space-y` puts a margin around a `hidden` child too, so a
    // twin-branch block leaks a visible band onto the phone. Every stack here
    // that can hide a child uses `flex flex-col gap-*`.
    //
    // `space-y-1.5` on a Label+field pair is exempt and deliberate: it is the
    // repo's own field idiom and neither child is ever conditional.
    const source = read(path);
    const stacks = source.match(/space-y-(?!1\.5\b)[\w.]+/g) ?? [];
    expect(stacks).toEqual([]);
  });
});

describe("what the office taps, measured at 390px", () => {
  const AUDIENCE = "src/modules/whatsapp/ui/audience-builder.tsx";
  const PICKER = "src/modules/whatsapp/ui/notice-picker.tsx";

  /**
   * Both chip rows scrolled horizontally with `no-scrollbar` until 2026-09-10,
   * and measured on a 390px viewport — where the card's inner width is 298px —
   * that hid most of both:
   *
   * | row | row width | hidden | reachable |
   * |---|---|---|---|
   * | 12 templates | 1571px | 1265px | ~3 of 12 |
   * | 5 audiences  |  759px |  453px |  2 of 5  |
   *
   * They are fixed in OPPOSITE directions on purpose, and the reason is how
   * often each is touched rather than how many chips it holds.
   */
  it("lays the five tiles out as a wrapping grid, so none of the primary control is off-screen", () => {
    const source = read(AUDIENCE);
    const row = source.slice(source.indexOf("--- tiles"), source.indexOf("<Tile"));

    // A grid at EVERY width — two columns on a phone, five at the desk. This
    // is the control the office retunes on every run, so all five counts have
    // to be comparable at a glance.
    expect(row).toContain('className="grid grid-cols-2 gap-2 md:grid-cols-5"');
    expect(source).not.toContain("overflow-x-auto");
  });

  it("keeps the twelve template chips on one row, but says so", () => {
    const source = read(PICKER);

    // Twelve chips WRAPPED cost six rows and 304px — 35% of an 861px card —
    // spent on the control changed least, and pushed "Who gets it" from 890px
    // to 1156px on an 844px screen. So it still scrolls, but the affordance
    // `no-scrollbar` removed is put back explicitly.
    expect(source).toContain("snap-x");
    expect(source).toContain("snap-start");
    expect(source).toContain("bg-gradient-to-l from-card");
    expect(source).toContain("Swipe for all {NOTICE_SITUATIONS.length} messages.");
  });

  it("gives every chip and tile a 44px tap target on a phone", () => {
    // The panel's own rule — "44px on a phone, the desk's own 36 above md" —
    // which chips were the one exception to, at a flat h-9.
    const picker = read(PICKER);
    expect(picker).toMatch(/h-11[^"]*md:h-9/);
    expect(picker).not.toMatch(/inline-flex h-9 shrink-0/);

    // The tiles and the all/any toggle are min-heights: a tile grows with its
    // two lines, and neither may ever be under a thumb.
    const audience = read(AUDIENCE);
    expect(audience).toMatch(/min-h-11[^"]*md:min-h-14/);
    expect(audience).toMatch(/min-h-11[^"]*md:min-h-9/);
    expect(audience).not.toMatch(/inline-flex h-9 shrink-0/);
  });

  it("wins the button height fight with the primitive's compound variant", () => {
    // `size="sm"` carries `{ size: "sm", class: "max-md:h-10" }`, so a bare
    // `h-11` loses inside the media query and Apply/Add measured 40px beside
    // 44px selects. Overriding at the same variant level is what works.
    const source = read(AUDIENCE);
    expect(source).toContain('className="max-md:h-11 px-6 md:h-9"');
    expect(source).toContain('className="max-md:h-11 px-4 md:h-9"');
    expect(source).not.toContain('className="h-11 px-6 md:h-9"');
  });

  it("splits the audience sentence into three weights rather than one wall", () => {
    // One string measured six lines and 124px of uniform semibold at 390px,
    // and it is both the first thing on the card and the last thing read
    // before a few hundred billed messages go out.
    const source = read(AUDIENCE);
    expect(source).toContain("sentence.headline");
    expect(source).toContain("sentence.claim");
    // The notes carry the Dashboard reconciliation too, composed server-side
    // and merged before rendering — so the rendered line is `notes`, not
    // `sentence.notes`.
    expect(source).toContain("...sentence.notes, ...describeTileMoney(filters, audience.money)");
    expect(source).toContain("{notes.join(");
    // One live region around all three, so a screen reader hears one update
    // rather than three.
    const start = source.indexOf('aria-live="polite"');
    const region = source.slice(start, source.indexOf("{notes.join(", start));
    expect(region).toContain("flex flex-col gap-1");
    expect(region).toContain("sentence.headline");
    expect(region).toContain("sentence.claim");
  });
});

describe("what a parent taps", () => {
  it("gives the pay button a full-width, thumb-sized target", () => {
    // The only thing on the page anybody came to do, tapped one-handed.
    const source = read("src/app/pay/[code]/page.tsx");
    expect(source).toMatch(/h-14 w-full/);
    expect(source).toContain("min-h-dvh");
  });

  it("shows the UPI id as selectable text beside the button", () => {
    // The button does nothing on a phone with no app registered to the `upi://`
    // scheme, and a parent can still type the id into the one they have.
    const source = read("src/app/pay/[code]/page.tsx");
    expect(source).toContain("select-all");
    expect(source).toContain("payment.vpa");
  });

  // The four pay-page cases of fees HEAD, ported with the Razorpay pay page in
  // go-live Phase E. One difference: the order migration is a fee-migration
  // here (supabase/fee-migrations/), not a fees app migration.
  it("never ends Pay now at a dead end", () => {
    // A mistyped, expired or test link used to say "not valid" and stop. The
    // office's own test send landed there. It now still pays the school by UPI,
    // with the amount left for the parent to type.
    const source = read("src/app/pay/[code]/page.tsx");
    expect(source).not.toContain("This link is not valid");
    const invalid = source.slice(source.indexOf('result.state === "invalid"'));
    expect(invalid.slice(0, 200)).toContain("<OpenPayPanel");
    const expired = source.slice(source.indexOf('result.state === "expired"'));
    expect(expired.slice(0, 200)).toContain("<OpenPayPanel");
    expect(source).toContain("buildOpenSchoolUpiPayment()");
  });

  it("gives an Android phone UPI buttons to tap, never Razorpay's redirect to upi://", () => {
    // WhatsApp's own browser will not follow a 302 to `upi://` ("Web page not
    // available", 2026-10-29), but does open a UPI app from a tapped link.
    const action = read("src/app/pay/[code]/actions.ts");
    expect(action).toContain("isAndroidUserAgent(userAgent)");
    expect(action).toContain("?step=open");
    const page = read("src/app/pay/[code]/page.tsx");
    expect(page).toContain("<LaunchPanel");
    expect(page).toContain("href={offer.upiUri}");
    expect(page).toContain("readRazorpayUpiUri(");
    expect(page).toContain("chromeIntentUrl(");
    // Absolute URLs come from the request's host: the env default is localhost
    // in production, which left the app fallbacks and the Chrome escape dead.
    expect(page).toContain("originFromHeaders(await headers())");
    expect(action).toContain("createAbsoluteUrl(`${back}?returned=1`, origin)");
  });

  it("the one-tap checkout view names a child by first name and class, and nothing else", () => {
    // Widened on purpose (2026-10-30): a breakdown a parent can read needs the
    // child's name. Never the admission number, a parent's name or a phone.
    const view = read("src/app/pay/[code]/checkout-view.tsx");
    const panel = read("src/app/pay/[code]/checkout-panel.tsx");
    for (const source of [view, panel]) {
      for (const forbidden of ["admission_no", "father_name", "full_name", "student_name", "father_phone", "destination"]) {
        expect(source).not.toContain(forbidden);
      }
    }
    expect(view).toContain("child.first_name");
    const migration = read("supabase/fee-migrations/20261029190000_online_payment_orders.sql");
    expect(migration).toContain("'first_name', split_part(trim(coalesce(student.full_name, '')), ' ', 1)");
    expect(migration).not.toMatch(/'admission_no'|'father_name'|'destination'/);
  });

  it("the one-tap checkout keeps the late fee on its own line and never hand-writes money", () => {
    const view = read("src/app/pay/[code]/checkout-view.tsx");
    expect(view).toContain("row.late_fee_pending");
    expect(view).toContain("formatInr(row.fees_pending)");
  });

  it("leaks nothing about the student on the public pay page", () => {
    // A payment link, not a portal. Someone who guesses a code must learn that
    // somebody owes some money and nothing more.
    const source = read("src/app/pay/[code]/page.tsx");
    for (const forbidden of ["student_name", "full_name", "class_label", "father_name"]) {
      expect(source).not.toContain(forbidden);
    }
    // The admission number reaches the UPI note so the office can match the
    // payment, and must never be rendered.
    expect(source).not.toMatch(/\{\s*result\.reference\s*\}/);
  });

  it("scrolls a wide comparison table inside itself", () => {
    // The page body must never scroll sideways on a phone.
    const source = read("src/modules/whatsapp/ui/run-comparisons.tsx");
    expect(source).toContain("overflow-x-auto");
  });
});
