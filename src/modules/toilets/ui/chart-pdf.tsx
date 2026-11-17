/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image>, which has no alt: it draws into a PDF, not a page */
import "server-only";

import * as React from "react";
import QRCode from "qrcode";
import { Document, Image, Page, renderToBuffer, Text, View } from "@react-pdf/renderer";

import { ensurePdfFontsRegistered, HI_FONT, loadLogoImage, pdfTokens, type PdfImage } from "@/platform/pdf/document-kit";
import { schoolProfile } from "@/platform/config/school";

import { addDays, SLOTS, weekDays, type CheckItem, type Slot, type Toilet, type ToiletSettings } from "../domain/checks";

/*
 * The printed weekly chart (D-652): one A4 landscape sheet per toilet, Monday
 * to Saturday, a morning and an afternoon row for each open day, a tick box
 * for every line of the check list, and Time, Remarks and Name & sign for the
 * person who checked. A closed day is shaded and says so. The QR code in the
 * corner opens One's upload for exactly this toilet and week, so whoever
 * photographs the filled sheet never has to pick either.
 */

export type ChartPage = { toilet: Toilet; uploadUrl: string };

type Pair = { en: string; hi: string };

const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_HI = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const USED_BY: Record<Toilet["usedBy"], Pair> = {
  boys: { en: "Boys", hi: "लड़के" },
  girls: { en: "Girls", hi: "लड़कियाँ" },
  staff: { en: "Staff", hi: "स्टाफ़" },
  all: { en: "Everyone", hi: "सभी" },
};
const SLOT: Record<Slot, Pair> = { morning: { en: "Morning", hi: "सुबह" }, afternoon: { en: "Afternoon", hi: "दोपहर" } };

const C = { ink: pdfTokens.inkStrong, muted: pdfTokens.muted, rule: "#9ca3af", soft: "#d1d5db", shade: "#eef0f3", accent: "#1d4ed8" } as const;

function partsOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  return { date: d.getUTCDate(), month: d.getUTCMonth(), dow: d.getUTCDay(), year: d.getUTCFullYear() };
}

function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function weekTitle(weekStart: string): string {
  const a = partsOf(weekStart);
  const b = partsOf(addDays(weekStart, 5));
  return a.month === b.month
    ? `${a.date} – ${b.date} ${MONTHS[b.month]} ${b.year}`
    : `${a.date} ${MONTHS[a.month]} – ${b.date} ${MONTHS[b.month]} ${b.year}`;
}

const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * A Hindi line: Devanagari runs in Noto, with the zero-width non-joiner that
 * keeps react-pdf from dropping their last letter; digits, dates and symbols
 * in Helvetica, because the Noto face carries no Latin.
 */
function Hi({ children, size, bold = false, color = C.muted }: { children: string; size: number; bold?: boolean; color?: string }) {
  const runs = children.match(/[ऀ-ॿ‌‍]+(?:[\s,.।()-]*[ऀ-ॿ‌‍]+)*|[^ऀ-ॿ‌‍]+/g) ?? [];
  return (
    <>
      {runs.map((run, i) =>
        DEVANAGARI.test(run) ? (
          <Text key={i} style={{ fontFamily: HI_FONT, fontSize: size * 0.94, fontWeight: bold ? "bold" : "normal", color }}>{`${run}‌`}</Text>
        ) : (
          <Text key={i} style={{ fontFamily: bold ? "Helvetica-Bold" : "Helvetica", fontSize: size, color }}>{run}</Text>
        ),
      )}
    </>
  );
}

function En({ children, size, bold = false, color = C.ink }: { children: string; size: number; bold?: boolean; color?: string }) {
  return <Text style={{ fontFamily: bold ? "Helvetica-Bold" : "Helvetica", fontSize: size, color }}>{children}</Text>;
}

/** English over Hindi, for a column head. */
function Head({ label, flex, width, center = true }: { label: Pair; flex?: number; width?: number; center?: boolean }) {
  return (
    <View style={{ flex, width, paddingHorizontal: 3, paddingVertical: 3, borderRightWidth: 0.75, borderRightColor: C.rule, justifyContent: "center", alignItems: center ? "center" : "flex-start" }}>
      <Text style={{ fontSize: 7.5, textAlign: center ? "center" : "left" }}><En size={7.5} bold>{label.en}</En></Text>
      <Text style={{ fontSize: 7, textAlign: center ? "center" : "left" }}><Hi size={7}>{label.hi}</Hi></Text>
    </View>
  );
}

const W_DAY = 74;
const W_SLOT = 62;
const W_TIME = 48;
const ROW_H = 29;

function Box() {
  return <View style={{ width: 13, height: 13, borderWidth: 1, borderColor: C.ink, borderRadius: 2 }} />;
}

function Cell({ flex, width, children, last = false }: { flex?: number; width?: number; children?: React.ReactNode; last?: boolean }) {
  return (
    <View style={{ flex, width, borderRightWidth: last ? 0 : 0.75, borderRightColor: C.rule, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
      {children}
    </View>
  );
}

function ChartSheet({ page, weekStart, settings, isOpen, logo, qr, test }: {
  page: ChartPage;
  weekStart: string;
  settings: ToiletSettings;
  isOpen: (day: string) => boolean;
  logo: PdfImage | null;
  qr: string;
  test: boolean;
}) {
  const t = page.toilet;
  const items: CheckItem[] = settings.checklist;
  const days = weekDays(weekStart);
  const times: Record<Slot, string> = { morning: settings.morningAt, afternoon: settings.afternoonAt };

  return (
    <Page size="A4" orientation="landscape" style={{ paddingTop: 20, paddingBottom: 18, paddingHorizontal: 24, fontFamily: "Helvetica", color: C.ink }}>
      {/* Head: the school, the toilet, the week; the QR code on the right. */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        {logo ? <Image src={logo} style={{ width: 40, height: 40 }} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 8.5 }}><En size={8.5} color={C.muted}>{schoolProfile.name}</En></Text>
          <Text style={{ fontSize: 15, marginTop: 2 }}>
            <En size={15} bold>Toilet check chart  </En><Hi size={14} bold color={C.ink}>शौचालय जाँच चार्ट</Hi>
          </Text>
          <Text style={{ fontSize: 19, marginTop: 4 }}><En size={19} bold color={C.accent}>{t.name}</En></Text>
          <Text style={{ fontSize: 9, marginTop: 3 }}>
            <En size={9}>{`${USED_BY[t.usedBy].en}${t.place ? ` · ${t.place}` : ""}   ·   Week: ${weekTitle(weekStart)}   ·   Check at ${clock(settings.morningAt)} and ${clock(settings.afternoonAt)}`}</En>
          </Text>
          <Text style={{ fontSize: 8.5, marginTop: 1 }}>
            <Hi size={8.5}>{`${USED_BY[t.usedBy].hi} · हफ़्ता: ${weekTitle(weekStart)} · दिन में दो बार जाँच`}</Hi>
          </Text>
        </View>
        <View style={{ alignItems: "center", width: 92 }}>
          <Image src={qr} style={{ width: 72, height: 72 }} />
          <Text style={{ fontSize: 7, textAlign: "center", marginTop: 2 }}><En size={7} bold>Scan to upload this chart</En></Text>
          <Text style={{ fontSize: 6.5, textAlign: "center" }}><Hi size={6.5}>स्कैन करके चार्ट अपलोड करें</Hi></Text>
        </View>
      </View>

      {test ? (
        <Text style={{ marginTop: 4, fontSize: 8, color: pdfTokens.danger }}>
          <En size={8} bold color={pdfTokens.danger}>PRACTICE YEAR — for testing only  </En><Hi size={8} color={pdfTokens.danger}>अभ्यास सत्र — सिर्फ़ जाँच के लिए</Hi>
        </Text>
      ) : null}

      {/* The table. */}
      <View style={{ marginTop: 8, borderWidth: 1, borderColor: C.ink }}>
        <View style={{ flexDirection: "row", backgroundColor: C.shade, borderBottomWidth: 1, borderBottomColor: C.ink }}>
          <Head width={W_DAY} label={{ en: "Day", hi: "दिन" }} />
          <Head width={W_SLOT} label={{ en: "Check", hi: "जाँच" }} />
          <Head width={W_TIME} label={{ en: "Time", hi: "समय" }} />
          {items.map((item, i) => <Head key={i} flex={1} label={item} />)}
          <Head flex={1.7} label={{ en: "Problem seen / remarks", hi: "कोई कमी / टिप्पणी" }} />
          <View style={{ flex: 1.4, paddingVertical: 3, paddingHorizontal: 3, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 7.5 }}><En size={7.5} bold>Name & sign</En></Text>
            <Text style={{ fontSize: 7 }}><Hi size={7}>नाम व हस्ताक्षर</Hi></Text>
          </View>
        </View>

        {days.map((day, d) => {
          const x = partsOf(day);
          const last = d === days.length - 1;
          const dayCell = (
            <View style={{ width: W_DAY, borderRightWidth: 0.75, borderRightColor: C.rule, justifyContent: "center", paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 9 }}><En size={9} bold>{`${DAYS_EN[x.dow]} ${x.date} ${MONTHS[x.month]}`}</En></Text>
              <Text style={{ fontSize: 7.5 }}><Hi size={7.5}>{DAYS_HI[x.dow]}</Hi></Text>
            </View>
          );
          if (!isOpen(day)) {
            return (
              <View key={day} style={{ flexDirection: "row", height: ROW_H, backgroundColor: C.shade, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.ink }}>
                {dayCell}
                <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 8 }}>
                  <Text style={{ fontSize: 9 }}><En size={9} color={C.muted}>School closed — no check  </En><Hi size={8.5}>स्कूल बंद — जाँच नहीं</Hi></Text>
                </View>
              </View>
            );
          }
          return (
            <View key={day} style={{ flexDirection: "row", borderBottomWidth: last ? 0 : 1, borderBottomColor: C.ink }} wrap={false}>
              {dayCell}
              <View style={{ flex: 1 }}>
                {SLOTS.map((slot, s) => (
                  <View key={slot} style={{ flexDirection: "row", height: ROW_H, borderBottomWidth: s === 0 ? 0.5 : 0, borderBottomColor: C.soft }}>
                    <View style={{ width: W_SLOT, borderRightWidth: 0.75, borderRightColor: C.rule, justifyContent: "center", paddingHorizontal: 4 }}>
                      <Text style={{ fontSize: 8.5 }}><En size={8.5} bold>{SLOT[slot].en}</En></Text>
                      <Text style={{ fontSize: 7 }}><Hi size={7}>{`${SLOT[slot].hi} · ${clock(times[slot])}`}</Hi></Text>
                    </View>
                    <Cell width={W_TIME}><En size={8} color={C.soft}>__:__</En></Cell>
                    {items.map((_, i) => <Cell key={i} flex={1}><Box /></Cell>)}
                    <Cell flex={1.7} />
                    <Cell flex={1.4} last />
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </View>

      {/* How to fill it, and the supervisor's line. */}
      <View style={{ flexDirection: "row", marginTop: 8, gap: 16 }}>
        <View style={{ flex: 1.6 }}>
          <Text style={{ fontSize: 8 }}>
            <En size={8}>Tick each box when it is done. Write the time and sign every check. Leave a box empty if it was not done, and write the problem.</En>
          </Text>
          <Text style={{ fontSize: 7.5, marginTop: 1 }}>
            <Hi size={7.5}>हर काम होने पर खाने में टिक करें। हर जाँच पर समय लिखें और हस्ताक्षर करें। जो काम नहीं हुआ उसका खाना ख़ाली छोड़ें और कमी लिखें।</Hi>
          </Text>
          <Text style={{ fontSize: 8, marginTop: 3 }}>
            <En size={8} bold>After Saturday: photograph this sheet and upload it in VPPS One → Toilet checks (or scan the QR code).</En>
          </Text>
          <Text style={{ fontSize: 7.5, marginTop: 1 }}>
            <Hi size={7.5}>शनिवार के बाद: इस चार्ट की फ़ोटो लेकर VPPS One → शौचालय जाँच में अपलोड करें (या QR कोड स्कैन करें)।</Hi>
          </Text>
        </View>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <View style={{ borderBottomWidth: 0.75, borderBottomColor: C.ink, height: 18 }} />
          <Text style={{ fontSize: 7.5, marginTop: 2 }}><En size={7.5}>Checked by (in-charge) — name & sign  </En><Hi size={7}>प्रभारी — नाम व हस्ताक्षर</Hi></Text>
        </View>
      </View>
    </Page>
  );
}

export async function renderToiletChartsPdf(input: {
  pages: ChartPage[];
  weekStart: string;
  settings: ToiletSettings;
  isOpen: (day: string) => boolean;
  test: boolean;
}): Promise<Buffer> {
  ensurePdfFontsRegistered();
  const logo = await loadLogoImage().catch(() => null);
  const qrs = await Promise.all(
    input.pages.map((page) => QRCode.toDataURL(page.uploadUrl, { margin: 0, width: 240, errorCorrectionLevel: "M", color: { dark: "#111827", light: "#FFFFFF" } })),
  );
  const doc = (
    <Document title={`Toilet check charts ${weekTitle(input.weekStart)}`} author={schoolProfile.name}>
      {input.pages.map((page, i) => (
        <ChartSheet key={page.toilet.id} page={page} weekStart={input.weekStart} settings={input.settings} isOpen={input.isOpen} logo={logo} qr={qrs[i]} test={input.test} />
      ))}
    </Document>
  );
  return renderToBuffer(doc);
}
