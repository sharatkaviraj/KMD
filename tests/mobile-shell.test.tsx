import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { mobileMoreGroupsFor } from "../src/platform/config/mobile-navigation";
import { navigationFor } from "../src/platform/config/navigation";
import { feeRoleFor } from "../src/platform/auth/fee-roles";
import { staffRoles } from "../src/platform/auth/permissions";
import messages from "../src/messages/en.json";

const route = vi.hoisted(() => ({ pathname: "/teach", query: "session=2026-27" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.query),
}));
vi.mock("next-intl", () => ({ useTranslations: (namespace: keyof typeof messages) => {
  const catalogue = messages[namespace] as Record<string, string>;
  const t = (key: string) => catalogue[key] ?? key;
  t.has = (key: string) => key in catalogue;
  return t;
} }));
vi.mock("../src/ui/shell/nav-link", () => ({
  NAV_EVENT: "test-navigation",
  NavLink: ({ href, children, className, onClick, ...props }: React.ComponentProps<"a"> & { unstable_dynamicOnHover?: boolean }) => (
    <a href={href} className={className} onClick={onClick} aria-current={props["aria-current"]}>{children}</a>
  ),
}));
// Render menu contents to inspect the actual component's links, independent of
// whether the controlled Sheet is open. Focus/history are browser-test duties.
vi.mock("../src/ui/primitives/sheet", () => ({ Sheet: ({ children }: { children: React.ReactNode }) => <div data-menu-contents>{children}</div> }));
import { MobileBottomNav } from "../src/ui/shell/mobile-bottom-nav";

function markup(role: (typeof staffRoles)[number], pathname = "/teach") {
  route.pathname = pathname;
  return renderToStaticMarkup(<MobileBottomNav
    staffRole={feeRoleFor(role)}
    staffRoleLabel={role}
    staffEmail="qa@example.test"
    items={navigationFor(role).map((item) => ({ href: item.href, label: item.label.en }))}
    moreGroups={mobileMoreGroupsFor(role, "en")}
    counts={{ "/fees/defaulters": 120 }}
  />);
}

describe("rendered unified mobile chrome", () => {
  it.each(staffRoles)("lets %s reach personal preferences without adding fee-only session parameters", (role) => {
    const html = markup(role);
    expect(html).toContain('href="/preferences"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('href="/more');
  });

  it("renders native teacher More links and no fee links", () => {
    const html = markup("teacher");
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain('href="/fees/');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("shows only one longest-match current route in overlapping fee menu routes", () => {
    const html = markup("admin", "/fees/reminders");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/fees\/reminders\?session=2026-27"[^>]*aria-current="page"/);
  });

  it("identifies personal preferences as the current More destination", () => {
    const html = markup("teacher", "/preferences");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/preferences"[^>]*aria-current="page"/);
  });

  it("preserves the overflow follow-up badge", () => {
    const html = markup("office", "/dashboard");
    expect(html).toContain("99+");
  });

  it("reuses Sheet scroll/focus behavior and keeps link navigation out of synthetic history", () => {
    const source = readFileSync(new URL("../src/ui/shell/mobile-bottom-nav.tsx", import.meta.url), "utf8");
    expect(source).toContain("<Sheet");
    expect(source).toContain("historyDismiss={false}");
    expect(source).toContain('window.matchMedia("(min-width: 768px)")');
    expect(source).not.toContain('document.body.style.overflow');
    expect(source).not.toContain('window.addEventListener("keydown"');
  });

  it("passes native groups into the tablet navigation", () => {
    const source = readFileSync(new URL("../src/ui/shell/app-topbar.tsx", import.meta.url), "utf8");
    expect(source).toContain("groups={sidebarGroups}");
  });

  it("provides session expanded/selected semantics and stable default list identity", () => {
    const source = readFileSync(new URL("../src/ui/shell/mobile-session-pill.tsx", import.meta.url), "utf8");
    expect(source).toContain("aria-expanded={open}");
    expect(source).toContain("aria-pressed={selected}");
    expect(source).toContain("initialSessions = EMPTY_SESSIONS");
    expect(source).toContain('role={loadFailed ? "alert" : "status"}');
    expect(source).not.toContain('title: "Could not switch session"');
  });
});
