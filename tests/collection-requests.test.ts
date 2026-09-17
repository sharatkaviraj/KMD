import { describe, expect, it } from "vitest";

import type { CollectionField } from "@/modules/collection/domain/fields";
import {
  checkRequestAccess,
  completeness,
  isAnswered,
  isPublicTokenPath,
  outstandingRows,
  requestSchema,
  requestUrl,
  staffUrl,
  waMeLink,
  type RollRow,
} from "@/modules/collection/domain/requests";
import {
  byReviewOrder,
  checkDocument,
  documentPath,
  humanSize,
  isChange,
  mayReplace,
  pendingCount,
  sharedPhoneCount,
  splitByChange,
  type Submission,
} from "@/modules/collection/domain/review";
import {
  bySendOrder,
  checkPhone,
  checkRendered,
  mayDispatch,
  placeholdersIn,
  queuedCount,
  render,
  type MessageSend,
} from "@/modules/collection/domain/messages";

const field = (key: string): CollectionField => ({
  id: key,
  key,
  labelHi: key,
  labelEn: key,
  inputType: "text",
  mode: "confirm",
  exactLen: null,
  pattern: null,
  maxValue: null,
  options: null,
  feeColumn: null,
  helpHi: null,
  helpEn: null,
  isActive: true,
  sortOrder: 0,
});

const row = (over: Partial<RollRow> = {}): RollRow => ({
  studentId: "s1",
  rollNo: "1",
  fullName: "Test Child",
  fatherName: null,
  current: {},
  answered: {},
  ...over,
});

/* ------------------------------------------------------- authorization */

describe("checkRequestAccess()", () => {
  it("opens only an open request", () => {
    expect(checkRequestAccess({ status: "open" }).ok).toBe(true);
  });

  it("refuses a draft and a closed one alike", () => {
    // From outside the two are the same 404: telling a stranger "that link
    // exists but is closed" is telling them their guess was right.
    expect(checkRequestAccess({ status: "draft" }).ok).toBe(false);
    expect(checkRequestAccess({ status: "closed" }).ok).toBe(false);
  });

  /**
   * The rule worth stating out loud: a deadline is a deadline for the teacher
   * and the office, not an authorization boundary. A teacher finishing on
   * Sunday what was due Friday is the normal case, and a link that locked
   * itself would turn her work into a phone call.
   */
  it("does not care about the due date", () => {
    expect(checkRequestAccess({ status: "open" }).ok).toBe(true);
  });
});

describe("isPublicTokenPath()", () => {
  it.each(["/r", "/r/abc", "/t/abc", "/w/abc"])("lets %s through", (path) => {
    expect(isPublicTokenPath(path)).toBe(true);
  });

  it.each(["/", "/dashboard", "/review", "/rabbit", "/teach"])(
    "does not let %s through",
    (path) => {
      expect(isPublicTokenPath(path)).toBe(false);
    },
  );
});

describe("the links", () => {
  it("are absolute, because they are pasted into WhatsApp", () => {
    expect(requestUrl("https://x.test", "abc")).toBe("https://x.test/r/abc");
    expect(staffUrl("https://x.test", "abc")).toBe("https://x.test/t/abc");
  });

  it("build a wa.me link that sends nothing by itself", () => {
    const link = waMeLink("9876543210", "Hello there");
    expect(link).toBe("https://wa.me/919876543210?text=Hello%20there");
  });
});

/* -------------------------------------------------------- completeness */

describe("completeness()", () => {
  const fields = [field("a"), field("b")];

  it("counts child by field, not child by child", () => {
    // A progress line counting children would sit at zero until the first
    // child was finished completely.
    const roll = [row({ studentId: "s1", answered: { a: "x" } }), row({ studentId: "s2" })];
    const done = completeness(roll, fields);

    expect(done).toEqual({
      expected: 4,
      answered: 1,
      students: 2,
      studentsDone: 0,
      percent: 25,
    });
  });

  it("counts a child as done only when every field is in", () => {
    const roll = [row({ answered: { a: "x", b: "y" } })];
    expect(completeness(roll, fields).studentsDone).toBe(1);
  });

  it("treats a recorded blank as answered", () => {
    // "This is right" is a real answer — the teacher looked — and it arrives
    // as a present key with a null value.
    const roll = [row({ answered: { a: null } })];
    expect(isAnswered(roll[0], fields[0])).toBe(true);
    expect(completeness(roll, [fields[0]]).percent).toBe(100);
  });

  it("does not divide by zero on an empty request", () => {
    expect(completeness([], []).percent).toBe(0);
    expect(completeness([row()], []).percent).toBe(0);
  });
});

describe("outstandingRows()", () => {
  it("is who the office is still waiting on", () => {
    const fields = [field("a"), field("b")];
    const roll = [
      row({ studentId: "done", answered: { a: "x", b: "y" } }),
      row({ studentId: "partly", answered: { a: "x" } }),
      row({ studentId: "none" }),
    ];

    expect(outstandingRows(roll, fields).map((entry) => entry.studentId)).toEqual([
      "partly",
      "none",
    ]);
  });
});

describe("requestSchema", () => {
  const valid = {
    titleHi: "फ़ोन नंबर",
    titleEn: "Phone numbers",
    classId: "0192e5b2-0000-7000-8000-000000000001",
    assignedStaffId: "",
    fieldIds: ["0192e5b2-0000-7000-8000-000000000002"],
    dueDate: "2026-09-30",
    reasonHi: "",
    reasonEn: "",
  };

  it("accepts a whole request", () => {
    const parsed = requestSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.assignedStaffId).toBeNull();
  });

  it("refuses one that asks for nothing", () => {
    expect(requestSchema.safeParse({ ...valid, fieldIds: [] }).success).toBe(false);
  });

  it("refuses a due date that is not a date", () => {
    expect(requestSchema.safeParse({ ...valid, dueDate: "soon" }).success).toBe(false);
  });

  it("accepts no due date at all", () => {
    expect(requestSchema.safeParse({ ...valid, dueDate: "" }).success).toBe(true);
  });
});

/* --------------------------------------------------------------- review */

const submission = (over: Partial<Submission> = {}): Submission => ({
  id: "x1",
  requestId: "r1",
  requestTitleHi: "शीर्षक",
  requestTitleEn: "Title",
  classLabel: "Class 6",
  studentId: "s1",
  studentName: "Test Child",
  rollNo: "1",
  fieldId: "f1",
  fieldKey: "guardian_phone",
  fieldLabelHi: "फ़ोन",
  fieldLabelEn: "Phone",
  value: "9876543210",
  previousValue: "9812345678",
  status: "pending",
  submittedAt: "2026-09-17T10:00:00Z",
  submittedByName: "Test Teacher",
  decidedByName: null,
  decidedAt: null,
  decisionNote: null,
  ...over,
});

describe("isChange()", () => {
  it("is true when something new was typed", () => {
    expect(isChange(submission())).toBe(true);
  });

  it("is false when the answer is what was already held", () => {
    expect(isChange(submission({ value: "9812345678" }))).toBe(false);
  });

  it("is false for a blank, which means confirmed and not erased", () => {
    expect(isChange(submission({ value: null }))).toBe(false);
    expect(isChange(submission({ value: "  " }))).toBe(false);
  });
});

describe("splitByChange()", () => {
  it("separates the two halves the office reads differently", () => {
    // Four hundred confirmations approved one at a time is a queue nobody
    // finishes.
    const rows = [
      submission({ id: "changed" }),
      submission({ id: "same", value: "9812345678" }),
      submission({ id: "blank", value: null }),
    ];

    const split = splitByChange(rows);
    expect(split.changes.map((entry) => entry.id)).toEqual(["changed"]);
    expect(split.confirmations.map((entry) => entry.id)).toEqual(["same", "blank"]);
  });
});

describe("sharedPhoneCount()", () => {
  const owners = new Map([["9876543210", ["s1", "s2", "s3"]]]);

  it("counts the other children on the same number", () => {
    // Neutral, and shown only to the office: siblings share a parent's number.
    expect(
      sharedPhoneCount("9876543210", { inputType: "tel" }, owners, "s1"),
    ).toBe(2);
  });

  it("is zero for a field that is not a phone", () => {
    expect(
      sharedPhoneCount("9876543210", { inputType: "text" }, owners, "s1"),
    ).toBe(0);
  });

  it("is zero for a blank", () => {
    expect(sharedPhoneCount(null, { inputType: "tel" }, owners, "s1")).toBe(0);
  });
});

describe("mayReplace()", () => {
  /**
   * The rule the whole tool's credibility rests on: an approved human answer
   * is never quietly undone by somebody re-importing last term's export.
   */
  it("never lets an import overwrite a person", () => {
    expect(mayReplace({ incoming: "import", held: "teacher" }).write).toBe(false);
    expect(mayReplace({ incoming: "import", held: "office" }).write).toBe(false);
  });

  it("lets a person overwrite anything", () => {
    expect(mayReplace({ incoming: "teacher", held: "import" }).write).toBe(true);
    expect(mayReplace({ incoming: "office", held: "teacher" }).write).toBe(true);
  });

  it("lets an import fill a blank", () => {
    expect(mayReplace({ incoming: "import", held: null }).write).toBe(true);
  });

  it("lets an import replace an import", () => {
    expect(mayReplace({ incoming: "import", held: "import" }).write).toBe(true);
  });

  it("explains a refusal in both languages", () => {
    const verdict = mayReplace({ incoming: "import", held: "teacher" });
    expect(verdict.write).toBe(false);
    if (verdict.write) return;
    expect(verdict.reason.hi).toBeTruthy();
    expect(verdict.reason.en).toBeTruthy();
  });
});

describe("byReviewOrder()", () => {
  it("puts everything waiting above everything decided", () => {
    const rows = [
      submission({ id: "decided", status: "accepted", submittedAt: "2026-09-20T00:00:00Z" }),
      submission({ id: "waiting", submittedAt: "2026-09-01T00:00:00Z" }),
    ];

    expect([...rows].sort(byReviewOrder).map((entry) => entry.id)).toEqual([
      "waiting",
      "decided",
    ]);
  });

  it("counts what is still waiting", () => {
    expect(
      pendingCount([submission(), submission({ status: "accepted" })]),
    ).toBe(1);
  });
});

/* ------------------------------------------------------------ documents */

describe("checkDocument()", () => {
  it("accepts a PDF and a photograph", () => {
    expect(checkDocument({ contentType: "application/pdf", byteSize: 1000 }).ok).toBe(
      true,
    );
    expect(checkDocument({ contentType: "image/jpeg", byteSize: 1000 }).ok).toBe(true);
  });

  it("refuses anything else", () => {
    expect(
      checkDocument({ contentType: "application/zip", byteSize: 1000 }).ok,
    ).toBe(false);
  });

  it("refuses an empty file and one over the limit", () => {
    expect(checkDocument({ contentType: "image/png", byteSize: 0 }).ok).toBe(false);
    expect(
      checkDocument({ contentType: "image/png", byteSize: 11 * 1024 * 1024 }).ok,
    ).toBe(false);
  });
});

describe("documentPath()", () => {
  const base = {
    sessionLabel: "2026-27",
    studentId: "child-1",
    id: "doc-1",
  };

  it("is keyed by child and by a random id, never by the filename", () => {
    // Two parents both sending "aadhaar.pdf" must not collide, and a path a
    // stranger could guess is a document a stranger could ask for.
    expect(documentPath({ ...base, fileName: "aadhaar.pdf" })).toBe(
      "2026-27/child-1/doc-1.pdf",
    );
  });

  it("keeps the extension and nothing else from the name", () => {
    expect(documentPath({ ...base, fileName: "../../etc/passwd.PDF" })).toBe(
      "2026-27/child-1/doc-1.pdf",
    );
  });

  it("copes with no extension at all", () => {
    expect(documentPath({ ...base, fileName: "scan" })).toBe("2026-27/child-1/doc-1");
  });
});

describe("humanSize()", () => {
  it("reads the way a person would say it", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(2048)).toBe("2 KB");
    expect(humanSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

/* ------------------------------------------------------------- messages */

describe("render()", () => {
  it("fills the numbered blanks", () => {
    expect(render("Dear {{1}}, about {{2}}.", ["Asha", "fees"])).toBe(
      "Dear Asha, about fees.",
    );
  });

  it("leaves a blank standing rather than emptying it", () => {
    // "Dear {{2}}" is obviously unfinished; "Dear " looks sent and is not
    // recoverable.
    expect(render("Dear {{1}}, about {{2}}.", ["Asha"])).toBe(
      "Dear Asha, about {{2}}.",
    );
  });

  it("finds the placeholders a body uses", () => {
    expect(placeholdersIn("{{2}} and {{1}} and {{2}}")).toEqual([1, 2]);
    expect(placeholdersIn("no blanks")).toEqual([]);
  });
});

describe("checkRendered()", () => {
  it("refuses a message with a blank left in it", () => {
    // The sort of message a school gets remembered for.
    expect(checkRendered("Dear {{2}}, your fee is due.").ok).toBe(false);
  });

  it("refuses an empty message", () => {
    expect(checkRendered("   ").ok).toBe(false);
  });

  it("accepts a finished one", () => {
    expect(checkRendered("Dear Asha, your fee is due.").ok).toBe(true);
  });
});

describe("checkPhone()", () => {
  it("accepts a mobile number however it was typed", () => {
    expect(checkPhone("+91 98765 43210").ok).toBe(true);
  });

  it("refuses a short one and a landline", () => {
    expect(checkPhone("98765").ok).toBe(false);
    expect(checkPhone("1234567890").ok).toBe(false);
  });
});

const send = (over: Partial<MessageSend> = {}): MessageSend => ({
  id: "m1",
  templateId: "t1",
  templateCode: "code",
  templateLabelHi: "नाम",
  templateLabelEn: "Name",
  audience: "staff",
  toPhone: "9876543210",
  toName: null,
  studentId: null,
  requestId: null,
  staffProfileId: null,
  variables: [],
  renderedHi: "नमस्ते",
  renderedEn: "Hello",
  status: "queued",
  providerMessageId: null,
  error: null,
  requestedByName: null,
  requestedAt: "2026-09-17T10:00:00Z",
  sentAt: null,
  ...over,
});

describe("mayDispatch()", () => {
  /**
   * D-10 in executable form. Not because an automatic send is hard, but
   * because the day one goes out wrong it goes out wrong to four hundred
   * families at once, and there is no recall.
   */
  it("never dispatches a parent-facing message", () => {
    const verdict = mayDispatch(send({ audience: "parent" }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason.en).toContain("person");
  });

  it("refuses to send the same message twice", () => {
    expect(mayDispatch(send({ status: "sent" })).ok).toBe(false);
  });

  it("refuses a cancelled one", () => {
    expect(mayDispatch(send({ status: "cancelled" })).ok).toBe(false);
  });

  it("allows a staff message that is still queued", () => {
    expect(mayDispatch(send()).ok).toBe(true);
  });

  it("allows retrying one that failed", () => {
    expect(mayDispatch(send({ status: "failed" })).ok).toBe(true);
  });
});

describe("bySendOrder()", () => {
  it("puts what has to go out above what already has", () => {
    const rows = [
      send({ id: "sent", status: "sent" }),
      send({ id: "failed", status: "failed" }),
      send({ id: "queued", status: "queued" }),
    ];

    expect([...rows].sort(bySendOrder).map((entry) => entry.id)).toEqual([
      "queued",
      "failed",
      "sent",
    ]);
  });

  it("counts what is still outstanding", () => {
    expect(
      queuedCount([send(), send({ status: "draft" }), send({ status: "sent" })]),
    ).toBe(2);
  });
});
