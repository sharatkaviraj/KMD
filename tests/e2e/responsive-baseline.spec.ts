import { expect, test, type Page } from "@playwright/test";

import { openAs } from "./support/harness";

/**
 * The phone rules from PLAN §3a, checked on the screens staff actually open.
 *
 * Two of them, because they are the two that make a screen unusable rather
 * than merely untidy:
 *
 *  - **no page-level horizontal scroll.** A phone that scrolls sideways hides
 *    the right-hand half of every row, and the thing that is usually off the
 *    edge is the control. QA.md: "Page-level horizontal overflow fails."
 *  - **primary targets at least 44px.** A register is marked standing up.
 *
 * This is a baseline, not the R7.2 sweep: three widths, one pass, no axe and
 * no keyboard walk. What it is for is that a layout regression at 360px shows
 * up here rather than in somebody's hand.
 */

const WIDTHS = [360, 390, 430] as const;

const SCREENS = [
  { account: "teacher", path: "/teach", name: "a teacher's day" },
  { account: "teacher", path: "/teach/attendance", name: "the register" },
  { account: "office", path: "/dashboard", name: "the office home" },
  { account: "office", path: "/apps", name: "the apps hub" },
  { account: "office", path: "/collection", name: "collection" },
  { account: "office", path: "/students", name: "the directory" },
  { account: "office", path: "/students?q=Test", name: "a search with results" },
  { account: "office", path: "/preferences", name: "your settings" },
] as const;

/** How far the document can be scrolled sideways, in CSS pixels. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}

/**
 * Every visible control, with the box a thumb actually has to hit.
 *
 * **The label, when there is one.** A checkbox is drawn 20px square and sits
 * inside a 48px row that is the target — "the whole row is the target, not
 * just the 20px box", as the primitive puts it. Measuring the input instead
 * would fail every form in the app for a rule none of them break.
 */
async function targets(page: Page) {
  return page.evaluate(() => {
    const interactive = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button, input[type="radio"], input[type="checkbox"], select',
      ),
    ];

    return interactive
      .map((element) => {
        const hitArea =
          element instanceof HTMLInputElement
            ? (element.closest("label") ??
              (element.id
                ? document.querySelector<HTMLElement>(`label[for="${element.id}"]`)
                : null) ??
              element)
            : element;

        const box = hitArea.getBoundingClientRect();
        const label =
          element.getAttribute("aria-label") ??
          hitArea.textContent?.trim().slice(0, 40) ??
          element.tagName;

        return { label, width: box.width, height: box.height };
      })
      // A zero box is a control that is not on screen at all — a hidden input,
      // something behind a closed disclosure. It has no target to be wrong about.
      .filter((entry) => entry.width > 0 && entry.height > 0);
  });
}

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    for (const screen of SCREENS) {
      test(`${screen.name} fits and can be tapped`, async ({ page, browser }) => {
        await page.setViewportSize({ width, height: 800 });
        // One session per account, reused: eighteen fresh magic links in a
        // minute is more one-time tokens than Supabase will mint, and the
        // refusal reads exactly like a permission bug.
        await openAs(page, browser, screen.account, screen.path);

        await expect(page.locator("main")).toBeVisible();

        expect(
          await horizontalOverflow(page),
          `${screen.path} scrolls sideways at ${width}px`,
        ).toBe(0);

        const tooSmall = (await targets(page)).filter((entry) => entry.height < 44);

        expect(
          tooSmall.map((entry) => `${entry.label} (${Math.round(entry.height)}px)`),
          `${screen.path} has controls under 44px tall at ${width}px`,
        ).toEqual([]);
      });
    }
  });
}
