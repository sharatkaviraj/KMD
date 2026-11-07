// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useTranslations } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import en from "../src/messages/en.json";
import hi from "../src/messages/hi.json";

/*
 * The shell's language follows the server after sign-in (polish thread,
 * 7 Nov 2026).
 *
 * BrowserStack found the year picker in English straight after sign-in, for an
 * admin who reads both languages, and right after a reload in both. The root
 * layout's provider had been handed the account's language — the sign-in
 * redirect and `router.refresh()` both re-render the root layout — but it
 * kept the locale and catalogue it was first given as state, so the shell
 * stayed in the signed-out English. `<html lang>` stayed "en" as well.
 */

vi.mock("../src/platform/locale/actions", () => ({ setLocaleAction: vi.fn(async () => undefined) }));
vi.mock("../src/ui/primitives/toast", () => ({ toast: vi.fn() }));

import { bilingualCatalog } from "../src/platform/i18n/bilingual-catalog";
import { shellMessages } from "../src/platform/i18n/shell-messages";
import type { AppLocale } from "../src/platform/i18n/locales";
import { LanguageProvider, useLang, type LanguageCatalogs } from "../src/platform/locale/language-provider";

/** jsdom's import.meta.url is not a file URL, so source is read from the repo root. */
const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.documentElement.lang = "";
});

function Shell() {
  const t = useTranslations("MobileApp");
  const { locale, setLocale } = useLang();
  return (
    <div>
      <p data-heading>{t("sessionGroupTest")}</p>
      <p data-locale>{locale}</p>
      <button type="button" onClick={() => setLocale("en")}>English</button>
    </div>
  );
}

/** What the root layout renders: the provider, given the locale and catalogue the server chose. */
function renderRoot(initialLocale: AppLocale, catalogs: LanguageCatalogs) {
  if (!host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => {
    root!.render(
      <LanguageProvider initialLocale={initialLocale} catalogs={catalogs} shellOnly>
        <Shell />
      </LanguageProvider>,
    );
  });
  return {
    heading: host.querySelector("[data-heading]")?.textContent,
    locale: host.querySelector("[data-locale]")?.textContent,
    lang: document.documentElement.lang,
  };
}

const signedOut = (): LanguageCatalogs => ({ en: shellMessages(en) });
const bothReader = (): LanguageCatalogs => ({ hi: shellMessages(bilingualCatalog(en, hi)) });

describe("the root layout's language provider follows the server", () => {
  it("speaks the signed-out language on the sign-in page", () => {
    expect(renderRoot("en", signedOut())).toEqual({ heading: "Practice years", locale: "en", lang: "en" });
  });

  it("switches to the account's language when sign-in re-renders the root layout", () => {
    renderRoot("en", signedOut());
    expect(renderRoot("hi", bothReader())).toEqual({ heading: "Practice years · अभ्यास वर्ष", locale: "hi", lang: "hi" });
  });

  it("follows the EN | हि switch, which refreshes the root layout with the new language", () => {
    renderRoot("hi", bothReader());
    expect(renderRoot("en", { en: shellMessages(en) })).toEqual({ heading: "Practice years", locale: "en", lang: "en" });
  });

  it("does not undo a choice made on this page when the root layout was not rendered again", async () => {
    const same = bothReader();
    renderRoot("hi", same);
    await act(async () => {
      host!.querySelector("button")!.click();
    });
    // The English catalogue is imported on first use; each poll lets React apply it.
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(host!.querySelector("[data-heading]")?.textContent).toBe("Practice years");
    });
    // An ordinary navigation hands the provider the very same props.
    expect(renderRoot("hi", same)).toEqual({ heading: "Practice years", locale: "en", lang: "en" });
  });

  it("is the provider the root layout mounts, with the server's locale and catalogue", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("<FeeLanguageProvider initialLocale={locale} catalogs={feeMessages} shellOnly>");
    const provider = read("src/platform/locale/language-provider.tsx");
    expect(provider).toContain("if (fromServer !== catalogs)");
    expect(provider).toContain("document.documentElement.lang = locale");
  });
});
