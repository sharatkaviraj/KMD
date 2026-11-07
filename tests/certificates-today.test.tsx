import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CertificateRequestRow } from "@/modules/certificates/domain/request-view";
import type { Language } from "@/platform/i18n/language";

/** Today's card of a teacher's own certificate requests (D-542), drawn on the server. */

const state = vi.hoisted(() => ({ rows: [] as unknown[], previewing: null as unknown, fail: false, scopes: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, back() {}, refresh() {}, prefetch() {} }), usePathname: () => "/teach", useSearchParams: () => new URLSearchParams(), useLinkStatus: () => ({ pending: false }) }));
vi.mock("@/modules/certificates/data/requests", () => ({
  listCertificateRequests: async (scope: string) => {
    state.scopes.push(scope);
    if (state.fail) throw new Error("Certificate requests unavailable");
    return state.rows;
  },
}));
vi.mock("@/vx/view-as", () => ({ getViewer: async () => ({ previewing: state.previewing }) }));

import { MyCertificateRequestsToday } from "@/vx/screens/teach/ui/certificates-today";

const child = "11111111-1111-4111-8111-111111111111";
const other = "33333333-3333-4333-8333-333333333333";

function row(over: Partial<CertificateRequestRow>): CertificateRequestRow {
  return {
    id: "44444444-4444-4444-8444-444444444444", studentId: child, sessionLabel: "TEST-2026-27", classId: "c1", kind: "study",
    purpose: null, extras: {}, note: null, requestedBy: "t1", requestedByName: "QA Teacher", requestedAt: "2026-11-07T10:00:00Z",
    state: "waiting", decidedByName: null, decidedAt: null, declineReason: null, issueId: null, serial: null, issueStatus: null,
    issueReady: false, signed: false, studentName: "TEST Child One", admissionNo: "TEST-1", classLabel: "Class 6", mine: true,
    fatherName: null, dateOfBirth: null, ...over,
  };
}

async function render(language: Language = "en"): Promise<string> {
  const node = await MyCertificateRequestsToday({ sessionLabel: "TEST-2026-27", language });
  return node ? renderToStaticMarkup(node) : "";
}

beforeEach(() => {
  state.rows = [];
  state.previewing = null;
  state.fail = false;
  state.scopes = [];
});

describe("Today's certificate requests", () => {
  it("shows nothing until the teacher has asked for one", async () => {
    expect(await render()).toBe("");
    expect(state.scopes).toEqual(["mine"]);
  });

  it("puts a signed copy near the top, and every row opens that child's page", async () => {
    state.rows = [
      row({ state: "approved", issueReady: true, serial: "VPPS/SC/TEST/0001", decidedAt: "2026-11-07T11:00:00Z" }),
      row({ id: "55555555-5555-4555-8555-555555555555", studentId: other, studentName: "TEST Child Two", kind: "character" }),
    ];
    const html = await render();
    expect(html).toContain("order:2");
    expect(html).toContain("My certificate requests");
    expect(html).toContain("1 · Signed and ready");
    expect(html).toContain("Ready: open to download or send to the parent");
    expect(html).toContain("Waiting for approval");
    expect(html).toContain(`href="/teach/class?student=${child}"`);
    expect(html).toContain(`href="/teach/class?student=${other}"`);
    // The signed copy itself is fetched on the child's page, never from here.
    expect(html).not.toContain("/pdf");
  });

  it("says why the office could not give one", async () => {
    state.rows = [row({ state: "declined", declineReason: "Details are not in the register yet", decidedAt: "2026-11-07T11:00:00Z" })];
    const html = await render();
    expect(html).toContain("order:3");
    expect(html).toContain("Not approved: Details are not in the register yet");
  });

  it("speaks the teacher's own language", async () => {
    state.rows = [row({})];
    expect(await render("hi")).toContain("मेरे माँगे प्रमाण पत्र");
    const both = await render("both");
    expect(both).toContain("My certificate requests");
    expect(both).toContain("मेरे माँगे प्रमाण पत्र");
  });

  it("lists five and says where the rest are", async () => {
    state.rows = Array.from({ length: 7 }, (_, index) => row({ id: `44444444-4444-4444-8444-44444444444${index}`, studentName: `TEST Child ${index}` }));
    const html = await render();
    expect(html.match(/tc-sj/g)).toHaveLength(5);
    expect(html).toContain("2 more: each one is on that child&#x27;s page");
  });

  it("stays out of the way while an admin previews another role, or when the list cannot be read", async () => {
    state.rows = [row({})];
    state.previewing = { role: "teacher" };
    expect(await render()).toBe("");
    expect(state.scopes).toEqual([]);
    state.previewing = null;
    state.fail = true;
    expect(await render()).toBe("");
  });
});
