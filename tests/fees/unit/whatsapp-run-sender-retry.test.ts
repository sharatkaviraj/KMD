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
vi.mock("@/modules/whatsapp/data/aisensy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/whatsapp/data/aisensy")>()),
  sendAisensyCampaignMessage: (args: unknown) => send(args),
}));
vi.mock("@/modules/whatsapp/data/campaign-store", () => ({
  openRun: async () => "run-1",
  closeRun: async () => undefined,
}));
vi.mock("@/modules/activity/data/events", () => ({
  recordActivity: async () => undefined,
}));

import { DELIVERY_UNKNOWN_PREFIX } from "@/modules/whatsapp/data/aisensy";
import { executeReminderRun } from "@/modules/whatsapp/data/run-sender";

/**
 * Every insert collides; an update finds the row only when its status filter
 * matches and, when the update carries the error-message filter, the row is
 * not one whose delivery is unknown.
 */
function takenSlotClient(
  existingStatus: "failed" | "sent",
  existingError: string | null = null,
  earlierSends: Array<{ student_id: string; sent_on: string }> = [],
) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    from() {
      const builder = {
        // One's cross-campaign read (critique0 #11): every send this family
        // had in the window, whatever its campaign.
        select() {
          const chain = {
            in: () => chain,
            gte: () => chain,
            then: (resolve: (value: { data: typeof earlierSends; error: null }) => unknown) =>
              resolve({ data: earlierSends, error: null }),
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
            or(expression: string) {
              filters.push(["or", expression]);
              return chain;
            },
            select: async () => {
              const statusMatches = filters.some(
                ([c, v]) =>
                  c === "status" &&
                  (v === existingStatus || (Array.isArray(v) && v.includes(existingStatus))),
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
