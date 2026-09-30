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

import { LoginForm } from "@/app/login/login-form";
import { m } from "@/messages";

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
    expect(html.match(/text-\[13px\] font-normal text-muted-foreground/g)).toHaveLength(2);
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('name="next" value="/teach"');
    expectFullTextStrength(html);
  });

  it.each(["no-profile", "inactive"])("keeps both %s and no-signup notice lines without opacity", (reason) => {
    fixture.reason = reason;
    const html = renderToStaticMarkup(<LoginForm language="both" />);
    expectBilingual(html, reason === "no-profile" ? m.noProfile : m.accountInactive);
    expectBilingual(html, m.noSignup);
    expect(html.match(/<p lang="en" class="mt-0\.5 text-\[13px\] leading-5">/g)).toHaveLength(2);
    expectFullTextStrength(html);
  });

  it("keeps failed sign-in and no-signup copy readable with error associations intact", () => {
    fixture.state = { status: "error", message: { hi: "फिर प्रयास करें", en: "Try again" } };
    const html = renderToStaticMarkup(<LoginForm language="both" />);
    expectBilingual(html, fixture.state.message!);
    expectBilingual(html, m.noSignup);
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
