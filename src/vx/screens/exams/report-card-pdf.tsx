/* eslint-disable jsx-a11y/alt-text -- react-pdf Image is PDF content, not an HTML image. */
import "server-only";

import * as React from "react";
import { Document, Image, Line, Page, Polygon, Polyline, Rect, Circle, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";

import type { CardInsight, Trend } from "@/modules/assessments/domain/card-insight";
import { absentExams, cardWeights, markIn, reportColumns, type ReportCard } from "@/modules/assessments/domain/report-card";
import { LETTER_BANDS, WORD_BANDS } from "@/modules/assessments/domain/result-rules";
import type { CertificateSchool } from "@/modules/certificates/domain/certificate";
import { ensurePdfFontsRegistered, HI_FONT, loadEmblemImage, loadLogoImage, loadSealImage, loadSignatureImage, type PdfImage } from "@/platform/pdf/document-kit";
import { schoolProfile } from "@/platform/config/school";

import { cardNotes } from "./domain/card-notes";
import { effortWords, focusWords, gradeTone, growthWords, strengthWords } from "./domain/card-insight-words";
import { percentText, rankWords, ruledResult } from "./domain/card-words";
import { subjectPair } from "./domain/groups";

/*
 * The report card a family keeps (D-612): one A4 page per child, set like the
 * school's certificates (navy and gold, the official letterhead from
 * Certificate settings), with the child's photo, the marks in the school's
 * own pattern, each subject beside the class average, effort across the
 * term's exams, the class teacher's remark, and the principal's signature
 * with the school seal once the card is issued and the school signs its
 * documents (D-541). A draft says so across the top and is never signed.
 */

export type CardPhoto = { data: Buffer; format: "jpg" | "png" };

export type CardForPdf = {
  card: ReportCard;
  /** Grace marks by subject code. */
  grace: Record<string, number>;
  remark: string | null;
  issued: boolean;
  /** Read from the school's records when printed; not part of the card's figures. */
  photo?: CardPhoto | null;
  motherName?: string | null;
  dateOfBirth?: string | null;
  classTeacher?: string | null;
};

const C = {
  navy: "#0B2545",
  navySoft: "#E8EDF5",
  gold: "#A67C2E",
  goldSoft: "#E9DCC0",
  paper: "#FFFDF8",
  ink: "#1C2230",
  muted: "#5C6270",
  faint: "#8A8F99",
  rule: "#DCE1EA",
  green: "#2F7F56",
  greenSoft: "#E6F3EC",
  amber: "#9A5B0B",
  amberSoft: "#FBF0DC",
  red: "#B42318",
  redSoft: "#FDECEA",
  blue: "#1D4E89",
  blueSoft: "#E6EEF8",
} as const;

const TONE = {
  good: { fg: C.green, bg: C.greenSoft },
  fine: { fg: C.blue, bg: C.blueSoft },
  watch: { fg: C.amber, bg: C.amberSoft },
  low: { fg: C.red, bg: C.redSoft },
  plain: { fg: C.ink, bg: C.navySoft },
} as const;

const DEVANAGARI = /[ऀ-ॿ]/;

/** Latin in Helvetica, Devanagari in Noto: react-pdf picks one family per run. */
function Runs({ text, size, bold = false, color = C.ink, italic = false }: { text: string; size: number; bold?: boolean; color?: string; italic?: boolean }) {
  const runs = text.match(/[ऀ-ॿ‌‍]+(?:[\s,.।()-]*[ऀ-ॿ‌‍]+)*|[^ऀ-ॿ‌‍]+/g) ?? [];
  return (
    <>
      {runs.map((run, index) => {
        const hi = DEVANAGARI.test(run);
        const latin = bold ? (italic ? "Helvetica-BoldOblique" : "Helvetica-Bold") : italic ? "Helvetica-Oblique" : "Helvetica";
        return (
          <Text key={index} style={{ fontFamily: hi ? HI_FONT : latin, fontWeight: hi && bold ? "bold" : "normal", fontSize: hi ? size * 0.94 : size, color }}>
            {hi ? `${run}\u200C` : run}
          </Text>
        );
      })}
    </>
  );
}

function T({ children, size = 8, bold, color, italic, align, style }: { children: string; size?: number; bold?: boolean; color?: string; italic?: boolean; align?: "left" | "center" | "right"; style?: Record<string, unknown> }) {
  return (
    <Text style={{ textAlign: align, fontSize: size, lineHeight: 1.22, ...style }}>
      <Runs text={children} size={size} bold={bold} color={color} italic={italic} />
    </Text>
  );
}

/** A small label over its value: Hindi first, English after, as the register writes them. */
function Label({ hi, en, color = C.muted }: { hi: string; en: string; color?: string }) {
  return <T size={6.6} color={color}>{`${hi} · ${en.toUpperCase()}`}</T>;
}

function Diamond({ size = 6, color = C.gold }: { size?: number; color?: string }) {
  const h = size / 2;
  return (
    <Svg width={size} height={size}>
      <Polygon points={`${h},0 ${size},${h} ${h},${size} 0,${h}`} fill={color} />
    </Svg>
  );
}

/** The double frame of the school's documents, drawn behind everything. */
function Frame() {
  return (
    <>
      <View fixed style={{ position: "absolute", top: 12, left: 12, right: 12, bottom: 12, borderWidth: 1.6, borderColor: C.navy }} />
      <View fixed style={{ position: "absolute", top: 16, left: 16, right: 16, bottom: 16, borderWidth: 0.6, borderColor: C.gold }} />
    </>
  );
}

function Letterhead({ school, crest }: { school: CertificateSchool; crest: PdfImage | null }) {
  const operated = [school.trust ? `Operated by ${school.trust}` : school.affiliation || "", school.recognisedBy ? `Recognised by the ${school.recognisedBy}` : ""].filter(Boolean).join("  ·  ");
  const codes = [school.udiseCode ? `UDISE ${school.udiseCode}` : "", school.pspCode ? `PSP ${school.pspCode}` : "", school.recognitionNo ? `Recognition ${school.recognitionNo}` : ""].filter(Boolean).join("  ·  ");
  const contact = [school.address, school.phone, school.email].map((v) => v?.trim()).filter(Boolean).join("  ·  ");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: 52, alignItems: "center" }}>{crest ? <Image src={crest} style={{ width: 50, height: 50, objectFit: "contain" }} /> : null}</View>
      <View style={{ flex: 1, alignItems: "center" }}>
        {school.nameHi ? (
          <Text style={{ fontFamily: HI_FONT, fontWeight: "bold", fontSize: 12.5, color: C.navy }}>{school.nameHi}</Text>
        ) : null}
        <Text style={{ fontFamily: "Times-Bold", fontSize: 15.5, color: C.navy, letterSpacing: 0.6, textAlign: "center" }}>{school.name.toUpperCase()}</Text>
        {operated ? <T size={6.8} color={C.muted} italic align="center">{operated}</T> : null}
        {contact ? <T size={6.8} color={C.ink} align="center">{contact}</T> : null}
        {codes ? <T size={6.2} color={C.faint} align="center">{codes}</T> : null}
      </View>
      <View style={{ width: 52 }} />
    </View>
  );
}

function TitleBand({ title, sessionLabel }: { title: { en: string; hi: string }; sessionLabel: string }) {
  return (
    <View style={{ marginTop: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, height: 0.8, backgroundColor: C.gold }} />
        <View style={{ marginHorizontal: 5 }}>
          <Diamond size={6} />
        </View>
        <View style={{ flex: 1, height: 0.8, backgroundColor: C.gold }} />
      </View>
      <View style={{ marginTop: 5, backgroundColor: C.navy, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text>
          <Runs text="प्रगति पत्र" size={11} bold color="#FFFFFF" />
          <Runs text="  ·  PROGRESS REPORT" size={10} bold color="#FFFFFF" />
        </Text>
        <Text>
          <Runs text={`${title.hi}  ·  ${title.en}`} size={8} color={C.goldSoft} />
          <Runs text={`  ·  Session ${sessionLabel}`} size={8} color={C.goldSoft} />
        </Text>
      </View>
    </View>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function formatDob(value: string | null | undefined): string | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function ChildStrip({ entry }: { entry: CardForPdf }) {
  const { card } = entry;
  const facts: [string, string, string][] = [
    ["विद्यार्थी", "Student", card.studentName],
    ["पिता", "Father", card.fatherName ?? "—"],
    ["माता", "Mother", entry.motherName ?? "—"],
    ["कक्षा", "Class", `${card.classLabel}${card.rollNo ? ` · Roll ${card.rollNo}` : ""}`],
    ["एस.आर. नं.", "SR no.", card.admissionNo ?? "—"],
    ["जन्म तिथि", "Date of birth", formatDob(entry.dateOfBirth) ?? "—"],
  ];
  return (
    <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
      <View style={{ width: 54, height: 66, borderWidth: 1, borderColor: C.gold, borderRadius: 3, padding: 1.5, backgroundColor: "#FFFFFF" }}>
        {entry.photo ? (
          <Image src={entry.photo} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 2 }} />
        ) : (
          <View style={{ flex: 1, backgroundColor: C.navySoft, alignItems: "center", justifyContent: "center", borderRadius: 2 }}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 16, color: C.navy }}>{initials(card.studentName)}</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignContent: "center", borderWidth: 0.6, borderColor: C.rule, borderRadius: 3, paddingTop: 4, paddingHorizontal: 8 }}>
        {facts.map(([hi, en, value]) => (
          <View key={en} style={{ width: "33.33%", paddingBottom: 5, paddingRight: 6 }}>
            <Label hi={hi} en={en} />
            <T size={9.2} bold color={C.navy}>{value}</T>
          </View>
        ))}
      </View>
    </View>
  );
}

function markText(m: ReportCard["rows"][number]["marks"][number]): string {
  if (m.exempt) return "Exempt";
  if (m.value === null) return "—";
  return String(m.value);
}

function GradeChip({ grade, wide = false }: { grade: string | null; wide?: boolean }) {
  if (!grade) return <T size={8} color={C.faint} align="center">—</T>;
  const tone = TONE[gradeTone(grade)];
  return (
    <View style={{ alignSelf: "center", backgroundColor: tone.bg, borderRadius: 7, paddingHorizontal: wide ? 5 : 6, paddingVertical: 1.5, minWidth: 24, alignItems: "center" }}>
      <Text style={{ fontFamily: "Helvetica-Bold", fontSize: wide ? 7 : 8, color: tone.fg }}>{grade}</Text>
    </View>
  );
}

function MarksTable({ entry, dense = false }: { entry: CardForPdf; dense?: boolean }) {
  const { card } = entry;
  // Every exam any subject sat, not the first row's (coordinators B5).
  const exams = reportColumns(card.rows).map((c) => ({ code: c.assessmentCode, en: c.assessmentLabelEn, hi: c.assessmentLabelHi }));
  const maxOf = (code: string) => {
    const set = new Set(card.rows.map((r) => markIn(r, code)?.maxMarks).filter((v): v is number => typeof v === "number"));
    return set.size === 1 ? [...set][0] : null;
  };
  const outOf = new Set(card.rows.map((r) => r.outOf));
  const wide = card.rule?.key === "pre_primary";
  const graceTotal = Object.values(entry.grace).reduce((a, b) => a + b, 0);
  const head = { fontSize: 6.8, color: C.navy };
  return (
    <View style={{ marginTop: 6, borderWidth: 0.8, borderColor: C.navy, borderRadius: 3 }}>
      <View style={{ flexDirection: "row", backgroundColor: C.navySoft, paddingVertical: 4, paddingHorizontal: 6, alignItems: "flex-end" }}>
        <View style={{ flex: 2.3 }}>
          <T size={6.8} color={C.navy}>विषय</T>
          <T size={7.2} bold color={C.navy}>Subject</T>
        </View>
        {exams.map((e) => {
          const max = maxOf(e.code);
          return (
            <View key={e.code} style={{ flex: 1, alignItems: "center" }}>
              <T size={head.fontSize} color={head.color} align="center">{e.hi || e.code}</T>
              <T size={7.2} bold color={C.navy} align="center">{`${e.en || e.code}${max ? ` /${max}` : ""}`}</T>
            </View>
          );
        })}
        <View style={{ flex: 1.15, alignItems: "center" }}>
          <T size={head.fontSize} color={head.color} align="center">कुल</T>
          <T size={7.2} bold color={C.navy} align="center">{`Total${outOf.size === 1 ? ` /${[...outOf][0]}` : ""}`}</T>
        </View>
        <View style={{ flex: wide ? 1.4 : 0.9, alignItems: "center" }}>
          <T size={head.fontSize} color={head.color} align="center">ग्रेड</T>
          <T size={7.2} bold color={C.navy} align="center">Grade</T>
        </View>
      </View>
      {card.rows.map((row, index) => {
        const g = entry.grace[row.subjectCode] ?? 0;
        const name = subjectPair(row.subjectCode);
        return (
          <View key={row.subjectCode} wrap={false} style={{ flexDirection: "row", alignItems: "center", paddingVertical: dense ? 1.3 : 2.8, paddingHorizontal: 6, backgroundColor: index % 2 ? "#FAFBFD" : "#FFFFFF", borderTopWidth: 0.4, borderTopColor: C.rule }}>
            <View style={{ flex: 2.3, flexDirection: "row", alignItems: "baseline", gap: 4 }}>
              <T size={8.4} bold>{name.en}</T>
              {name.hi ? <T size={7.2} color={C.muted}>{name.hi}</T> : null}
            </View>
            {exams.map((e) => {
              const m = markIn(row, e.code);
              if (m?.absent && !m.exempt) {
                return (
                  <View key={e.code} style={{ flex: 1, alignItems: "center" }}>
                    <T size={7.4} bold color={C.red} align="center">{card.rule ? "Absent" : `Absent · 0`}</T>
                    <T size={6.4} color={C.red} align="center">अनुपस्थित</T>
                  </View>
                );
              }
              return (
                <View key={e.code} style={{ flex: 1, alignItems: "center" }}>
                  <T size={8.4} align="center">{m ? markText(m) : ""}</T>
                </View>
              );
            })}
            <View style={{ flex: 1.15, alignItems: "center" }}>
              <T size={8.6} bold color={C.navy} align="center">{`${row.scored}${g ? ` +${g}G` : ""}${outOf.size === 1 ? "" : `/${row.outOf}`}${absentExams(row).length ? "*" : ""}`}</T>
            </View>
            <View style={{ flex: wide ? 1.4 : 0.9 }}>
              <GradeChip grade={row.grade} wide={wide} />
            </View>
          </View>
        );
      })}
      <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 6, backgroundColor: C.navySoft, borderTopWidth: 0.8, borderTopColor: C.navy }}>
        <View style={{ flex: 2.3 + exams.length }}>
          <T size={8.4} bold color={C.navy}>कुल · Grand total</T>
        </View>
        <View style={{ flex: 1.15, alignItems: "center" }}>
          <T size={9} bold color={C.navy} align="center">{`${card.totals.scored}${graceTotal ? ` +${graceTotal}G` : ""}/${card.totals.outOf}`}</T>
        </View>
        <View style={{ flex: wide ? 1.4 : 0.9 }}>
          <GradeChip grade={card.grade} wide={wide} />
        </View>
      </View>
      {card.apart?.length
        ? card.apart.map((row) => {
            const name = subjectPair(row.subjectCode);
            const missed = row.marks.every((m) => m.absent || m.exempt);
            return (
              <View key={row.subjectCode} wrap={false} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 3, paddingHorizontal: 6, borderTopWidth: 0.4, borderTopColor: C.rule }}>
                <View style={{ flex: 2.3 + exams.length, flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                  <T size={8} bold color={C.muted}>{name.en}</T>
                  {name.hi ? <T size={7} color={C.muted}>{name.hi}</T> : null}
                  <T size={6.6} italic color={C.faint}>{"· shown apart, not in the total · कुल में नहीं जुड़ता"}</T>
                </View>
                <View style={{ flex: 1.15, alignItems: "center" }}>
                  <T size={8.2} bold color={C.muted} align="center">{missed ? "Absent" : `${row.scored}/${row.outOf}`}</T>
                </View>
                <View style={{ flex: wide ? 1.4 : 0.9 }} />
              </View>
            );
          })
        : null}
    </View>
  );
}

function Tile({ hi, en, value, valueSize = 11, sub, tone = "plain", flex = 1 }: { hi: string; en: string; value: string; valueSize?: number; sub?: string | null; tone?: keyof typeof TONE; flex?: number }) {
  const t = TONE[tone];
  return (
    <View style={{ flex, borderWidth: 0.6, borderColor: C.rule, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 7, backgroundColor: "#FFFFFF" }}>
      <Label hi={hi} en={en} />
      <T size={valueSize} bold color={tone === "plain" ? C.navy : t.fg}>{value}</T>
      {sub ? <T size={6.8} color={C.muted}>{sub}</T> : null}
    </View>
  );
}

function Tiles({ entry }: { entry: CardForPdf }) {
  const { card } = entry;
  const ruled = ruledResult({
    rule: card.rule,
    status: card.status,
    passed: card.passed,
    shortIn: (card.shortIn ?? []).map(subjectPair),
    pendingIn: (card.pendingIn ?? []).map(subjectPair),
    division: card.division,
  });
  const decimals = card.rule?.percentDecimals ?? card.scheme?.percentDecimals ?? 1;
  const place = rankWords(card.rank, card.rankOf);
  const legacy =
    card.passed === null
      ? null
      : card.passed
        ? { en: "Pass", hi: "उत्तीर्ण", tone: "good" as const }
        : { en: "Needs support", hi: "सहायता चाहिए", tone: "low" as const };
  const result = card.rule ? (ruled ? { en: ruled.en, hi: ruled.hi, tone: ruled.tone === "ok" ? ("good" as const) : ruled.tone === "bad" ? ("low" as const) : ruled.tone === "warn" ? ("watch" as const) : ("plain" as const) } : null) : legacy;
  const att = card.attendance;
  return (
    <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
      <Tile hi="प्रतिशत" en="Percentage" value={percentText(card.totals.percent, decimals)} sub={`${card.totals.scored} of ${card.totals.outOf}`} flex={1} />
      <Tile hi="ग्रेड" en="Grade" value={card.grade ?? "—"} sub={card.gradeDescription ? `${card.gradeDescription.en} · ${card.gradeDescription.hi}` : null} tone={card.grade ? gradeTone(card.grade) : "plain"} flex={1.1} />
      {result ? <Tile hi="परिणाम" en="Result" value={result.en} valueSize={result.en.length > 22 ? 8.2 : 11} sub={result.hi} tone={result.tone} flex={1.6} /> : null}
      {place ? <Tile hi="कक्षा में स्थान" en="Rank" value={place.en} sub={place.hi} flex={1} /> : null}
      <Tile hi="उपस्थिति" en="Attendance" value={att?.percent === null || att?.percent === undefined ? "—" : `${att.percent}%`} sub={att ? `${att.present} of ${att.counted} days` : null} flex={1} />
    </View>
  );
}

/* ------------------------------------------------------------ the picture */

const BAR_W = 128;

function barTone(percent: number, line: number): keyof typeof TONE {
  if (percent < line) return "low";
  if (percent >= 75) return "good";
  if (percent >= 50) return "fine";
  return "watch";
}

/** Each subject as a bar out of 100, a gold tick at the class average. */
function SubjectPicture({ insight, passLine, dense = false }: { insight: CardInsight; passLine: number; dense?: boolean }) {
  return (
    <View style={{ flex: 1.25, borderWidth: 0.6, borderColor: C.rule, borderRadius: 3, padding: 7 }}>
      <T size={8.6} bold color={C.navy}>विषयवार · Subject by subject</T>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 1, marginBottom: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <View style={{ width: 9, height: 5, backgroundColor: C.blue, borderRadius: 1 }} />
          <T size={6.4} color={C.muted}>your child · आपका बच्चा</T>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <View style={{ width: 1.6, height: 8, backgroundColor: C.gold }} />
          <T size={6.4} color={C.muted}>class average · कक्षा औसत</T>
        </View>
      </View>
      {insight.subjects.map((s) => {
        const name = subjectPair(s.subjectCode);
        const pct = s.percent ?? 0;
        const tone = TONE[barTone(pct, passLine)];
        return (
          <View key={s.subjectCode} style={{ flexDirection: "row", alignItems: "center", marginTop: dense ? 0.4 : 2.4 }}>
            <View style={{ width: 62 }}>
              <T size={7.2} bold>{name.en}</T>
            </View>
            <Svg width={BAR_W} height={10}>
              <Rect x={0} y={2} width={BAR_W} height={6} rx={3} fill="#EEF1F5" />
              {s.percent !== null ? <Rect x={0} y={2} width={Math.max(3, (BAR_W * Math.min(100, pct)) / 100)} height={6} rx={3} fill={tone.fg} /> : null}
              {s.classAvg !== null ? <Rect x={Math.min(BAR_W - 1.6, (BAR_W * s.classAvg) / 100)} y={0} width={1.6} height={10} fill={C.gold} /> : null}
            </Svg>
            <View style={{ flex: 1, paddingLeft: 5 }}>
              <T size={7} bold color={tone.fg}>{s.percent === null ? "—" : `${Math.round(pct)}%`}</T>
            </View>
            <View style={{ width: 40 }}>
              <T size={6.4} color={C.muted} align="right">{s.classAvg === null ? "" : `class ${Math.round(s.classAvg)}%`}</T>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function TrendMark({ trend, size = 7 }: { trend: Trend; size?: number }) {
  const color = trend === "up" ? C.green : trend === "down" ? C.red : C.muted;
  return (
    <Svg width={size} height={size}>
      {trend === "up" ? <Polygon points={`${size / 2},0 ${size},${size} 0,${size}`} fill={color} /> : null}
      {trend === "down" ? <Polygon points={`0,0 ${size},0 ${size / 2},${size}`} fill={color} /> : null}
      {trend === "steady" ? <Rect x={0} y={size / 2 - 1} width={size} height={2} fill={color} /> : null}
    </Svg>
  );
}

const CHART = { w: 206, h: 50, pad: 14 };

/** The chart's range: the figures with room around them, in tens, so a 5-point move is visible. */
function chartRange(points: CardInsight["journey"]): { lo: number; hi: number } {
  const values = points.flatMap((p) => [p.percent, p.classAvg]).filter((v): v is number => v !== null);
  if (!values.length) return { lo: 0, hi: 100 };
  const lo = Math.max(0, Math.floor((Math.min(...values) - 8) / 10) * 10);
  const hi = Math.min(100, Math.ceil((Math.max(...values) + 8) / 10) * 10);
  return hi - lo < 30 ? { lo: Math.max(0, hi - 30), hi: Math.max(hi, 30) } : { lo, hi };
}

/** The term exam by exam: the child's line in navy, the class's dashed in gold. */
function Journey({ insight }: { insight: CardInsight }) {
  const points = insight.journey;
  if (points.filter((p) => p.percent !== null).length < 1) return null;
  const x = (i: number) => CHART.pad + (points.length === 1 ? (CHART.w - 2 * CHART.pad) / 2 : (i * (CHART.w - 2 * CHART.pad)) / (points.length - 1));
  const range = chartRange(points);
  const y = (v: number) => CHART.h - 6 - ((CHART.h - 12) * (Math.max(range.lo, Math.min(range.hi, v)) - range.lo)) / (range.hi - range.lo);
  const line = (key: "percent" | "classAvg") =>
    points
      .map((p, i) => (p[key] === null ? null : `${x(i)},${y(p[key] as number)}`))
      .filter(Boolean)
      .join(" ");
  return (
    <View>
      <Svg width={CHART.w} height={CHART.h}>
        {[range.lo, (range.lo + range.hi) / 2, range.hi].map((g) => (
          <Line key={g} x1={CHART.pad - 4} x2={CHART.w - CHART.pad + 4} y1={y(g)} y2={y(g)} stroke="#E4E8EF" strokeWidth={0.6} />
        ))}
        <Polyline points={line("classAvg")} stroke={C.gold} strokeWidth={1.2} strokeDasharray="2.5,2" fill="none" />
        <Polyline points={line("percent")} stroke={C.navy} strokeWidth={1.6} fill="none" />
        {points.map((p, i) => (p.percent === null ? null : <Circle key={p.code} cx={x(i)} cy={y(p.percent)} r={2.2} fill={C.navy} />))}
      </Svg>
      {/* Each exam's figures under its own point, not in equal thirds. */}
      <View style={{ width: CHART.w, height: 27, position: "relative" }}>
        {points.map((p, i) => (
          <View key={p.code} style={{ position: "absolute", left: x(i) - 30, width: 60, top: 0, alignItems: "center" }}>
            <T size={6.2} color={C.muted} align="center">{p.en || p.code}</T>
            <T size={7.4} bold color={C.navy} align="center">{p.percent === null ? "—" : `${Math.round(p.percent)}%`}</T>
            <T size={5.8} color={C.gold} align="center">{p.classAvg === null ? "" : `class ${Math.round(p.classAvg)}%`}</T>
          </View>
        ))}
      </View>
    </View>
  );
}

function Effort({ insight }: { insight: CardInsight }) {
  const lines = effortWords(insight);
  const growth = growthWords(insight);
  return (
    <View style={{ flex: 1, borderWidth: 0.6, borderColor: C.rule, borderRadius: 3, padding: 7 }}>
      <T size={8.6} bold color={C.navy}>प्रयास विश्लेषण · Effort analysis</T>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <View style={{ width: 10, height: 1.6, backgroundColor: C.navy }} />
          <T size={6.4} color={C.muted}>your child · आपका बच्चा</T>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Svg width={10} height={2}>
            <Line x1={0} x2={10} y1={1} y2={1} stroke={C.gold} strokeWidth={1.2} strokeDasharray="2.5,2" />
          </Svg>
          <T size={6.4} color={C.muted}>class average · कक्षा औसत</T>
        </View>
      </View>
      <Journey insight={insight} />
      {growth ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
          {insight.trend ? <TrendMark trend={insight.trend} /> : null}
          <T size={7.2} bold color={insight.trend === "up" ? C.green : insight.trend === "down" ? C.red : C.ink}>{growth.en}</T>
        </View>
      ) : null}
      {growth ? <T size={6.8} color={C.muted}>{growth.hi}</T> : null}
      {lines.map((l) => (
        <View key={l.trend} style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 2.5 }}>
          <View style={{ paddingTop: 1.5 }}>
            <TrendMark trend={l.trend} size={6} />
          </View>
          <View style={{ flex: 1 }}>
            <T size={7}>{l.en}</T>
            <T size={6.6} color={C.muted}>{l.hi}</T>
          </View>
        </View>
      ))}
      {!lines.length ? <T size={7} color={C.muted}>Shown once the child has sat two exams of the term · दो परीक्षाओं के बाद दिखेगा</T> : null}
    </View>
  );
}

function Highlights({ insight, dense = false }: { insight: CardInsight; dense?: boolean }) {
  const strong = strengthWords(insight);
  const focus = focusWords(insight);
  if (!strong && !focus) return null;
  return (
    <View style={{ flexDirection: "row", gap: 6, marginTop: dense ? 4 : 6 }}>
      {strong ? (
        <View style={{ flex: 1, backgroundColor: C.greenSoft, borderRadius: 3, paddingVertical: 4, paddingHorizontal: 7 }}>
          <T size={7.4} bold color={C.green}>{strong.en}</T>
          <T size={6.8} color={C.green}>{strong.hi}</T>
        </View>
      ) : null}
      {focus ? (
        <View style={{ flex: 1, backgroundColor: C.amberSoft, borderRadius: 3, paddingVertical: 4, paddingHorizontal: 7 }}>
          <T size={7.4} bold color={C.amber}>{focus.en}</T>
          <T size={6.8} color={C.amber}>{focus.hi}</T>
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------- the foot */

function Remark({ remark, dense = false }: { remark: string; dense?: boolean }) {
  const [en, hi] = remark.split("\n");
  return (
    <View style={{ marginTop: dense ? 4 : 6, borderLeftWidth: 2.4, borderLeftColor: C.gold, backgroundColor: C.paper, paddingVertical: 5, paddingHorizontal: 8 }}>
      <Label hi="कक्षा अध्यापक की टिप्पणी" en="Class teacher's remark" color={C.gold} />
      {hi ? <T size={8.6}>{hi}</T> : null}
      {en ? <T size={8.2} italic color={C.ink}>{en}</T> : null}
    </View>
  );
}

function Signatures({ classTeacher, coordinator, school, signature, seal, signed, dense = false }: { classTeacher: string | null; coordinator: string | null; school: CertificateSchool; signature: PdfImage | null; seal: PdfImage | null; signed: boolean; dense?: boolean }) {
  const col = (name: string | null, hi: string, en: string, ink?: React.ReactNode) => (
    <View style={{ flex: 1, alignItems: "center" }}>
      <View style={{ height: dense ? 22 : 26, justifyContent: "flex-end", alignItems: "center" }}>{ink}</View>
      <View style={{ width: "86%", height: 0.8, backgroundColor: C.navy }} />
      <T size={7.6} bold color={C.navy} align="center">{name || " "}</T>
      <T size={6.8} color={C.muted} align="center">{`${hi} · ${en}`}</T>
    </View>
  );
  return (
    <View wrap={false} style={{ flexDirection: "row", gap: 14, marginTop: dense ? 4 : 12, position: "relative" }}>
      {col(classTeacher, "कक्षा अध्यापक", "Class teacher")}
      {col(coordinator, "परीक्षा प्रभारी", "Exam in-charge")}
      {col(
        school.principalName || null,
        school.principalDesignationHi || "प्रधानाचार्य",
        school.principalDesignation || "Principal",
        signed && signature ? <Image src={signature} style={{ height: 25, maxWidth: 120, objectFit: "contain" }} /> : null,
      )}
      {/* Stamped where a clerk stamps it: beside the signature, over its edge. */}
      {signed && seal ? (
        <View style={{ position: "absolute", right: 118, bottom: 2 }}>
          <Image src={seal} style={{ width: 54, height: 54 }} />
        </View>
      ) : null}
    </View>
  );
}

function bandsLegend(card: ReportCard): string | null {
  const bands = card.rule?.key === "pre_primary" ? WORD_BANDS : card.scheme?.bands?.length ? card.scheme.bands : card.rule ? LETTER_BANDS : null;
  if (!bands?.length) return null;
  const sorted = [...bands].sort((a, b) => b.from - a.from);
  return sorted
    .map((b, i) => {
      const top = i === 0 ? 100 : Math.ceil(sorted[i - 1].from) - 1;
      return b.from <= 0 ? `${b.label} below ${sorted[i - 1]?.from ?? 0}` : `${b.label} ${b.from}–${top}`;
    })
    .join("  ·  ");
}

function CardPage({ entry, title, school, crest, signature, seal, coordinator }: { entry: CardForPdf; title: { en: string; hi: string }; school: CertificateSchool; crest: PdfImage | null; signature: PdfImage | null; seal: PdfImage | null; coordinator: string | null }) {
  const { card } = entry;
  const notes = cardNotes(card.rows, Boolean(card.rule));
  const weighted = cardWeights(card);
  const graceTotal = Object.values(entry.grace).reduce((a, b) => a + b, 0);
  const passLine = card.rule?.subjectPassPercent ?? 33;
  const legend = bandsLegend(card);
  const signed = entry.issued && Boolean(school.signatureAsset || school.signature) && school.signaturePolicy === "facsimile";
  const insight = card.insight ?? null;
  // More subjects than any class has today still fit one sheet: rows close up past nine.
  const dense = card.rows.length + (card.apart?.length ?? 0) > 9;
  return (
    <Page size="A4" style={{ paddingTop: 24, paddingBottom: 40, paddingHorizontal: 28, fontFamily: "Helvetica", fontSize: 8, color: C.ink, backgroundColor: "#FFFFFF" }}>
      <Frame />
      {!entry.issued ? (
        <View fixed style={{ position: "absolute", top: 360, left: 0, right: 0, alignItems: "center", transform: "rotate(-28deg)" }}>
          <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 46, color: C.red, opacity: 0.07, letterSpacing: 4 }}>PREVIEW · NOT ISSUED</Text>
        </View>
      ) : null}
      <Letterhead school={school} crest={crest} />
      <TitleBand title={title} sessionLabel={card.sessionLabel} />
      {!entry.issued ? (
        <T size={7.4} bold color={C.red} align="center" style={{ marginTop: 3 }}>
          {"Not issued yet: marks may still change · अभी जारी नहीं, अंक बदल सकते हैं"}
        </T>
      ) : null}
      <ChildStrip entry={entry} />
      <MarksTable entry={entry} dense={dense} />
      {notes.length || graceTotal || weighted.length ? (
        <View style={{ marginTop: 3 }}>
          {notes.map((n) => (
            <T key={n.en} size={6.6} color={C.muted}>{`${n.en} · ${n.hi}`}</T>
          ))}
          {graceTotal ? <T size={6.6} color={C.muted}>{"G = grace marks given under the school's rule, shown beside the mark and not added into it · G = कृपांक"}</T> : null}
          {weighted.length ? <T size={6.6} color={C.muted}>{`Each exam's marks count: ${weighted.map((w) => `${w.en} ×${w.weight}`).join(", ")}`}</T> : null}
        </View>
      ) : null}
      <Tiles entry={entry} />
      {insight && insight.subjects.length ? (
        <>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
            <SubjectPicture insight={insight} passLine={passLine} dense={dense} />
            <Effort insight={insight} />
          </View>
          <Highlights insight={insight} dense={dense} />
        </>
      ) : null}
      {entry.remark ? <Remark remark={entry.remark} dense={dense} /> : null}
      <Signatures classTeacher={entry.classTeacher ?? null} coordinator={coordinator} school={school} signature={signature} seal={seal} signed={signed} dense={dense} />
      <View fixed style={{ position: "absolute", bottom: 20, left: 30, right: 30 }}>
        {legend ? <T size={6} color={C.faint} align="center">{`Grades: ${legend}`}</T> : null}
        <T size={6} color={C.faint} align="center">
          {`Effort compares the child with the class in each exam, so a hard paper does not count against them · ${card.classLabel} · Session ${card.sessionLabel} · ${entry.issued ? "Issued from the school's records" : "Draft from the school's records"}`}
        </T>
      </View>
    </Page>
  );
}

/** The school's letterhead when Certificate settings cannot be read: the profile's name and address. */
export function fallbackSchool(): CertificateSchool {
  return { name: schoolProfile.name, address: schoolProfile.letterhead?.address ?? schoolProfile.address, phone: schoolProfile.letterhead?.phone ?? schoolProfile.phone, email: schoolProfile.letterhead?.email ?? schoolProfile.email, signaturePolicy: "manual" };
}

export async function renderReportCardsPdf(input: {
  cards: CardForPdf[];
  title: { en: string; hi: string };
  school?: CertificateSchool | null;
  coordinator?: string | null;
}): Promise<Buffer> {
  ensurePdfFontsRegistered();
  const [emblem, logo, signature, seal] = await Promise.all([loadEmblemImage(), loadLogoImage(), loadSignatureImage(), loadSealImage()]);
  const school = input.school ?? fallbackSchool();
  return renderToBuffer(
    <Document title={`${input.title.en} · Report card`} author={school.name}>
      {input.cards.map((entry) => (
        <CardPage
          key={entry.card.studentId}
          entry={entry}
          title={input.title}
          school={school}
          crest={emblem ?? logo}
          signature={school.seal || school.signatureAsset ? signature : null}
          seal={school.seal ? seal : null}
          coordinator={input.coordinator ?? null}
        />
      ))}
    </Document>,
  );
}
