import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The AI report's three routes: who may take a part, for which year, and how
 * a refusal reads. The parts themselves are mocked; synthetic staff only.
 */

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  assertPermission: vi.fn(),
  buildSchoolWorkbook: vi.fn(),
  logAiReport: vi.fn(),
  buildFeesWorkbook: vi.fn(),
  readPhotoPage: vi.fn(),
}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: mocks.assertPermission }));
vi.mock("@/modules/ai-report/data/school-workbook", () => ({ buildSchoolWorkbook: mocks.buildSchoolWorkbook, logAiReport: mocks.logAiReport }));
vi.mock("@/modules/ai-report/data/fees-part", () => ({ buildFeesWorkbook: mocks.buildFeesWorkbook }));
vi.mock("@/modules/ai-report/data/photos", () => ({ readPhotoPage: mocks.readPhotoPage }));

import { AiReportError } from "@/modules/ai-report/data/access";
import { GET as feesGET } from "@/app/api/reports/ai/fees/route";
import { GET as photosGET } from "@/app/api/reports/ai/photos/route";
import { GET as schoolGET } from "@/app/api/reports/ai/school/route";

const admin = { id: "staff-1", userId: "user-1", role: "admin", isActive: true, isTestAccount: true, displayName: "Synthetic admin" };
const ask = (route: string, query: string) => new Request(`https://one.vpps.co.in/api/reports/ai/${route}?${query}`);
const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

beforeEach(() => {
  mocks.assertPermission.mockResolvedValue(admin);
  mocks.buildSchoolWorkbook.mockResolvedValue({ bytes, rows: 12, students: 3, sheets: 2 });
  mocks.buildFeesWorkbook.mockResolvedValue({ bytes, asOf: "2026-11-07T05:00:00.000Z", source: "one" });
  mocks.readPhotoPage.mockResolvedValue({ source: "none", photos: [], skipped: [], next: null, total: 0, reason: "synthetic" });
  mocks.logAiReport.mockResolvedValue(undefined);
});
afterEach(() => vi.resetAllMocks());

describe("the AI report's routes", () => {
  it("asks for the AI report permission and sends One's workbook, uncached, and logs who took it", async () => {
    const response = await schoolGET(ask("school", "session=TEST-2026-27"));
    expect(mocks.assertPermission).toHaveBeenCalledWith("reports:ai");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("x-ai-report-students")).toBe("3");
    expect(mocks.logAiReport).toHaveBeenCalledWith(admin, "TEST-2026-27", 12, "One records");
  });

  it("refuses a missing or made-up session before reading anything", async () => {
    for (const query of ["", "session=2026", "session=PROD-2026-27", "session=2026-27%27"]) {
      const response = await schoolGET(ask("school", query));
      expect(response.status, query).toBe(400);
    }
    expect(mocks.buildSchoolWorkbook).not.toHaveBeenCalled();
  });

  it("keeps a test account to rehearsal years, as everywhere else", async () => {
    const response = await schoolGET(ask("school", "session=2026-27"));
    expect(response.status).toBe(403);
    expect(mocks.buildSchoolWorkbook).not.toHaveBeenCalled();
  });

  it("says a refusal in words, never the error's own text", async () => {
    mocks.assertPermission.mockRejectedValue(new Error("Permission denied: reports:ai"));
    const denied = await schoolGET(ask("school", "session=TEST-2026-27"));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: { code: "forbidden", message: "This account cannot take that part of the report." } });

    mocks.assertPermission.mockResolvedValue(admin);
    mocks.buildFeesWorkbook.mockRejectedValue(new AiReportError("not_available", "internal detail"));
    const unavailable = await feesGET(ask("fees", "session=TEST-2026-27"));
    expect(unavailable.status).toBe(409);
    expect(JSON.stringify(await unavailable.json())).not.toContain("internal detail");
  });

  it("refuses a photograph cursor that is not an id", async () => {
    const response = await photosGET(ask("photos", "session=TEST-2026-27&after=../../x"));
    expect(response.status).toBe(400);
    expect(mocks.readPhotoPage).not.toHaveBeenCalled();
  });

  it("sends a page of photographs as JSON, uncached", async () => {
    const response = await photosGET(ask("photos", "session=TEST-2026-27"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toMatchObject({ source: "none" });
  });
});
