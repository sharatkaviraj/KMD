// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import en from "../src/messages/en.json";
import hi from "../src/messages/hi.json";
import both from "../src/messages/hi-en.json";

/*
 * The year picker's words (polish thread, 7 Nov 2026).
 *
 * The desktop menu printed "Test / UAT / DEMO" and "Other production" — its
 * own English titles — while the phone sheet said "Practice years"; and a
 * reader of both languages saw the phone sheet in Hindi alone, because the
 * root layout sent the shell a plain `hi.json` cut instead of the bilingual
 * catalogue the fee screens get. Both pills now say every word through the
 * catalogue, and the root layout cuts the shell from the request's own one.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../src/app/(app)/fees/session/actions", () => ({
  listAvailableSessionsAction: vi.fn(),
  setViewSessionAction: vi.fn(),
}));
vi.mock("../src/ui/primitives/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div data-session-contents>{children}</div>,
  releaseAllSheetScrollLocks: vi.fn(),
}));

import { bilingualCatalog } from "../src/platform/i18n/bilingual-catalog";
import { shellMessages } from "../src/platform/i18n/shell-messages";
import { SessionSwitchingProvider } from "../src/modules/fees/platform/session-context/switching-context";
import { MobileSessionPill } from "../src/ui/shell/mobile-session-pill";
import { SessionPill, groupSessions } from "../src/ui/shell/session-pill";

const sessions = [
  { id: "session-current", session_label: "2026-27", status: "active", is_current: true },
  { id: "session-other", session_label: "2025-26", status: "active", is_current: false },
  { id: "session-test", session_label: "TEST-2026-27", status: "active", is_current: false },
];

/** What the root layout sends a reader of both languages: the bilingual catalogue, cut to the shell. */
const bothReaderShell = shellMessages(bilingualCatalog(en, hi));

/** jsdom's import.meta.url is not a file URL, so source is read from the repo root. */
const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  // Radix measures its popper; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Opens the desktop menu with the keyboard and returns what it says. */
function openDesktopMenu(locale: string, messages: Record<string, unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <SessionSwitchingProvider>
          <SessionPill currentLabel="2026-27" isTest={false} initialSessions={sessions} appearance="one" />
        </SessionSwitchingProvider>
      </NextIntlClientProvider>,
    );
  });
  const trigger = host.querySelector("button")!;
  act(() => {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const menu = document.body.querySelector('[role="menu"]');
  expect(menu, "the year menu opened").not.toBeNull();
  return {
    trigger,
    headings: Array.from(menu!.querySelectorAll("[data-session-group] > p")).map((p) => p.textContent),
    text: menu!.textContent ?? "",
  };
}

function phoneSheet(locale: string, messages: Record<string, unknown>) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <SessionSwitchingProvider>
        <MobileSessionPill currentLabel="2026-27" isTest={false} initialSessions={sessions} />
      </SessionSwitchingProvider>
    </NextIntlClientProvider>,
  );
}

describe("the year picker says its words through the catalogue", () => {
  it("names each group by a key every catalogue carries", () => {
    const keys = groupSessions(sessions).map((group) => group.key);
    expect(keys).toEqual(["sessionGroupActive", "sessionGroupOther", "sessionGroupTest"]);
    for (const catalogue of [en, hi, both]) {
      for (const key of keys) expect(catalogue.MobileApp[key]).toBeTruthy();
    }
  });

  it("calls the test years Practice years on the desktop, never Test / UAT / DEMO", () => {
    const menu = openDesktopMenu("en", shellMessages(en));
    expect(menu.headings).toEqual(["Active", "Other academic years", "Practice years"]);
    expect(menu.text).not.toMatch(/Test \/ UAT|DEMO|Other production/);
    expect(menu.text).toContain("TEST");
    expect(menu.trigger.getAttribute("aria-label")).toBe("Change academic session, current session 2026-27");
  });

  it("gives a reader of both languages both, on the desktop menu", () => {
    const menu = openDesktopMenu("hi", bothReaderShell);
    expect(menu.headings).toEqual([
      "Active · वर्तमान",
      "Other academic years · अन्य शैक्षणिक वर्ष",
      "Practice years · अभ्यास वर्ष",
    ]);
    expect(menu.text).toContain("TEST · परीक्षण");
  });

  it("gives a reader of both languages both, on the phone sheet", () => {
    const html = phoneSheet("hi", bothReaderShell);
    expect(html).toContain("Practice years · अभ्यास वर्ष");
    expect(html).toContain("Active · वर्तमान");
    expect(html).toContain("TEST · परीक्षण");
  });

  it("keeps a Hindi reader's sheet in Hindi", () => {
    const html = phoneSheet("hi", shellMessages(hi));
    expect(html).toContain("अभ्यास वर्ष");
    expect(html).not.toContain("Practice years");
  });

  it("never carries a group title of its own in either pill", () => {
    for (const file of ["session-pill.tsx", "mobile-session-pill.tsx"]) {
      // Comments may tell the history; only code can print a title.
      const source = read(`src/ui/shell/${file}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/Test \/ UAT \/ DEMO|"Other production"|group\.title/);
      expect(source, file).toContain("t(group.key)");
    }
  });

  it("root layout cuts the shell from the request's own catalogue, which is bilingual for a both reader", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("getMessages()");
    expect(layout).toContain("shellMessages(messages)");
    expect(layout).not.toMatch(/import\("@\/messages\/(?:en|hi|hi-en)\.json"\)/);
    const request = read("src/platform/i18n/request.ts");
    expect(request).toContain('bilingual = staff?.language === "both" && locale === "hi"');
  });
});
