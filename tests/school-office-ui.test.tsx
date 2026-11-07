// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ generate: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/school-office/actions", () => ({ generateCertificateAction: mock.generate, generateStudyCertificateAction: mock.generate, certificateEventAction: vi.fn(), saveCertificateTemplateAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push, refresh: mock.refresh }) }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }), default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ language: "en", tx: (p: { en: string } | string) => typeof p === "string" ? p : p.en, sub: () => null }) }));
import { StudyCertificateButton } from "@/vx/screens/school-office/study-certificate-button";
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mock.generate.mockReset().mockResolvedValue({ ok: true, issueId: "issued", existing: false });
  mock.push.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (editHref?: string) => act(async () => root.render(<StudyCertificateButton studentId="00000000-0000-4000-8000-000000000011" sessionLabel="TEST-2026-27" editHref={editHref} />));
const click = () => act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
it("a ready student's action generates immediately and opens the issue", async () => {
  await render(); await click();
  expect(mock.generate).toHaveBeenCalledTimes(1);
  expect(mock.push).toHaveBeenCalledWith("/school-office/certificates/issued");
  expect(host.textContent).not.toContain("Ask principal");
});
it("keeps the command ID on retry after an uncertain request", async () => {
  mock.generate.mockRejectedValueOnce(new Error("network"));
  await render(); await click();
  expect(host.textContent).toContain("Try again");
  await click();
  expect(mock.generate.mock.calls[0][0].commandId).toBe(mock.generate.mock.calls[1][0].commandId);
});
it("shows the exact missing field and a source correction link", async () => {
  mock.generate.mockResolvedValue({ ok: false, code: "blocked", blockers: [{ field: "admissionNo", reason: "missing_field" }] });
  await render("/admissions/00000000-0000-4000-8000-000000000011"); await click();
  expect(host.textContent).toContain("Admission / SR number");
  expect(host.querySelector('a[href*="admissions/"]')).not.toBeNull();
  expect(mock.push).not.toHaveBeenCalled();
});
it("guides an office reader to the student record without offering an unauthorized source editor", async () => {
  mock.generate.mockResolvedValue({ ok: false, code: "blocked", blockers: [{ field: "admissionNo", reason: "missing_field" }] });
  await render(); await click();
  expect(host.querySelector('a[href*="admissions/"]')).toBeNull();
  expect(host.querySelector('a[href*="students/"]')).not.toBeNull();
  expect(host.textContent).toContain("Ask an administrator");
});
