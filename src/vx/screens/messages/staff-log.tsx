"use client";

import type { ReactNode } from "react";

import { clock, dateLabel, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Section } from "@/vx/ui/page";
import { Card, CardHead, EmptyState, Pill } from "@/vx/ui/primitives";

import type { StaffLogData } from "./staff-log-data";

/*
 * Messages → Staff (go-live Phase F): what the school app sent to staff on
 * WhatsApp, held back, or folded into a digest, and the month's count and
 * cost against the cap. Read-only; the switches are in the database and each
 * person's own consent is in /preferences (or recorded by an admin in /staff).
 */

const STATUS: Record<string, { label: Pair; tone: "ok" | "warn" | "bad" | "mut" | "info" }> = {
  accepted: { label: p("Sent", "भेजा"), tone: "ok" },
  delivered: { label: p("Delivered", "पहुँचा"), tone: "ok" },
  read: { label: p("Read", "पढ़ा"), tone: "ok" },
  pending: { label: p("Waiting", "प्रतीक्षा"), tone: "info" },
  dispatching: { label: p("Sending", "भेजा जा रहा"), tone: "info" },
  failed: { label: p("Failed", "नहीं गया"), tone: "bad" },
  unknown: { label: p("Unknown", "पता नहीं"), tone: "warn" },
  suppressed: { label: p("Not sent", "नहीं भेजा"), tone: "mut" },
  cancelled: { label: p("Taken back", "वापस लिया"), tone: "mut" },
};

const REASON: Record<string, Pair> = {
  no_consent: p("No WhatsApp consent", "WhatsApp की हामी नहीं"),
  opted_out: p("Opted out", "बंद किया"),
  pref_off: p("Switched off by them", "उन्होंने बंद किया"),
  kind_off: p("This kind is switched off", "यह सूचना बंद है"),
  not_test_recipient: p("Test: number not on the test list", "टेस्ट: नंबर टेस्ट सूची में नहीं"),
  outside_window: p("Held until 07:00", "सुबह 7 तक रोका"),
  daily_cap: p("8 already today", "आज 8 हो चुके"),
  month_cap: p("Monthly cap reached", "महीने की सीमा पूरी"),
  digest_hold: p("Held to send as one", "एक साथ भेजने को रोका"),
  digested: p("Sent inside a digest", "एक साथ वाले संदेश में गया"),
  gate_unreadable: p("Rules could not be read; tried again", "नियम पढ़े नहीं जा सके; फिर कोशिश"),
  no_phone: p("No number on file", "नंबर दर्ज नहीं"),
  too_late: p("Too late to matter", "अब देर हो चुकी"),
  resolved: p("Already handled", "पहले ही निपट गया"),
  inactive: p("Profile switched off", "प्रोफ़ाइल बंद"),
  test_account_real_session: p("Test account: real session", "टेस्ट खाता: असली सत्र"),
  render_refused: p("Message refused (it held a phone number)", "संदेश रोका (उसमें फ़ोन नंबर था)"),
};

export function StaffLog({ data, tabs }: { data: StaffLogData; tabs: ReactNode }) {
  const { tx } = useVx();
  const capLine = data.monthCap ? `${data.monthSent} / ${data.monthCap}` : String(data.monthSent);
  return (
    <Section>
      {tabs}
      <Card>
        <CardHead
          title={tx(p("WhatsApp to staff", "स्टाफ़ को WhatsApp"))}
          sub={tx(p("What the school app sent to staff or held back, and this month's cost.", "स्कूल ऐप ने स्टाफ़ को जो भेजा या रोका, और इस महीने का खर्च।"))}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: "4px 16px 16px", fontSize: 13 }} data-testid="staff-whatsapp-month">
          <span>
            {tx(p("Sent this month", "इस महीने भेजे"))}: <b>{capLine}</b>
          </span>
          <span>
            {tx(p("This month's cost", "इस महीने का खर्च"))}: <b>{rupees(data.monthCostPaise / 100)}</b>
          </span>
          <span>
            {tx(p("Staff who agreed", "हामी भरने वाले स्टाफ़"))}: <b>{data.consented}</b>
          </span>
          <span>
            {tx(p("Transport", "माध्यम"))}: <b>{data.transport}</b>
          </span>
        </div>
      </Card>
      {data.rows.length === 0 ? (
        <EmptyState icon="inbox" title={tx(p("Nothing yet.", "अभी कुछ नहीं।"))} />
      ) : (
        <Card>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {data.rows.map((row) => {
              const status = STATUS[row.status] ?? { label: p(row.status, row.status), tone: "mut" as const };
              const reason = row.reason ? (REASON[row.reason] ?? p(row.reason, row.reason)) : null;
              return (
                <li key={row.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {tx(row.kind)} · {row.to}
                      {row.test ? " · TEST" : ""}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>
                      {tx(dateLabel(row.createdAt.slice(0, 10)))} {clock(row.createdAt)}
                      {row.lastTry ? ` · ${row.lastTry.transport} ${row.lastTry.to}` : ""}
                      {reason ? ` · ${tx(reason)}` : ""}
                    </span>
                  </span>
                  <Pill tone={status.tone}>{tx(status.label)}</Pill>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </Section>
  );
}
