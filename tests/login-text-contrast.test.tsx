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
vi.mock("@/app/login/actions", () => ({ loginAction: vi.fn() }));

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

  it("keeps the login page wrapper free of inherited text opacity", () => {
    const page = readFileSync("src/app/login/page.tsx", "utf8");
    expect(page).toContain('<LoginForm language={language} />');
    expect(page).not.toMatch(/\bopacity-\d+\b|text-[\w-]+\/(?:75|80|90)/);
  });
});
