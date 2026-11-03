import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AUDIENCE_FILTERS,
  describeAudience,
  installmentTileHref,
  installmentsValue,
  lastYearTileHref,
  parseInstallmentsValue,
  savedAudienceFrom,
  savedAudienceParams,
  type ReminderQuerySource,
} from "@/modules/whatsapp/domain/audience";
import {
  noticeValuesFrom,
  scopeLinesFor,
  scopePhrase,
  type NoticeSettings,
  type NoticeSubject,
} from "@/modules/whatsapp/domain/campaigns";
import { describeV6Campaign } from "@/modules/whatsapp/domain/campaign-bodies-v6";
import { defaultLastYearFor } from "@/modules/whatsapp/domain/installment-calendar";

// The fees app mocks these once in tests/setup.ts; One has no shared setup
// file, so each ported test carries the same three (go-live Phase D).
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache:
    <T extends (...args: unknown[]) => unknown>(callback: T) =>
    callback,
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});


/**
 * Last year beside the installments, end to end.
 *
 * Until 2026-10-28 the Last-year tile cleared the four, so a fee notice could
 * ask for this year's installments or last session's balance — never both. The
 * 24 families carrying ₹2,57,700 from 2025-26 were all also behind this year,
 * so every reminder they got named this year's installments and left last
 * year's money out of the amount.
 */

const source: ReminderQuerySource = {
  ...DEFAULT_AUDIENCE_FILTERS,
  installments: [1, 2],
  situation: "fee_due",
  language: "hi",
  lastDate: "04-11-2026",
  lateFeeAmount: 1000,
  lateFeeBasis: "per_installment",
  lateFeeSource: "ledger",
  preDueWindowDays: 10,
};

const params = (href: string | null) => new URLSearchParams(String(href).slice(1));

describe("the installments value carries both tiles", () => {
  it("reads and writes installments and last_year together", () => {
    expect(parseInstallmentsValue("1,2,last_year")).toEqual({ installments: [1, 2], lastYear: true });
    expect(parseInstallmentsValue("last_year")).toEqual({ installments: [], lastYear: true });
    expect(parseInstallmentsValue("3,1")).toEqual({ installments: [1, 3], lastYear: false });
    expect(parseInstallmentsValue("banana")).toBeNull();

    expect(installmentsValue({ installments: [1, 2], lastYear: true })).toBe("1,2,last_year");
    expect(installmentsValue({ installments: [], lastYear: true })).toBe("last_year");
    expect(installmentsValue({ installments: [3], lastYear: false })).toBe("3");
  });
});

describe("the tile links combine rather than replace", () => {
  it("turns Last year on without clearing the installments", () => {
    expect(params(lastYearTileHref(source, [1, 2, 3])).get("installments")).toBe("1,2,last_year");
  });

  it("turns Last year off and keeps the installments", () => {
    const on = { ...source, lastYear: true };
    expect(params(lastYearTileHref(on, [1, 2, 3])).get("installments")).toBe("1,2");
    // Last year on its own goes back to the calendar's default, never to nothing.
    const alone = { ...source, installments: [], lastYear: true };
    expect(params(lastYearTileHref(alone, [1, 2, 3])).get("installments")).toBe("1,2,3");
  });

  it("keeps Last year on when an installment is tapped", () => {
    const on = { ...source, lastYear: true };
    const calendar = { overdue: [1, 2, 3] };
    expect(params(installmentTileHref(on, 3, calendar)).get("installments")).toBe("1,2,3,last_year");
    expect(params(installmentTileHref(on, 2, calendar)).get("installments")).toBe("1,last_year");
  });

  it("lets the last installment go only when Last year is still on", () => {
    const calendar = { overdue: [1] };
    expect(installmentTileHref({ ...source, installments: [1] }, 1, calendar)).toBeNull();
    expect(
      params(installmentTileHref({ ...source, installments: [1], lastYear: true }, 1, calendar)).get(
        "installments",
      ),
    ).toBe("last_year");
  });
});

describe("a saved campaign keeps both", () => {
  it("round-trips installments with Last year", () => {
    const stored = savedAudienceFrom({ installments: [1, 2], lastYear: true });
    expect(stored).toMatchObject({ installments: [1, 2], lastYear: true });
    expect(savedAudienceParams(stored).installments).toBe("1,2,last_year");

    // The manager's form posts the installments and a checkbox.
    expect(savedAudienceFrom({ installments: "1,2,3", lastYear: true })).toMatchObject({
      installments: [1, 2, 3],
      lastYear: true,
    });
    // "Last year only" is still a choice.
    expect(savedAudienceFrom({ installments: "last_year" })).toMatchObject({
      installments: [],
      lastYear: true,
    });
  });
});

describe("the sentence says both", () => {
  it("names the balance beside the installments", () => {
    const sentence = describeAudience(
      { ...DEFAULT_AUDIENCE_FILTERS, installments: [1, 2], lastYear: true, installmentMatch: "any" },
      { count: 3, quotedTotal: 45000 },
    );
    expect(sentence.claim).toBe(
      "still owing on installments 1 and 2, any of them, or on a balance carried over from last session, for the fees on those installments plus what is left of that balance.",
    );
  });
});

describe("the message names both", () => {
  const subject: NoticeSubject = {
    parentName: "Ramesh",
    studentName: "Aaradhya",
    studentClass: "Class 2",
    dueAmount: 21000,
    totalPaid: 500,
    balanceDue: 9000,
    prevYearBalance: 12000,
    prevSessionLabel: "2025-26",
    owedInstallments: [1, 2],
  };
  const settings: NoticeSettings = {
    situation: "fee_due",
    language: "hi",
    installments: [1, 2],
    lastYear: true,
    lastDate: "04-11-2026",
    lateFeeAmount: 1000,
    lateFeeBasis: "per_installment",
  };

  it("words the installment line in both languages", () => {
    expect(
      scopePhrase({ installments: [1, 2], includesPrevYear: true, prevSessionLabel: "2025-26", language: "hi" }),
    ).toBe("किश्त 1 एवं 2 + पिछले सत्र 2025-26 का बकाया");
    expect(
      scopePhrase({ installments: [3], includesPrevYear: true, prevSessionLabel: "2025-26", language: "en" }),
    ).toBe("Installment 3 + previous session 2025-26 balance");
    expect(
      scopePhrase({ installments: [], includesPrevYear: true, prevSessionLabel: "2025-26", language: "en" }),
    ).toBe("Previous session 2025-26");
  });

  /** A family as `loadReminderAudience` hands it over: the line composed on the server. */
  const withLine = (overrides: Partial<NoticeSubject>): NoticeSubject => {
    const next = { ...subject, ...overrides };
    return { ...next, scopeLine: scopeLinesFor(next, settings.installments) };
  };

  it("composes each family's line on the server", () => {
    expect(scopeLinesFor(subject, [1, 2])).toEqual({
      hi: "किश्त 1 एवं 2 + पिछले सत्र 2025-26 का बकाया",
      en: "Installment 1 and 2 + previous session 2025-26 balance",
    });
    // Owes only last year: the session.
    expect(scopeLinesFor({ ...subject, owedInstallments: [] }, [1, 2]).hi).toBe("पिछला सत्र 2025-26");
    // Nothing from last year: the installments alone.
    expect(scopeLinesFor({ ...subject, prevYearBalance: 0 }, [1, 2]).en).toBe("Installment 1 and 2");
    // Owes nothing at all (named by hand): the tiles, never an empty slot.
    expect(
      scopeLinesFor({ ...subject, owedInstallments: [], prevYearBalance: 0 }, [1, 2]).en,
    ).toBe("Installment 1 and 2");
  });

  it("projects one child onto the slots", () => {
    const values = noticeValuesFrom(withLine({}), settings);
    expect(values.installmentPhrase).toBe("किश्त 1 एवं 2 + पिछले सत्र 2025-26 का बकाया");
    expect(values.amountDue).toBe(21000);

    // A child with nothing from last year is told only this year's.
    const clean = noticeValuesFrom(withLine({ prevYearBalance: 0, prevSessionLabel: null }), settings);
    expect(clean.installmentPhrase).toBe("किश्त 1 एवं 2");

    // Without the tile nothing of last year reaches the message.
    const without = noticeValuesFrom(subject, { ...settings, lastYear: false });
    expect(without.installmentPhrase).toBe("किश्त 1 एवं 2");
  });

  it("uses the line the server composed for a one-child message", () => {
    const v6 = describeV6Campaign("fee_due", "hi")!;
    const slots = v6.buildParams(noticeValuesFrom(withLine({}), settings));
    expect(slots[0]).toBe("21,000");
    expect(slots[2]).toBe("किश्त 1 एवं 2 + पिछले सत्र 2025-26 का बकाया");
  });

  it("names last year once for a whole phone in the _v6 family message", () => {
    const v6 = describeV6Campaign("fee_due", "en")!;
    const english = { ...settings, language: "en" as const };
    const elder = noticeValuesFrom(withLine({ owedInstallments: [1], dueAmount: 17000 }), english);
    const younger = noticeValuesFrom(
      withLine({ studentName: "Bhavya", owedInstallments: [2], dueAmount: 4000, prevYearBalance: 0 }),
      english,
    );
    const context = {
      lateFeeSource: "ledger" as const,
      policyLateFeeAmount: 1000,
      lateFeeAmount: 1000,
      lateFeeBasis: "per_installment" as const,
    };
    const slots = v6.buildFamilyParams([elder, younger], { ...context, lastYear: true });

    expect(slots[0]).toBe("21,000");
    expect(slots[2]).toBe("Installment 1 and 2 + previous session 2025-26 balance");

    // A run without the tile names this year's installments only.
    const plain = v6.buildFamilyParams(
      [
        noticeValuesFrom({ ...subject, owedInstallments: [1] }, { ...english, lastYear: false }),
        noticeValuesFrom({ ...subject, owedInstallments: [2] }, { ...english, lastYear: false }),
      ],
      context,
    );
    expect(plain[2]).toBe("Installment 1 and 2");
  });
});

describe("the default opens with Last year once an installment has passed", () => {
  it("follows the calendar", () => {
    expect(defaultLastYearFor({ passed: [1, 2, 3] })).toBe(true);
    expect(defaultLastYearFor({ passed: [] })).toBe(false);
  });
});
