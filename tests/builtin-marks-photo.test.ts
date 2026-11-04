import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scene = vi.hoisted(() => ({
  staff: vi.fn(), context: vi.fn(), roster: vi.fn(), find: vi.fn(), update: vi.fn(), commit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ getCurrentStaff: scene.staff }));
vi.mock("@/lib/ai/marks-context", () => ({ marksPhotoContext: scene.context, loadPhotoRoster: scene.roster }));
vi.mock("@/lib/ai/jobs", () => ({ ownedAiJob: scene.find, updateAiJob: scene.update }));
vi.mock("@/vx/screens/exams/marks-save", () => ({ commitMarks: scene.commit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { finalPhotoEntries, readPhotoMark, reviewMarksPhoto } from "@/lib/ai/marks-review";
import { runAiRoute } from "@/lib/ai/route";
import type { MarksPhoto } from "@/lib/ai/photo-schema";

const staff = "00000000-0000-4000-8000-000000000001";
const student1 = "00000000-0000-4000-8000-000000000002";
const student2 = "00000000-0000-4000-8000-000000000003";
const other = "00000000-0000-4000-8000-000000000004";
const jobId = "00000000-0000-4000-8000-000000000005";
const paperId = "00000000-0000-4000-8000-000000000006";
const students = [{ id: student1, roll: "1", name: "Sample One" }, { id: student2, roll: "2", name: "नमूना दो" }];
const rule = { max: 40, step: 0.5 };
const fixture: MarksPhoto = { rows: [
  { roll: "०१", name: "SAMPLE  One", marks: "२१½", rosterRef: "R1", unclear: false },
  { roll: "2", name: "Sample One", marks: "AB", rosterRef: "R2", unclear: false },
] };
const choices = [
  { index: 0, studentId: student1, marks: "21.5", confirmed: false, skip: false },
  { index: 1, studentId: student2, marks: "AB", confirmed: true, skip: false },
];
const origin = "https://one.example";
const req = (body: unknown, requestOrigin = origin) => new NextRequest(origin + "/api/ai/marks-photo/apply", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: requestOrigin }, body: JSON.stringify(body),
});

describe("photo marks decisions", () => {
  it("checks both roll and name, recognizes half marks and absence, and lists missing students", () => {
    const review = reviewMarksPhoto(fixture, students, rule);
    expect(review.rows[0]).toMatchObject({ studentId: student1, issues: [] });
    expect(review.rows[1]).toMatchObject({ studentId: null, issues: ["identity"] });
    expect(review.missing.map((s) => s.id)).toEqual([student2]);
    expect(readPhotoMark("–", rule)).toEqual({ state: "absent", value: null });
    expect(readPhotoMark("२१½", rule)).toEqual({ state: "value", value: 21.5 });
    expect(readPhotoMark("21.5", { max: 40, step: 1 })).toBeNull();
    expect(readPhotoMark("", rule)).toBeNull();
    expect(readPhotoMark("40.5", rule)).toBeNull();
    expect(reviewMarksPhoto({ rows: [{ ...fixture.rows[0], parsedMarks: 7 }] }, students, rule).rows[0].issues).toContain("mark");
    expect(readPhotoMark("-0.5", rule)).toBeNull();
  });

  it("rejects model IDs, duplicate students, missing rows and unconfirmed flags", () => {
    const review = reviewMarksPhoto(fixture, students, rule);
    expect(finalPhotoEntries(review, [choices[0]], rule)).toBeNull();
    expect(finalPhotoEntries(review, [choices[0], { ...choices[1], confirmed: false }], rule)).toBeNull();
    expect(finalPhotoEntries(review, [choices[0], { ...choices[1], studentId: other }], rule)).toBeNull();
    expect(finalPhotoEntries(review, [choices[0], { ...choices[1], studentId: student1 }], rule)).toBeNull();
    const duplicate = reviewMarksPhoto({ rows: [fixture.rows[0], fixture.rows[0]] }, students, rule);
    expect(duplicate.rows.map((row) => row.issues)).toEqual([["duplicate"], ["duplicate"]]);
    expect(finalPhotoEntries(review, [choices[0], { ...choices[1], skip: true }], rule)?.entries).toEqual([
      { studentId: student1, state: "value", value: 21.5 },
    ]);
  });
});

describe("photo marks apply route", () => {
  const body = { paperId, jobId, choices };
  let job: Record<string, unknown>;
  let revision: number;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VPPSONE_BUILTIN_AI_TEST", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VPPSONE_ENV", "dev");
    vi.stubEnv("GEMINI_API_KEY", "unused-test");
    vi.stubEnv("GEMINI_INR_PER_USD", "90");
    revision = 7;
    job = {
      target_revision: 7, status: "draft", raw_output: fixture, roster_stamp: "same",
      parsed_at: new Date().toISOString(), reviewed_data: null, purged_at: null,
    };
    scene.staff.mockResolvedValue({ id: staff });
    scene.context.mockImplementation(async () => ({
      paper: { id: paperId, entry_revision: revision }, session: "TEST-2026-27", rule,
    }));
    scene.roster.mockResolvedValue({ students, stamp: "same" });
    scene.find.mockImplementation(async () => ({ ...job }));
    scene.update.mockImplementation(async (_owner, changes) => ({ ...Object.assign(job, changes) }));
    scene.commit.mockResolvedValue({ ok: true, changed: 2, revision: 8 });
  });

  it("rejects production, cross-site calls, failed assignment and unknown jobs before any write", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await runAiRoute(req(body), "marks-photo", "apply")).status).toBe(404);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await runAiRoute(req(body, "https://other.example"), "marks-photo", "apply")).status).toBe(403);
    scene.context.mockResolvedValueOnce(null);
    expect((await runAiRoute(req(body), "marks-photo", "apply")).status).toBe(404);
    scene.find.mockResolvedValueOnce(null);
    expect((await runAiRoute(req(body), "marks-photo", "apply")).status).toBe(404);
    expect(scene.find).toHaveBeenCalledWith({ staffId: staff, action: "marks-photo", session: "TEST-2026-27", targetId: paperId, id: jobId });
    expect(scene.commit).not.toHaveBeenCalled();
  });

  it("rejects a changed roster or revision and never runs the marks command", async () => {
    scene.roster.mockResolvedValueOnce({ students, stamp: "changed" });
    expect((await runAiRoute(req(body), "marks-photo", "apply")).status).toBe(409);
    revision++;
    expect((await runAiRoute(req(body), "marks-photo", "apply")).status).toBe(409);
    expect(scene.commit).not.toHaveBeenCalled();
  });

  it("seals the review, sends only checked entries to the ordinary draft save and replays its own job", async () => {
    const first = await runAiRoute(req(body), "marks-photo", "apply");
    expect(first.status).toBe(200);
    expect(scene.commit).toHaveBeenCalledWith(staff, {
      commandId: jobId, paperId, kind: "draft", expectedRevision: 7, reason: null,
      entries: [
        { studentId: student1, state: "value", value: 21.5 },
        { studentId: student2, state: "absent", value: null },
      ],
    });
    expect(job.status).toBe("applied");
    revision++;
    expect(await (await runAiRoute(req(body), "marks-photo", "apply")).json()).toEqual({ ok: true, changed: 2, revision: 8 });
    expect(scene.commit).toHaveBeenCalledTimes(1);
  });

  it("reuses the same command after a lost audit response and will not switch the sealed marks", async () => {
    scene.update.mockImplementationOnce(async (_owner, changes) => ({ ...Object.assign(job, changes) }));
    scene.update.mockRejectedValueOnce(new Error("audit unavailable"));
    expect((await runAiRoute(req(body), "marks-photo", "apply")).status).toBe(503);
    revision++;
    const changed = { ...body, choices: [{ ...choices[0], marks: "22" }, choices[1]] };
    expect((await runAiRoute(req(changed), "marks-photo", "apply")).status).toBe(409);
    expect((await runAiRoute(req(body), "marks-photo", "apply")).status).toBe(200);
    expect(scene.commit).toHaveBeenCalledTimes(2);
    expect(scene.commit.mock.calls[0]).toEqual(scene.commit.mock.calls[1]);
  });
});
