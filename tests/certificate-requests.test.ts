import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  approvalCommandSeed, requestCreateSchema, requestDeclineSchema, requestErrorCode, requestListSchema, requestStage, uuidFromDigest,
} from "@/modules/certificates/domain/request";

/** Certificate requests (D-542): what a teacher may send, and how each answer reads back. */

const student = "11111111-1111-4111-8111-111111111111";
const command = "22222222-2222-4222-8222-222222222222";
const ask = { studentId: student, sessionLabel: "TEST-2026-27", kind: "study", commandId: command };

describe("asking for a certificate", () => {
  it("takes a study certificate with a purpose and a note", () => {
    expect(requestCreateSchema.safeParse({ ...ask, purpose: "School admission", note: "Parent asked today" }).success).toBe(true);
  });
  it("needs a conduct grade for a character certificate, and only there", () => {
    expect(requestCreateSchema.safeParse({ ...ask, kind: "character" }).success).toBe(false);
    expect(requestCreateSchema.safeParse({ ...ask, kind: "character", conduct: "good" }).success).toBe(true);
    expect(requestCreateSchema.safeParse({ ...ask, conduct: "good" }).success).toBe(false);
  });
  it("prints no purpose on a date-of-birth certificate", () => {
    expect(requestCreateSchema.safeParse({ ...ask, kind: "dob" }).success).toBe(true);
    expect(requestCreateSchema.safeParse({ ...ask, kind: "dob", purpose: "Passport" }).success).toBe(false);
  });
  it("never asks for a TC, and refuses markup, unknown fields and odd sessions", () => {
    expect(requestCreateSchema.safeParse({ ...ask, kind: "tc" }).success).toBe(false);
    expect(requestCreateSchema.safeParse({ ...ask, note: "<b>now</b>" }).success).toBe(false);
    expect(requestCreateSchema.safeParse({ ...ask, issuedBy: student }).success).toBe(false);
    expect(requestCreateSchema.safeParse({ ...ask, sessionLabel: "2026" }).success).toBe(false);
  });
  it("needs a reason of a few letters to decline", () => {
    expect(requestDeclineSchema.safeParse({ requestId: student, reason: "no" }).success).toBe(false);
    expect(requestDeclineSchema.safeParse({ requestId: student, reason: "Date of birth differs from the register" }).success).toBe(true);
  });
  it("lists one child's requests only when the child is named", () => {
    expect(requestListSchema.safeParse({ scope: "student", session: "2026-27" }).success).toBe(false);
    expect(requestListSchema.safeParse({ scope: "student", session: "2026-27", student }).success).toBe(true);
    expect(requestListSchema.safeParse({ scope: "approver", session: "2026-27" }).success).toBe(false);
  });
});

describe("what the teacher sees", () => {
  it("reads waiting, ready, declined, and gone once the office cancels the copy", () => {
    expect(requestStage({ state: "waiting", issueReady: false })).toBe("waiting");
    expect(requestStage({ state: "approved", issueReady: true })).toBe("ready");
    expect(requestStage({ state: "approved", issueReady: false })).toBe("gone");
    expect(requestStage({ state: "declined", issueReady: false })).toBe("declined");
    expect(requestStage({ state: "withdrawn", issueReady: false })).toBe("gone");
  });
  it("turns the database's refusals into codes, and anything else into a retry", () => {
    expect(requestErrorCode("certificate_request:not_enrolled")).toBe("not_enrolled");
    expect(requestErrorCode("ERROR: certificate_request:decided (P0001)")).toBe("decided");
    expect(requestErrorCode("certificate_request:something_new")).toBe("unavailable");
    expect(requestErrorCode(undefined)).toBe("unavailable");
  });
});

describe("approving twice", () => {
  it("derives one certificate command per request and approver, so a retry replays it", () => {
    const id = (request: string, actor: string) => uuidFromDigest(createHash("sha256").update(approvalCommandSeed(request, actor)).digest("hex"));
    const first = id(student, command);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id(student, command)).toBe(first);
    expect(id(student, student)).not.toBe(first);
    expect(id(command, command)).not.toBe(first);
  });
});
