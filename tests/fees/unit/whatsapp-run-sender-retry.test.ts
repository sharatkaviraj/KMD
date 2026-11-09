import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReminderCandidate, ReminderFilters } from "@/modules/whatsapp/domain/fee-reminders";

/**
 * A failed send is retried, not reported as "already had today's reminder".
 *
 * Today's slot is unique per family, notice and number, and a FAILED attempt
 * held it — so the next press claimed nothing and told the office the family
 * had been reminded when nothing reached them.
 *
 * Ported from the fees app: 1b932785 (the retry) and 31e85d27 (#86, a test
 * session resends a SENT row too). Names and number are test values (rule 6).
 */

vi.mock("server-only", () => ({}));
const send = vi.fn();
vi.mock("@/modules/whatsapp/data/parent-send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/whatsapp/data/parent-send")>()),
  sendParentTemplate: (args: unknown) => send(args),
}));
vi.mock("@/modules/whatsapp/data/campaign-store", () => ({
  openRun: async () => "run-1",
  closeRun: async () => undefined,
}));
vi.mock("@/modules/activity/data/events", () => ({
  recordActivity: async () => undefined,
}));

import { DELIVERY_UNKNOWN_PREFIX } from "@/modules/whatsapp/data/parent-send";
import { executeReminderRun } from "@/modules/whatsapp/data/run-sender";

/**
 * Every insert collides; an update finds the row only when its status filter
 * matches and, when the update carries the error-message filter, the row is
 * not one whose delivery is unknown. The second argument is either what a
 * report said about today's row ("failed" / "delivered") or the row's own
 * error message.
 */
type EarlierSend = {
  student_id: string;
  sent_on: string;
  status?: string;
  error_message?: string | null;
  notice_kind?: string;
  campaign_name?: string;
  id?: string;
};

function takenSlotClient(
  existingStatus: "failed" | "sent",
  existing: string | null = null,
  earlierSends: EarlierSend[] = [],
) {
  const existingDelivery = existing === "failed" || existing === "delivered" ? existing : null;
  const existingError = existingDelivery ? null : existing;
  const updates: Array<Record<string, unknown>> = [];
  const pageReads: Array<[number, number]> = [];
  return {
    updates,
    pageReads,
    from() {
      const builder = {
        // One's cross-campaign read (critique0 #11): every send this family
        // had in the window, whatever its campaign. Applies the filters it is
        // given to the rows above, and caps a response at 1,000 rows the way
        // PostgREST does, so a read that forgets to page loses rows here too.
        select() {
          let rows = earlierSends.map((row, index) => ({
            id: row.id ?? `e-${String(index).padStart(5, "0")}`,
            status: "sent",
            error_message: null,
            notice_kind: "reminder",
            ...row,
          }));
          let range: [number, number] | null = null;
          const chain = {
            in: (column: string, values: unknown[]) => {
              rows = rows.filter((row) => values.includes((row as Record<string, unknown>)[column]));
              return chain;
            },
            eq: (column: string, value: unknown) => {
              rows = rows.filter((row) => (row as Record<string, unknown>)[column] === value);
              return chain;
            },
            gte: (column: string, value: string) => {
              rows = rows.filter((row) => String((row as Record<string, unknown>)[column]) >= value);
              return chain;
            },
            order: (column: string, options?: { ascending?: boolean }) => {
              const sign = options?.ascending === false ? -1 : 1;
              rows = [...rows].sort((a, b) => {
                const left = String((a as Record<string, unknown>)[column]);
                const right = String((b as Record<string, unknown>)[column]);
                return left === right ? 0 : left < right ? -sign : sign;
              });
              return chain;
            },
            range: (from: number, to: number) => {
              range = [from, to];
              pageReads.push([from, to]);
              return chain;
            },
            then: (resolve: (value: { data: typeof rows; error: null }) => unknown) => {
              const page = range ? rows.slice(range[0], range[1] + 1) : rows;
              return resolve({ data: page.slice(0, 1000), error: null });
            },
          };
          return chain;
        },
        insert() {
          const chain = {
            select: () => chain,
            single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }),
            then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
          };
          return chain;
        },
        update(values: Record<string, unknown>) {
          updates.push(values);
          const filters: Array<[string, unknown]> = [];
          const chain = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return chain;
            },
            in(column: string, values: unknown[]) {
              filters.push([column, values]);
              return chain;
            },
            // The live reclaim: a definite refusal (never a delivery-unknown
            // one in a real session), or a sent row WhatsApp reported
            // undelivered — one `or` expression (run-sender.ts).
            or(expression: string) {
              filters.push(["or", expression]);
              return chain;
            },
            select: async () => {
              const statusMatches = filters.some(
                ([c, v]) =>
                  (c === "status" &&
                    (v === existingStatus || (Array.isArray(v) && v.includes(existingStatus)))) ||
                  (c === "or" &&
                    (existingStatus === "failed" ||
                      (existingStatus === "sent" &&
                        existingDelivery === "failed" &&
                        String(v).includes("delivery_status.eq.failed")))),
              );
              const orFilter = filters.find(([c]) => c === "or")?.[1] as string | undefined;
              const unknownExcluded =
                orFilter?.includes(`not.like.${DELIVERY_UNKNOWN_PREFIX.trim()}*`) === true &&
                existingError?.startsWith(DELIVERY_UNKNOWN_PREFIX.trim()) === true;
              const matches = statusMatches && !unknownExcluded;
              return { data: matches ? [{ id: "row-1" }] : [], error: null };
            },
            then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
          };
          return chain;
        },
      };
      return builder;
    },
  };
}

function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    studentId: "s1",
    admissionNo: "TEST-001",
    studentName: "Test Child One",
    parentName: "Test Parent One",
    studentClass: "Class 2",
    classId: null,
    classSortOrder: 5,
    transportRoute: null,
    transportFeeAmount: 0,
    destination: "+910000000001",
    usedMotherPhone: false,
    dueAmount: 13250,
    totalPaid: 0,
    balanceDue: 13250,
    prevYearBalance: 0,
    prevSessionLabel: null,
    sentToday: null,
    cadence: "weekly",
    snoozedUntil: null,
    profile: "standard",
    profileSource: "suggested",
    profileReason: "Late on installment 1",
    lastSentOn: null,
    lateFeeApplied: 0,
    lateFeeFeesPending: 0,
    lateFeeInstallments: [],
    owedInstallments: [],
    overdueInstallments: [],
    promisedOn: null,
    promiseContactedOn: null,
    preferredLanguage: null,
    secondaryDestination: null,
    sentCount: 0,
    includedByHand: false,
    missingFacts: [],
    missingFactsLabel: "",
    ...overrides,
    // The family follows the number unless a test links siblings itself.
    familyKey: overrides.familyKey ?? overrides.destination ?? "+910000000001",
  };
}

function filters(overrides: Partial<ReminderFilters> = {}): ReminderFilters {
  return {
    sessionLabel: "TEST-2026-27",
    installments: [1, 2],
    lastYear: false,
    installmentMatch: "all",
    paid: "any",
    minDueAmount: 1,
    lateFee: "any",
    promise: "skip_open",
    skipOverdue: false,
    classId: null,
    includeRte: false,
    profiles: ["on_time", "standard", "chronic"],
    includeStudentIds: [],
    excludeStudentIds: [],
    situation: "fee_due",
    language: "hi",
    lastDate: "20-10-2026",
    lateFeeAmount: 1000,
    lateFeeBasis: "per_installment",
    lateFeeSource: "custom",
    policyLateFeeAmount: 1000,
    preDueWindowDays: 10,
    ...overrides,
  };
}


beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ ok: true, status: 200, messageId: "msg-1" });
});

const runWith = (client: ReturnType<typeof takenSlotClient>, sessionLabel = "2026-27") =>
  executeReminderRun({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: client as any,
    candidates: [candidate()],
    filters: filters({ sessionLabel }),
    sessionLabel,
    today: "2026-10-27",
    lastDateIso: "2026-10-30",
    campaignName: "vpps_app_fee_due_hi_v6",
    campaignId: null,
    staffId: "staff-1",
    source: "manual",
    scheduledFor: null,
  });

describe("a family whose send failed earlier today", () => {
  it("is sent on the retry, reusing the failed row", async () => {
    const client = takenSlotClient("failed");
    const outcome = await runWith(client);

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.sent).toBe(1);
    expect(outcome.alreadySentToday).toBe(0);
    expect(client.updates[0]).toMatchObject({ status: "pending" });
  });

  it("is NOT sent again when today's message actually went", async () => {
    const outcome = await runWith(takenSlotClient("sent"));

    expect(send).not.toHaveBeenCalled();
    expect(outcome.alreadySentToday).toBe(1);
  });

  it("is NOT sent again when a report says it was delivered", async () => {
    const outcome = await runWith(takenSlotClient("sent", "delivered"));

    expect(send).not.toHaveBeenCalled();
    expect(outcome.alreadySentToday).toBe(1);
  });

  it("IS sent again when WhatsApp reported today's message undelivered", async () => {
    // Accepted by AiSensy, then not delivered: it reached nobody, exactly like
    // a refusal. Until 2026-10-30 the row read "sent" and the family was told
    // they had today's reminder.
    const client = takenSlotClient("sent", "failed");
    const outcome = await runWith(client);

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.sent).toBe(1);
    expect(client.updates[0]).toMatchObject({ status: "pending" });
  });

  it("records the cause with the outcome when the retry is refused", async () => {
    send.mockResolvedValueOnce({ ok: false, status: 400, error: "Template params does not match the campaign" });
    const client = takenSlotClient("failed");
    await runWith(client);

    expect(client.updates.at(-1)).toMatchObject({ status: "failed", failure_cause: "template" });
  });
});

describe("a family whose earlier send got no clear answer", () => {
  // A timeout or a 5xx can come after AiSensy took the message. Sending again
  // could message a real parent twice in one day, so the row stays claimed.
  it("is NOT sent again in a real session", async () => {
    const outcome = await runWith(
      takenSlotClient("failed", `${DELIVERY_UNKNOWN_PREFIX}fetch failed`),
    );

    expect(send).not.toHaveBeenCalled();
    expect(outcome.alreadySentToday).toBe(1);
  });

  it("is sent again in a test session, which has no parents", async () => {
    const outcome = await runWith(
      takenSlotClient("failed", `${DELIVERY_UNKNOWN_PREFIX}fetch failed`),
      "TEST-2026-27",
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.sent).toBe(1);
  });

  it("records a network failure with the unknown-delivery prefix", async () => {
    send.mockResolvedValue({ ok: false, status: 0, error: "fetch failed", deliveryUnknown: true });
    const client = takenSlotClient("failed");
    await runWith(client);

    const last = client.updates.at(-1);
    expect(last).toMatchObject({ status: "failed" });
    expect(String(last?.error_message)).toMatch(new RegExp(`^${DELIVERY_UNKNOWN_PREFIX}`));
  });
});

describe("a family the fees app already messaged under another campaign", () => {
  // VPPS One only (critique0 #11): the claim index includes campaign_name, so
  // a `_v6` send by the fees app this morning would not stop a One send.
  it("is not messaged again today in a real session", async () => {
    const client = takenSlotClient("failed", null, [{ student_id: "s1", sent_on: "2026-10-27" }]);
    const outcome = await runWith(client);

    expect(send).not.toHaveBeenCalled();
    expect(outcome.alreadySentToday).toBe(1);
    expect(client.updates).toHaveLength(0);
  });

  it("is not messaged inside its cadence window either", async () => {
    // candidate() is weekly; a send four days ago under any name holds it.
    const client = takenSlotClient("failed", null, [{ student_id: "s1", sent_on: "2026-10-23" }]);
    await runWith(client);

    expect(send).not.toHaveBeenCalled();
  });

  it("is still sent in a test session, which has no parents", async () => {
    const client = takenSlotClient("failed", null, [{ student_id: "s1", sent_on: "2026-10-27" }]);
    await runWith(client, "TEST-2026-27");

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("counts the fees app's _v6 reminder today as sent: no AiSensy call", async () => {
    const client = takenSlotClient("failed", null, [
      { student_id: "s1", sent_on: "2026-10-27", campaign_name: "vpps_app_fee_due_hi_v6" },
    ]);
    const outcome = await runWith(client);

    expect(send).not.toHaveBeenCalled();
    expect(outcome.alreadySentToday).toBe(1);
  });

  it("is still reminded when its only recent message is a receipt notice", async () => {
    // The fees app's loadLastSentOn reads reminders only: a family who just
    // paid is not "messaged", and silencing them for a week is backwards.
    const client = takenSlotClient("failed", null, [
      { student_id: "s1", sent_on: "2026-10-27", notice_kind: "receipt", campaign_name: "vpps_app_receipt_hi" },
    ]);
    await runWith(client);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("counts a delivery-unknown failure under another campaign as sent", async () => {
    const client = takenSlotClient("failed", null, [
      {
        student_id: "s1",
        sent_on: "2026-10-27",
        status: "failed",
        error_message: `${DELIVERY_UNKNOWN_PREFIX}timed out`,
        campaign_name: "vpps_app_balance_hi_v3",
      },
    ]);
    await runWith(client);

    expect(send).not.toHaveBeenCalled();
  });

  it("does not count a definite failure under another campaign", async () => {
    const client = takenSlotClient("failed", null, [
      { student_id: "s1", sent_on: "2026-10-27", status: "failed", error_message: "400 bad params" },
    ]);
    await runWith(client);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("pages the read, so today's send is not lost past PostgREST's 1,000 rows", async () => {
    // 1,200 older reminders in the chunk, then today's. An unordered, unpaged
    // read could stop at 1,000 and miss it; this one orders and pages.
    const older = Array.from({ length: 1200 }, (_, index) => ({
      student_id: "s1",
      sent_on: "2026-09-27",
      id: `a-${String(index).padStart(5, "0")}`,
    }));
    const client = takenSlotClient("failed", null, [
      ...older,
      { student_id: "s1", sent_on: "2026-10-27", id: "z-today" },
    ]);
    const { loadLatestSends } = await import("@/modules/whatsapp/data/run-sender");
    const latest = await loadLatestSends(client, ["s1"], "2026-10-27");
    expect(latest?.get("s1")).toBe("2026-10-27");
    expect(client.pageReads.length).toBeGreaterThan(1);

    await runWith(client);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("a test session", () => {
  it("sends again the same day, reusing today's sent row", async () => {
    const client = takenSlotClient("sent");
    const outcome = await runWith(client, "TEST-2026-27");

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.sent).toBe(1);
    expect(client.updates[0]).toMatchObject({ status: "pending" });
  });
});
