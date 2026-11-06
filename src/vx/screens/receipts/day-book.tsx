import Link from "@/ui/link";

import type { BridgeReceiptList } from "@/platform/fees-bridge/office-read-contracts";
import type { Language } from "@/platform/i18n/language";
import { rupees } from "@/vx/format";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Input } from "@/vx/ui/controls";
import { Btn, Card, EmptyState, Pill } from "@/vx/ui/primitives";
import { CouldNotRead, RetryButton } from "@/vx/ui/read-state";
import { sourceReceiptHref } from "./source-receipt";

const CLOSE_WORD: Record<string, { en: string; hi: string }> = {
  closed: { en: "Day closed", hi: "दिन बंद" },
  draft: { en: "Close started", hi: "बंद करना शुरू" },
  pending_approval: { en: "Close waiting for approval", hi: "बंद करना मंज़ूरी के लिए" },
  reopened: { en: "Reopened", hi: "फिर खोला गया" },
};

/** Fees did not answer: say so and offer Try again — never an empty day, never a trip to the Fees app. */
export function DayBookUnavailable({ language, sessionLabel }: { language: Language; sessionLabel: string }) {
  const t = (en: string, hi: string) => lead({ en, hi }, language);
  return (
    <VxPage label={t("Receipts and day book", "रसीदें और दिन का हिसाब")}>
      <TopBar title={t("Receipts and day book", "रसीदें और दिन का हिसाब")} crumb={sessionLabel} />
      <Section>
        <CouldNotRead message={{ en: "Receipts could not be read from Fees just now. They are not lost.", hi: "अभी Fees से रसीदें पढ़ी नहीं जा सकीं। वे खोई नहीं हैं।" }}
          action={<RetryButton />} />
      </Section>
    </VxPage>
  );
}

/**
 * Receipts and the day book, native in One (review F01): Fees' own Receipts
 * page read for a date range — every receipt with its exact link, the day's
 * totals as Fees counts them, and each day's close as Fees records it.
 *
 * No "close the day" control, here or as a link: Fees has none either. Its
 * day close is the nightly `auto-day-close` job, and its Finance controls
 * show that close read-only (D-383). A receipt is reversed from its own page
 * here; sending one to the family is still Fees' act, from that same page.
 */
export function DayBook({ data, language, canSeeClose }: { data: BridgeReceiptList; language: Language; canSeeClose: boolean }) {
  const t = (en: string, hi: string) => lead({ en, hi }, language);
  const pageHref = (page: number) => `/receipts?${new URLSearchParams({ from: data.from, to: data.to, ...(data.query ? { q: data.query } : {}), session: data.sessionLabel, page: String(page) })}`;
  const receiptHref = (id: string, number: string) => sourceReceiptHref(number, id, data.sessionLabel);
  const time = (iso: string) => { const at = new Date(iso); return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }); };
  return (
    <VxPage label={t("Receipts and day book", "रसीदें और दिन का हिसाब")}>
      <TopBar title={t("Receipts and day book", "रसीदें और दिन का हिसाब")} crumb={`${data.sessionLabel} · ${t("from Fees", "Fees से")}`} />
      <Section>
        <form method="get" action="/receipts" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
          <input type="hidden" name="session" value={data.sessionLabel} />
          <label style={{ display: "flex", flexDirection: "column", fontSize: 13, gap: 4 }}>{t("From", "से")}<Input type="date" name="from" defaultValue={data.from} max={data.to} /></label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 13, gap: 4 }}>{t("To", "तक")}<Input type="date" name="to" defaultValue={data.to} /></label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 13, gap: 4, flex: "1 1 180px" }}>{t("Receipt or reference number", "रसीद या संदर्भ नंबर")}<Input type="search" name="q" defaultValue={data.query} maxLength={100} /></label>
          <Btn variant="pri" type="submit">{t("Show", "दिखाएँ")}</Btn>
        </form>

        <Card>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px", alignItems: "baseline" }}>
            <strong className="num" style={{ fontSize: 26 }}>{data.totals.truncated ? "≈ " : ""}{rupees(data.totals.totalAmount)}</strong>
            <span style={{ color: "var(--mut)" }}>{t(`${data.totals.receiptCount} receipts, reversed ones left out, as Fees' Receipts page counts them`, `${data.totals.receiptCount} रसीदें, रद्द रसीदें छोड़कर, जैसा Fees का रसीद पेज गिनता है`)}</span>
          </div>
          {data.days.length ? (
            <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column" }}>
              {data.days.map((day) => (
                <li key={day.date} style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
                  <strong style={{ minWidth: 110 }}>{day.date}</strong>
                  <span className="num">{rupees(day.totalAmount)}</span>
                  <span style={{ color: "var(--mut)" }}>{t(`${day.receiptCount} receipts`, `${day.receiptCount} रसीदें`)}</span>
                  {canSeeClose ? (
                    day.dayClose ? <Pill tone={day.dayClose.status === "closed" ? "ok" : "warn"}>{lead(CLOSE_WORD[day.dayClose.status] ?? { en: day.dayClose.status, hi: day.dayClose.status }, language)}{day.dayClose.closedAt ? ` · ${time(day.dayClose.closedAt)}` : ""}{day.dayClose.closedBy ? ` · ${day.dayClose.closedBy}` : ""}</Pill> : <Pill tone="mut">{t("Waiting for the overnight close", "रात में अपने-आप बंद होने की प्रतीक्षा")}</Pill>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canSeeClose ? <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--mut)" }}>{t("Fees closes each day by itself at midnight. Nobody closes a day by hand, in Fees or here.", "Fees हर दिन आधी रात को अपने-आप बंद करता है। कोई दिन हाथ से बंद नहीं होता — न Fees में, न यहाँ।")}</p> : null}
        </Card>

        {data.receipts.length === 0 ? (
          <EmptyState icon="receipt" title={t("No receipts in these days", "इन दिनों में कोई रसीद नहीं")} body={t("Change the dates or the search to see more.", "और देखने के लिए तारीखें या खोज बदलें।")} />
        ) : (
          <Card pad={false}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data.receipts.map((row, i) => (
                <li key={row.receiptId} style={{ borderTop: i ? "1px solid var(--bd)" : 0 }}>
                  <Link href={receiptHref(row.receiptId, row.receiptNumber)} className="tap" style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", alignItems: "center", padding: "12px 16px", color: "var(--fg)", minHeight: 56 }}>
                    <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 600 }}>{row.student.name}</span>
                      <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{[row.receiptNumber, row.student.classLabel, row.student.srNo ? `SR ${row.student.srNo}` : null, `${row.paymentDate} ${time(row.createdAt)}`].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>{row.paymentModeLabel}{row.collectedBy ? ` · ${row.collectedBy}` : ""}</span>
                    {row.status === "reversed" ? <Pill tone="bad">{t("Reversed", "रद्द")}</Pill> : null}
                    <strong className="num" style={{ marginLeft: "auto", textDecoration: row.status === "reversed" ? "line-through" : undefined }}>{rupees(row.amount)}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <nav style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }} aria-label={t("Pages", "पेज")}>
          {data.pagination.page > 1 ? <Btn href={pageHref(data.pagination.page - 1)}>{t("Previous", "पिछला")}</Btn> : <span />}
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{t(`Page ${data.pagination.page} · ${data.pagination.totalCount} receipts`, `पेज ${data.pagination.page} · ${data.pagination.totalCount} रसीदें`)}</span>
          {data.pagination.hasMore ? <Btn href={pageHref(data.pagination.page + 1)}>{t("Next", "अगला")}</Btn> : <span />}
        </nav>
      </Section>
    </VxPage>
  );
}
