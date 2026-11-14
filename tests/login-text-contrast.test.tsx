import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  reason: "",
  state: { status: "idle", message: null } as {
    status: "idle" | "error";
    message: { hi: string; en: string } | null;
  },
}));

// Render the real form and shared text components without a server action,
// authentication request or navigation. Only the action result is synthetic.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useActionState: () => [fixture.state, undefined, false] };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ reason: fixture.reason, next: "/teach" }),
}));
vi.mock("@/app/login/actions", () => ({ loginAction: vi.fn(), requestCodeAction: vi.fn(), verifyCodeAction: vi.fn() }));

import { CODE_TEXT } from "@/app/login/code-form";
import { LOGIN_TEXT, LoginForm } from "@/app/login/login-form";
import * as m from "@/messages/pairs";

function expectFullTextStrength(html: string) {
  expect(html).not.toMatch(/\bopacity-(?:75|80|90)\b/);
  expect(html).not.toContain("text-subtle-foreground");
  expect(html).not.toMatch(/text-[\w-]+\/(?:75|80|90)/);
}

function expectBilingual(html: string, text: { hi: string; en: string }) {
  expect(html).toContain(text.hi);
  expect(html).toContain(text.en);
}

describe("login essential secondary text contrast", () => {
  beforeEach(() => {
    fixture.reason = "";
    fixture.state = { status: "idle", message: null };
  });

  it("keeps both credential labels at full-strength readable tokens", () => {
    const html = renderToStaticMarkup(<LoginForm language="both" />);
    expectBilingual(html, m.email);
    expectBilingual(html, m.password);
    // Both labels are tied to their inputs (the vx form, P11).
    expect(html).toContain('for="email"');
    expect(html).toContain('for="password"');
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('name="next" value="/teach"');
    expectFullTextStrength(html);
  });

  it.each(["no-profile", "inactive"])("keeps both %s and ask-the-admin lines without opacity", (reason) => {
    fixture.reason = reason;
    const html = renderToStaticMarkup(<LoginForm language="both" />);
    expectBilingual(html, reason === "no-profile" ? m.noProfile : m.accountInactive);
    expectBilingual(html, { en: LOGIN_TEXT.newHere.en, hi: LOGIN_TEXT.newHere.hi ?? "(no Hindi)" });
    // The second language sits under the first at full strength, never faded.
    expect(html).toContain('role="status"');
    expectFullTextStrength(html);
  });

  it("explains a sign-out caused by an expired session", () => {
    fixture.reason = "expired";
    const html = renderToStaticMarkup(<LoginForm language="both" />);
    expect(html).toContain("session ended");
    expect(html).toContain('name="next" value="/teach"');
    expectFullTextStrength(html);
  });

  it("keeps failed sign-in and ask-the-admin copy readable with error associations intact", () => {
    fixture.state = { status: "error", message: { hi: "फिर प्रयास करें", en: "Try again" } };
    const html = renderToStaticMarkup(<LoginForm language="both" />);
    expectBilingual(html, fixture.state.message!);
    expectBilingual(html, { en: LOGIN_TEXT.newHere.en, hi: LOGIN_TEXT.newHere.hi ?? "(no Hindi)" });
    expect(html).toContain('id="login-error"');
    expect(html).toContain('role="alert"');
    expect(html.match(/aria-describedby="login-error"/g)).toHaveLength(2);
    expectFullTextStrength(html);
  });

  it("opens on the mobile number when code sign-in is on for all staff, both languages at full strength (D-585)", () => {
    const html = renderToStaticMarkup(<LoginForm language="both" codeSignIn="default" />);
    expectBilingual(html, CODE_TEXT.phone as { hi: string; en: string });
    // The hint under the number is said in both languages too (BrowserStack check, 12 Nov).
    expectBilingual(html, CODE_TEXT.phoneHint as { hi: string; en: string });
    expectBilingual(html, { hi: CODE_TEXT.welcome.hi ?? "(no Hindi)", en: CODE_TEXT.welcome.en.replace("'", "&#x27;") });
    expect(html).toContain('for="phone"');
    expect(html).toContain('autoComplete="tel-national"');
    // Password sits beside the code, in both languages (D-608).
    expect(html).toContain('role="radiogroup"');
    expectBilingual(html, LOGIN_TEXT.byCode as { hi: string; en: string });
    expectBilingual(html, LOGIN_TEXT.byPassword as { hi: string; en: string });
    expect(html).not.toContain('for="password"');
    expectFullTextStrength(html);
  });

  it("says the tries left and how to paste the code in both languages, not only the first (D-585)", () => {
    const source = readFileSync("src/app/login/code-form.tsx", "utf8");
    expect(source).toContain("under(extra, language)");
    // The paste steps are now said once, under "Code sent", in both languages (12 Nov redraw).
    expect(source).toContain("<Two pair={auto ? T.sentBodyAuto : T.sentBody} language={language} small />");
    expect(source).toContain("<Two pair={T.phoneHint} language={language} small />");
  });

  it("opens on the mobile number whenever the code is on, owner only too, and on email and password when it is off (D-608)", () => {
    const off = renderToStaticMarkup(<LoginForm language="en" codeSignIn="none" />);
    expect(off).toContain('for="password"');
    expect(off).not.toContain("WhatsApp code");
    expect(off).not.toContain('role="radiogroup"');
    // Owner only: the number first as well; other numbers are told codes are not on for them yet.
    for (const offer of ["offered", "default"] as const) {
      const html = renderToStaticMarkup(<LoginForm language="en" codeSignIn={offer} />);
      expect(html).toContain('for="phone"');
      expect(html).not.toContain('for="password"');
      expect(html).toContain(LOGIN_TEXT.byPassword.en);
    }
  });

  it("keeps the login page wrapper free of inherited text opacity", () => {
    const page = readFileSync("src/app/login/page.tsx", "utf8");
    expect(page).toContain("<LoginForm language={language} codeSignIn={codeSignIn} />");
    expect(page).not.toMatch(/\bopacity-\d+\b|text-[\w-]+\/(?:75|80|90)/);
  });
});
