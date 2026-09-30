import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../src/messages/en.json";
import hi from "../src/messages/hi.json";
import both from "../src/messages/hi-en.json";

vi.mock("next/navigation", () => ({
  usePathname: () => "/fees/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../src/app/(app)/fees/session/actions", () => ({
  listAvailableSessionsAction: vi.fn(),
  setViewSessionAction: vi.fn(),
}));
// Inspect the real session rows without a browser or invoking server actions.
// Sheet focus, scrolling and history remain integration-test responsibilities.
vi.mock("../src/ui/primitives/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div data-session-contents>{children}</div>,
  releaseAllSheetScrollLocks: vi.fn(),
}));

import { MobileSessionPill } from "../src/ui/shell/mobile-session-pill";
import { SessionSwitchingProvider } from "../src/modules/fees/platform/session-context/switching-context";

const catalogues = { en, hi, "hi-en": both };
const sessions = [
  { id: "session-current", session_label: "2026-27", status: "active", is_current: true },
  { id: "session-other", session_label: "2025-26", status: "active", is_current: false },
  { id: "session-test", session_label: "TEST-2026-27", status: "active", is_current: false },
];

function markup(locale: keyof typeof catalogues) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={catalogues[locale]}>
      <SessionSwitchingProvider>
        <MobileSessionPill currentLabel="TEST-2026-27" isTest initialSessions={sessions} />
      </SessionSwitchingProvider>
    </NextIntlClientProvider>,
  );
}

describe("mobile session visual alignment", () => {
  it.each(["en", "hi", "hi-en"] as const)("preserves full labels and selection for %s readers", (locale) => {
    const html = markup(locale);
    for (const session of sessions) expect(html).toContain(session.session_label);
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).toContain(catalogues[locale].MobileApp.sessionTestBadge);
    expect(html).not.toContain("truncate");
  });

  it("reserves the same trailing check column for every row", () => {
    const html = markup("en");
    expect(html.match(/grid-cols-\[minmax\(0,1fr\)_1\.25rem\]/g)).toHaveLength(sessions.length);
    expect(html.match(/grid size-5 place-items-center/g)).toHaveLength(sessions.length);
    expect(html).toContain("text-left");
  });

  it("keeps a stable centered trigger width and icon frame", () => {
    const html = markup("en");
    expect(html).toContain("w-[min(42vw,10rem)]");
    expect(html).toContain("grid-cols-[minmax(0,1fr)_1rem]");
    expect(html).toContain("grid size-4 place-items-center");
    expect(html).toContain("whitespace-normal break-words");
  });

  it("uses reduced-motion-safe feedback without layout animation", () => {
    const source = readFileSync(new URL("../src/ui/shell/mobile-session-pill.tsx", import.meta.url), "utf8");
    expect(source).toContain("motion-safe:active:scale-[0.98]");
    expect(source).toContain("motion-reduce:transition-none");
    expect(source).not.toContain("transition-all");
    expect(source).not.toMatch(/transition-\[(?:[^\]]*,)?(?:width|height|padding|margin)/);
  });
});
