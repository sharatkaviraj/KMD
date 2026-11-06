"use client";

import { useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "@/ui/link";
import { NavLink } from "@/ui/shell/nav-link";
import { useRouter } from "next/navigation";

import { queueFamilyReminderAction } from "@/app/(app)/dues/actions";
import {
  filterFamilies,
  hasCallFilters,
  NO_CALL_FILTERS,
  type CallFilters,
  type ClassBand,
  type DuesFamily,
} from "@/modules/defaulters/vx/domain/families";
import { addDays } from "@/modules/receipts/vx/domain/day-close";
import { dayMonth, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { Chip, Seg } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Grid, TopBar, VxPage } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";
import type { Pair } from "@/vx/text";

import { FamilyPanel } from "./family-panel";
import { duesHref } from "./href";
import { contactTone, day, dayTone, firstName, ini, kidsShort, lakh, maskPhone, telHref, TONES, weekLine } from "./look";
import type { DuesProps, DuesTab, LeftView, PromiseView } from "./types";
import { CHANNEL_WORD, fill, LOG_OUTCOME_WORD, W } from "./words";
import { WriteOffSheet } from "./write-off-sheet";

/*
 * Dues & calls, drawn as the design's `Dues` module: KPI tiles, the four tabs
 * with the family search, the call table (a card per family on a phone), the
 * promise and left-owing lists, aging, and the family panel beside the list.
 * Pending today, not due yet and the late fee stay three numbers everywhere.
 */

const STATUS_WORD: Record<string, { en: string; hi?: string }> = { left: W.status_left, graduated: W.status_graduated, inactive: W.status_inactive };

const BANDS: { value: ClassBand; pair: { en: string; hi?: string } }[] = [
  { value: "pre", pair: W.bandPre },
  { value: "p", pair: W.bandP },
  { value: "m", pair: W.bandM },
  { value: "s", pair: W.bandS },
];

/** The table's tracks; the compact set when the family panel takes the right side. */
const TRACKS = "44px minmax(0, 1.25fr) minmax(0, 1.2fr) 124px 84px minmax(0, 1.1fr) 124px";
const TRACKS_CMP = "44px minmax(0, 1fr) 116px 80px 124px";

/** One WhatsApp message through the approved template, as the design quotes it. */
const WA_COST = 0.88;

const delay = (i: number) => `${Math.min(i, 14) * 28}ms`;

/** A design KPI tile: 12px label, 22px figure (with a unit), 12px sub-line, an optional ring. */
function Tile({ label, value, unit, sub, tone, ring, delayMs, href, deskOnly }: { label: ReactNode; value: ReactNode; unit?: ReactNode; sub: ReactNode; tone?: string; ring?: number; delayMs: number; href?: string; deskOnly?: boolean }) {
  const body = (
    <>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: "var(--mut)", fontWeight: 600 }}>{label}</span>
        <span className="num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", whiteSpace: "nowrap", color: tone ?? "var(--fg)" }}>
          {value}
          {unit ? <span style={{ fontSize: 14, color: "var(--mut)" }}>{unit}</span> : null}
        </span>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span>
      </div>
      {ring !== undefined ? (
        <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" style={{ flex: "none" }}>
          <circle cx="24" cy="24" r="19" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 6 }} />
          <circle cx="24" cy="24" r="19" transform="rotate(-90 24 24)" style={{ fill: "none", stroke: "var(--acc)", strokeWidth: 6, strokeLinecap: "round", strokeDasharray: `${(119.4 * ring).toFixed(1)} 119.4`, ["--len" as string]: "119.4", animation: "xDraw .9s .2s var(--ease) both" }} />
        </svg>
      ) : null}
    </>
  );
  const style: CSSProperties = { padding: "14px 16px", display: "flex", alignItems: "center", gap: 10, minWidth: 0, animationDelay: `${delayMs}ms`, color: "var(--fg)" };
  return href ? (
    <Link href={href} className={`card rise tap lift${deskOnly ? " hide-m" : ""}`} style={style}>{body}</Link>
  ) : (
    <div className={`card rise${deskOnly ? " hide-m" : ""}`} style={style}>{body}</div>
  );
}

/** The family search: a 42px pill on a desk, full width and 46px on a phone. */
function FamilySearch({ value, onChange, phone }: { value: string; onChange: (v: string) => void; phone?: boolean }) {
  const { tx } = useVx();
  return (
    <label className={phone ? "only-m" : "only-d"} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, height: phone ? 46 : 42, borderRadius: phone ? 23 : 21, border: "1px solid var(--bds)", background: "var(--card)", padding: "0 14px", color: "var(--mut)", width: phone ? "100%" : 250 }}>
      <Ic n="search" />
      <span className="sr">{tx(W.findLabel)}</span>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={tx(W.findFamily)} autoComplete="off" style={{ flex: 1, minWidth: 0, height: phone ? 42 : 38, border: 0, outline: "none", background: "transparent", fontSize: phone ? 16 : 14, color: "var(--fg)" }} />
    </label>
  );
}

/** The design's square checkbox (22px, radius 7) inside a 40px target. */
function Check({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className="tap" role="checkbox" aria-checked={on} aria-label={label} onClick={onToggle} style={{ flex: "none", width: 40, height: 40, border: 0, padding: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${on ? "var(--pri)" : "var(--bds)"}`, background: on ? "var(--pri)" : "var(--card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--prifg)", transition: "background-color .2s ease, border-color .2s ease" }}>
        <Ic n="check" size={14} stroke={3} style={{ opacity: on ? 1 : 0, transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring), opacity .2s ease" }} />
      </span>
    </button>
  );
}

/** The design's empty card. */
function DuesEmpty({ icon, bg, fg, title, sub, action }: { icon: IconName; bg: string; fg: string; title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="card fadein" style={{ padding: "36px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <span style={{ width: 56, height: 56, borderRadius: 28, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", animation: "xPopIn .5s var(--spring) both" }}>
        <Ic n={icon} size={26} />
      </span>
      <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
      <span style={{ fontSize: 13, color: "var(--mut)" }}>{sub}</span>
      {action}
    </div>
  );
}

/** A list band's heading: dot, label, hint, and the sum on the right. */
function Band({ dot, label, hint, sum, children }: { dot: string; label: string; hint?: string; sum: string; children: ReactNode }) {
  return (
    <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 4px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ flex: "none", width: 8, height: 8, borderRadius: 4, background: dot }} />
          <h2 className="sech">{label}</h2>
          {hint ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{hint}</span> : null}
        </span>
        <span className="num" style={{ fontSize: 12, color: "var(--mut)", fontWeight: 700, whiteSpace: "nowrap" }}>{sum}</span>
      </div>
      <div className="card" style={{ overflow: "hidden" }}>{children}</div>
    </div>
  );
}

/** One row of the promise and left-owing lists: who, how much and where it stands, what to do. */
function ListLine({
  first,
  i,
  href,
  avatar,
  name,
  sub,
  amount,
  status,
  line,
  actions,
}: {
  first: boolean;
  i: number;
  href?: string;
  avatar: { text: string; bg: string; fg: string };
  name: string;
  sub: string;
  amount: string;
  status: { text: string; bg: string; fg: string };
  line: { dot: string; text: string };
  actions: ReactNode;
}) {
  const who = (
    <>
      <span aria-hidden="true" style={{ flex: "none", width: 38, height: 38, borderRadius: 12, background: avatar.bg, color: avatar.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{avatar.text}</span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
        <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span>
      </span>
    </>
  );
  const whoStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 12, minWidth: 0, color: "var(--fg)" };
  return (
    <div className="stack row" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr) 330px", gap: "10px 16px", alignItems: "center", padding: "12px 16px", borderTop: first ? 0 : "1px solid var(--bd)", animation: `xIn .32s var(--ease) ${delay(i)} both` }}>
      {href ? <Link href={href} className="tap" style={whoStyle}>{who}</Link> : <span style={whoStyle}>{who}</span>}
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{amount}</span>
          <span className="pill" style={{ background: status.bg, color: status.fg }}>{status.text}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mut)" }}>
          <span style={{ flex: "none", width: 8, height: 8, borderRadius: 4, background: line.dot }} />
          <span className="clip">{line.text}</span>
        </span>
      </span>
      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>{actions}</span>
    </div>
  );
}

const small: CSSProperties = { padding: "0 12px", fontSize: 13 };

/** Families drawn per page of the call list. */
const CALL_PAGE = 40;

export function DuesScreen(props: DuesProps) {
  const { tab, families, metrics, selected, today, perms } = props;
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [filters, setFilters] = useState<CallFilters>(NO_CALL_FILTERS);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [busy, start] = useTransition();
  const shown = useMemo(() => filterFamilies(families, filters), [families, filters]);
  const filtered = hasCallFilters(filters);
  // Draw the first page of families, not all ~260 twice over (desk table and
  // phone cards): the page was 2.69 MB of HTML on the school-day run
  // (accountant B3). The count kept is tied to the filters it was raised for,
  // so a new search starts at one page again without an effect.
  const [more, setMore] = useState<{ filters: CallFilters; n: number }>({ filters: NO_CALL_FILTERS, n: CALL_PAGE });
  const limit = more.filters === filters ? more.n : CALL_PAGE;
  const visible = useMemo(() => {
    const page = shown.slice(0, limit);
    return selected && !page.some((f) => f.key === selected.key) && shown.some((f) => f.key === selected.key) ? [...page, selected] : page;
  }, [shown, limit, selected]);
  const hidden = Math.max(0, shown.length - limit);
  const nextFamily = selected ? (shown[shown.findIndex((f) => f.key === selected.key) + 1] ?? null) : null;

  const latestPromise = useMemo(() => {
    const m = new Map<string, PromiseView>();
    for (const pv of props.promises) if (!m.has(pv.familyKey)) m.set(pv.familyKey, pv);
    return m;
  }, [props.promises]);

  const promToday = props.promises.filter((pv) => pv.promisedOn === today);
  const keptToday = promToday.filter((pv) => pv.state === "kept").length;
  const promBroken = props.promises.filter((pv) => pv.state === "broken");
  const promUpcoming = props.promises.filter((pv) => pv.state === "upcoming" && pv.promisedOn !== today);
  const promKept = props.promises.filter((pv) => pv.state === "kept" && pv.promisedOn !== today);
  const callTarget = Math.max(metrics.callsToday, families.length, 1);

  const setQuery = (query: string) => {
    setFilters((f) => ({ ...f, query }));
    if (tab !== "call") router.push(duesHref("call"));
  };
  const toggle = (key: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const selected_ = shown.filter((f) => sel.has(f.key));
  // "Select all" means the families on screen, never the pages not drawn yet.
  const allOn = visible.length > 0 && visible.every((f) => sel.has(f.key));

  const familyHref = (f: Pick<DuesFamily, "key">, more: Record<string, string> = {}) => duesHref(tab, { family: f.key, ...more });
  const callHref = (f: Pick<DuesFamily, "key">) => duesHref(tab, { family: f.key, sheet: "call", dial: "1" });
  /** Call: the phone dials (tel:) and the log sheet opens with the call in progress. */
  const dial = (f: DuesFamily) => () => router.push(callHref(f));

  function lastLine(f: DuesFamily): { text: string; when: string; tone: string } {
    const pv = latestPromise.get(f.key);
    const at = f.lastContact?.lastContactedAt ?? null;
    if (pv && pv.state === "broken" && (!at || pv.createdAt >= at)) return { text: tx(W.promiseBroken), when: day(pv.promisedOn), tone: "var(--bad)" };
    if (at) {
      const outcome = f.lastContact?.lastOutcome ?? null;
      const channel = f.lastContact?.lastChannel ?? null;
      const outcomeText = outcome ? tx(LOG_OUTCOME_WORD[outcome] ?? LOG_OUTCOME_WORD.other) : "";
      const text = channel && channel !== "call" ? `${tx(CHANNEL_WORD[channel] ?? CHANNEL_WORD.call)}${outcome && outcome !== "other" ? ` · ${outcomeText}` : ""}` : outcomeText || tx(CHANNEL_WORD.call);
      return { text, when: day(at), tone: contactTone(outcome, channel) };
    }
    return { text: tx(W.notCalled), when: tx(fill(W.dueSince, { date: dayMonth(addDays(today, -Math.max(0, f.days))) })), tone: "var(--sub)" };
  }

  function queueSelected() {
    const picked = selected_;
    start(async () => {
      let saved = 0;
      let failed: string | null = null;
      for (const f of picked) {
        const res = await queueFamilyReminderAction({ studentIds: f.kids.map((k) => k.studentId), sessionLabel: props.sessionLabel, familyName: f.fatherName, template: "gentle", amount: f.pendingToday });
        if (res?.ok) saved += 1;
        else failed = res?.error ?? failed;
      }
      setSel(new Set());
      toast.show({ text: failed && saved === 0 ? failed : tx(fill(W.bulkDone, { n: saved })), tone: failed ? "bad" : "info" });
    });
  }

  const kidPill = (label: string, key: string) => (
    <span key={key} className="pill" style={{ height: 24, background: "var(--s2)", color: "var(--fg)", border: "1px solid var(--bd)", fontWeight: 600 }}>{label}</span>
  );
  const amountCell = (f: DuesFamily) => (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{rupees(f.pendingToday)}</span>
      <span className="num" style={{ fontSize: 11, color: "var(--sub)", whiteSpace: "nowrap" }}>{f.lateFee > 0 ? tx(fill(W.lateApartAmt, { amt: rupees(f.lateFee) })) : tx(W.noLateFee)}</span>
    </span>
  );
  const daysPill = (f: DuesFamily) => {
    const t = dayTone(f.days);
    return <span className="pill num" style={{ background: t.bg, color: t.fg }}>{tx(fill(W.daysN, { n: f.days }))}</span>;
  };
  const lastCell = (f: DuesFamily) => {
    const l = lastLine(f);
    return (
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0, fontSize: 13 }}>
        <span className="clip" style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
          <span style={{ flex: "none", width: 8, height: 8, borderRadius: 4, background: l.tone }} />
          <span className="clip">{l.text}</span>
        </span>
        <span style={{ fontSize: 12, color: "var(--mut)", paddingLeft: 14 }}>{l.when}</span>
      </span>
    );
  };
  const rowActions = (f: DuesFamily, phone: boolean) => {
    const st: CSSProperties = phone ? { width: "auto", height: 44, padding: "0 8px", fontSize: 13 } : { width: 36, height: 36, padding: 0, borderRadius: 11 };
    return (
      <span style={phone ? { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, gridColumn: "2 / 4" } : { display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <a href={telHref(f.phone)} onClick={dial(f)} className="tap btn soft" aria-label={tx(fill(W.callOne, { name: f.fatherName }))} title={tx(W.call)} style={st}>
          <Ic n="phone" size={16} />
          {phone ? <span style={{ fontWeight: 600 }}>{tx(W.call)}</span> : null}
        </a>
        {perms.log ? (
          <Link href={familyHref(f, { sheet: "wa" })} prefetch={false} className="tap btn sec" aria-label={tx(fill(W.waOne, { name: f.fatherName }))} title={tx(W.whatsapp)} style={st}>
            <Ic n="message" size={16} />
            {phone ? <span style={{ fontWeight: 600 }}>{tx(W.whatsapp)}</span> : null}
          </Link>
        ) : null}
        {perms.log ? (
          <Link href={familyHref(f, { sheet: "call" })} prefetch={false} className="tap btn sec" aria-label={tx(fill(W.logOne, { name: f.fatherName }))} title={tx(W.logCall)} style={st}>
            <Ic n="edit" size={16} />
            {phone ? <span style={{ fontWeight: 600 }}>{tx(W.logShort)}</span> : null}
          </Link>
        ) : null}
      </span>
    );
  };

  const callList = (
    <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="hs" role="group" aria-label={tx(W.cls)} style={{ display: "flex", gap: 6 }}>
        {BANDS.map((b) => (
          <Chip key={b.value} on={filters.band === b.value} onClick={() => setFilters((f) => ({ ...f, band: f.band === b.value ? "" : b.value }))}>{tx(b.pair)}</Chip>
        ))}
        <Chip on={filters.inst === "i2"} onClick={() => setFilters((f) => ({ ...f, inst: f.inst === "i2" ? "" : "i2" }))} style={{ marginLeft: 8 }}>{tx(W.inst2Only)}</Chip>
        <Chip on={filters.inst === "i12"} onClick={() => setFilters((f) => ({ ...f, inst: f.inst === "i12" ? "" : "i12" }))}>{tx(W.inst12)}</Chip>
        <Chip on={filters.big} onClick={() => setFilters((f) => ({ ...f, big: !f.big }))} style={{ marginLeft: 8 }}>{tx(W.over5k)}</Chip>
        <Chip on={filters.bus} onClick={() => setFilters((f) => ({ ...f, bus: !f.bus }))}>{tx(W.usesBus)}</Chip>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 4px", fontSize: 12, color: "var(--mut)" }}>
        <span>
          <b className="num" style={{ color: "var(--fg)" }}>{shown.length}</b> {tx(shown.length === 1 ? W.familyToCall : W.familiesToCall)}
        </span>
        <span className="hide-m">{tx(W.sortNote)}</span>
      </div>

      {shown.length > 0 ? (
        <>
          {/* desk: one grid table */}
          <div className="only-d card" role="table" aria-label={tx(W.tabCall)} style={{ overflow: "hidden" }}>
            {selected ? null : (
              <div role="row" style={{ display: "grid", gridTemplateColumns: TRACKS, gap: 10, alignItems: "center", height: 44, padding: "0 14px 0 6px", background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
                {perms.log ? <Check on={allOn} onToggle={() => setSel(allOn ? new Set() : new Set(visible.map((f) => f.key)))} label={tx(W.selectAll)} /> : <span />}
                <span role="columnheader" className="sech">{tx(W.family)}</span>
                <span role="columnheader" className="sech">{tx(W.children)}</span>
                <span role="columnheader" className="sech" style={{ textAlign: "right" }}>{tx(W.pendingToday)}</span>
                <span role="columnheader" className="sech">{tx(W.overdue)}</span>
                <span role="columnheader" className="sech">{tx(W.lastContact)}</span>
                <span />
              </div>
            )}
            {visible.map((f, i) => (
              <div key={f.key} role="row" className={`row${selected?.key === f.key ? " sel" : ""}`} style={{ display: "grid", gridTemplateColumns: selected ? TRACKS_CMP : TRACKS, gap: 10, alignItems: "center", minHeight: 64, padding: "0 14px 0 6px", borderTop: i === 0 && selected ? 0 : "1px solid var(--bd)", overflow: "hidden", animation: `xIn .32s var(--ease) ${delay(i)} both` }}>
                {perms.log ? <Check on={sel.has(f.key)} onToggle={() => toggle(f.key)} label={tx(fill(W.selectOne, { name: f.fatherName }))} /> : <span />}
                <NavLink href={familyHref(f)} prefetch={false} className="tap" title={f.fatherName} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "10px 0", minWidth: 0, color: "var(--fg)" }}>
                  <span className="clip" style={{ maxWidth: "100%", fontSize: 15, fontWeight: 600 }}>{f.fatherName}</span>
                  <span className="num clip" style={{ maxWidth: "100%", fontSize: 12, color: "var(--mut)" }}>{maskPhone(f.phone)}</span>
                </NavLink>
                {selected ? null : <span style={{ display: "flex", flexWrap: "wrap", gap: 4, minWidth: 0 }}>{f.kids.map((k) => kidPill(`${firstName(k.fullName)} · ${k.classLabel}`, k.studentId))}</span>}
                {amountCell(f)}
                <span>{daysPill(f)}</span>
                {selected ? null : lastCell(f)}
                {rowActions(f, false)}
              </div>
            ))}
          </div>

          {/* phone: a card per family */}
          <div className="only-m" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visible.map((f, i) => (
              <div key={f.key} style={{ display: "grid", gridTemplateColumns: "40px minmax(0, 1fr) auto", gap: 6, alignItems: "start", padding: "8px 12px 12px 4px", border: "1px solid var(--bd)", borderRadius: 18, background: "var(--card)", boxShadow: "var(--sh)", animation: `xIn .32s var(--ease) ${delay(i)} both` }}>
                {perms.log ? <Check on={sel.has(f.key)} onToggle={() => toggle(f.key)} label={tx(fill(W.selectOne, { name: f.fatherName }))} /> : <span />}
                <NavLink href={familyHref(f)} prefetch={false} className="tap" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", paddingTop: 8, minWidth: 0, color: "var(--fg)" }}>
                  <span className="clip" style={{ maxWidth: "100%", fontSize: 15, fontWeight: 600 }}>{f.fatherName}</span>
                  <span className="num clip" style={{ maxWidth: "100%", fontSize: 12, color: "var(--mut)" }}>{maskPhone(f.phone)}</span>
                </NavLink>
                <span style={{ paddingTop: 8 }}>{amountCell(f)}</span>
                <span style={{ gridColumn: 2, display: "flex", flexWrap: "wrap", gap: 4, minWidth: 0 }}>{f.kids.map((k) => kidPill(`${firstName(k.fullName)} · ${k.classLabel}`, k.studentId))}</span>
                <span style={{ gridColumn: 3, justifySelf: "end" }}>{daysPill(f)}</span>
                <span style={{ gridColumn: "2 / 4" }}>{lastCell(f)}</span>
                {rowActions(f, true)}
              </div>
            ))}
          </div>
          {hidden > 0 ? (
            <Btn variant="sec" full onClick={() => setMore({ filters, n: limit + CALL_PAGE })}>{tx(fill(W.showMore, { n: Math.min(hidden, CALL_PAGE) }))}</Btn>
          ) : null}
        </>
      ) : filtered ? (
        <DuesEmpty icon="filter" bg="var(--s2)" fg="var(--mut)" title={tx(W.noMatch)} sub={tx(W.noMatchBody)} action={<Btn variant="sec" onClick={() => setFilters(NO_CALL_FILTERS)}>{tx(W.clearFilters)}</Btn>} />
      ) : (
        <DuesEmpty icon="check" bg="var(--oks)" fg="var(--ok)" title={tx(W.allDone)} sub={tx(W.allDoneSub)} action={<Btn variant="sec" href={duesHref("prom")}>{tx(W.seePromises)}</Btn>} />
      )}

      {props.lateFeeOnly.count > 0 ? (
        <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px", fontSize: 12, color: "var(--mut)" }}>
          <Ic n="info" size={15} />
          {props.lateFeeOnly.count === 1 ? tx(W.lateOnlyOne) : tx(fill(W.lateOnlyLine, { n: props.lateFeeOnly.count }))}
        </span>
      ) : null}

      {selected_.length > 0 ? (
        <>
          {[false, true].map((phone) => (
            <div key={String(phone)} className={`glass ${phone ? "only-m" : "only-d"}`} style={{ position: "sticky", bottom: phone ? "calc(88px + env(safe-area-inset-bottom))" : 12, zIndex: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderRadius: 18, border: "1px solid var(--bds)", boxShadow: "var(--shh)", animation: "xToast .32s var(--spring) both" }}>
              <span style={{ display: "flex", flexDirection: "column", paddingLeft: 4, marginRight: "auto" }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{tx(fill(W.selectedN, { n: selected_.length }))}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(fill(W.bulkCost, { n: selected_.length, cost: rupees(Math.max(1, Math.round(selected_.length * WA_COST))) }))}</span>
              </span>
              <Btn variant="ghost" onClick={() => setSel(new Set())}>{tx(W.clear)}</Btn>
              <Btn variant="pri" icon="send" disabled={busy} onClick={queueSelected}>{tx(fill(W.queueFor, { n: selected_.length }))}</Btn>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );

  const promiseRow = (pv: PromiseView, i: number) => {
    const famIdx = families.findIndex((f) => f.key === pv.familyKey);
    const tone = TONES[(famIdx >= 0 ? famIdx : i) % TONES.length];
    const look =
      pv.state === "kept"
        ? { bg: "var(--oks)", fg: "var(--ok)", text: tx(W.kept) }
        : pv.state === "broken"
          ? { bg: "var(--bads)", fg: "var(--bad)", text: (() => { const n = Math.max(1, -Math.round((new Date(`${pv.promisedOn}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000)); return n === 1 ? tx(W.dayLate) : tx(fill(W.daysLate, { n })); })() }
          : pv.promisedOn === today
            ? { bg: "var(--infos)", fg: "var(--info)", text: pv.kind === "visit" ? tx(W.comingToday) : tx(W.due) }
            : { bg: "var(--s2)", fg: "var(--mut)", text: pv.kind === "visit" ? tx(fill(W.visitOn, { date: day(pv.promisedOn) })) : day(pv.promisedOn) };
    const made = `${tx(fill(W.made, { date: day(pv.createdAt) }))}${pv.by ? ` · ${pv.by}` : ""}`;
    const lineText = pv.kind === "visit" ? `${tx(W.visitWord)} · ${made}` : pv.state === "broken" ? `${tx(fill(W.wasDue, { date: day(pv.promisedOn) }))} · ${made}` : made;
    const fam = families.find((f) => f.key === pv.familyKey);
    return (
      <ListLine
        key={pv.id}
        first={i === 0}
        i={i}
        href={duesHref(tab, { family: pv.familyKey })}
        avatar={{ text: ini(pv.fatherName), bg: tone[0], fg: tone[1] }}
        name={pv.fatherName}
        sub={fam ? kidsShort(fam) : pv.kidsLine}
        amount={pv.kind === "visit" && !pv.amount ? "—" : rupees(pv.amount)}
        status={look}
        line={{ dot: look.fg === "var(--mut)" ? "var(--sub)" : look.fg, text: lineText }}
        actions={
          pv.state === "kept" ? (
            pv.receiptNumber ? (
              <Btn variant="ghost" icon="fileText" href={`/receipts/${encodeURIComponent(pv.receiptNumber)}`} style={{ ...small, color: "var(--ok)" }}>{pv.receiptNumber}</Btn>
            ) : null
          ) : (
            <>
              {perms.log ? <Btn variant="sec" icon="phone" href={duesHref(tab, { family: pv.familyKey, sheet: "call" })} style={small}>{tx(W.callAgain)}</Btn> : null}
              {perms.collect ? <Btn variant="soft" icon="check" href={`/payments?student=${pv.studentId}`} style={small}>{tx(W.markPaid)}</Btn> : null}
            </>
          )
        }
      />
    );
  };

  const promiseBands: { key: string; dot: string; label: string; hint?: string; rows: PromiseView[] }[] = [
    { key: "today", dot: "var(--info)", label: `${tx(W.pToday)} · ${day(today)}`, hint: `${keptToday} ${tx(W.keptSoFar)}`, rows: promToday },
    { key: "broken", dot: "var(--bad)", label: tx(W.pBroken), hint: tx(W.pBrokenSub), rows: promBroken },
    { key: "up", dot: "var(--sub)", label: tx(W.pUpcoming), hint: tx(W.pUpcomingSub), rows: promUpcoming },
    { key: "kept", dot: "var(--ok)", label: tx(W.pKept), rows: promKept },
  ].filter((b) => b.rows.length > 0);

  const promisesTab =
    props.promises.length === 0 ? (
      <DuesEmpty icon="flag" bg="var(--s2)" fg="var(--mut)" title={tx(W.noPromises)} sub={tx(W.noPromisesBody)} />
    ) : (
      promiseBands.map((b) => (
        <Band key={b.key} dot={b.dot} label={b.label} hint={b.hint} sum={`${rupees(b.rows.reduce((s, pv) => s + pv.amount, 0))} · ${b.rows.length}`}>
          {b.rows.map(promiseRow)}
        </Band>
      ))
    );

  const leftTab =
    props.left.length === 0 ? (
      <DuesEmpty icon="door" bg="var(--s2)" fg="var(--mut)" title={tx(W.noLeft)} sub={tx(W.noLeftBody)} />
    ) : (
      <Band dot="var(--warn)" label={tx(W.leftTitle)} hint={tx(W.leftSub)} sum={`${rupees(props.left.reduce((s, l) => s + l.owed, 0))} · ${props.left.length}`}>
        {props.left.map((l: LeftView, i) => {
          const pending = l.writeOff?.status === "pending";
          const subParts = [tx(fill(W.lastClass, { cls: l.classLabel ?? "—" })), l.fatherName, l.phone ? maskPhone(l.phone) : null].filter(Boolean);
          return (
            <ListLine
              key={l.studentId}
              first={i === 0}
              i={i}
              avatar={{ text: ini(l.fullName), bg: "var(--s3)", fg: "var(--mut)" }}
              name={l.fullName}
              sub={subParts.join(" · ")}
              amount={rupees(l.owed)}
              status={{ text: tx(STATUS_WORD[l.status] ?? W.status_left), bg: "var(--warns)", fg: "var(--warnfg)" }}
              line={pending ? { dot: "var(--info)", text: `${tx(W.woPending)} · ${rupees(l.writeOff?.amount ?? 0)}${l.writeOff?.by ? ` · ${l.writeOff.by}` : ""}` } : { dot: "var(--sub)", text: l.lastPaymentDate ? `${tx(W.lastPaid)} · ${day(l.lastPaymentDate)}` : tx(W.notCalled) }}
              actions={
                <>
                  {l.phone ? (
                    <a href={telHref(l.phone)} className="tap btn soft" style={small}>
                      <Ic n="phone" size={16} />
                      {tx(W.call)}
                    </a>
                  ) : null}
                  {pending ? (
                    perms.writeOff ? (
                      <Btn variant="soft" icon="clock" href={duesHref("left", { wo: l.studentId, sheet: "wo" })} style={{ ...small, color: "var(--info)" }}>{tx(W.woDecideShort)}</Btn>
                    ) : (
                      <span className="tap btn soft" style={{ ...small, color: "var(--info)" }}>
                        <Ic n="clock" size={16} />
                        {tx(W.waitingAdmin)}
                      </span>
                    )
                  ) : perms.log || perms.writeOff ? (
                    <Btn variant="ghost" icon="flag" href={duesHref("left", { wo: l.studentId, sheet: "wo" })} style={{ ...small, color: "var(--bad)" }}>{tx(perms.writeOff ? W.woApprove : W.requestWriteOff)}</Btn>
                  ) : null}
                </>
              }
            />
          );
        })}
      </Band>
    );

  const buckets = props.aging.buckets;
  const maxB = Math.max(1, ...buckets.map((b) => b.amount));
  const bucketColor: Record<string, string> = { "1-30": "var(--c2)", "31-60": "var(--c3)", "61-90": "var(--warn)", "90+": "var(--bad)" };
  const biggest = [...buckets].sort((a, b) => b.amount - a.amount)[0];
  const top = props.aging.top;
  const topMax = Math.max(1, top[0]?.pendingToday ?? 1);
  const cls = props.aging.classByInst;
  type HeatKey = "inst1" | "inst2" | "inst3" | "inst4" | "other" | "lastYear";
  const col = (k: HeatKey | "total") => cls.reduce((s, r) => s + r[k], 0);
  // Inst 1, Inst 2 and last year always; a later installment or a plan row once it holds overdue money.
  const heatKeys: HeatKey[] = (["inst1", "inst2", "inst3", "inst4", "other", "lastYear"] as const).filter((k) => k === "inst1" || k === "inst2" || k === "lastYear" || col(k) > 0);
  const heatLabel: Record<HeatKey, Pair> = { inst1: W.inst1, inst2: W.inst2, inst3: W.inst3, inst4: W.inst4, other: W.instOther, lastYear: W.lastYear };
  const hmax = Math.max(1, ...cls.flatMap((r) => heatKeys.map((k) => r[k])));
  const heatCell = (v: number, i: number, j: number) => (
    <span key={j} className="num" style={{ height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 8px", fontSize: 12, fontWeight: 600, background: v ? `rgba(var(--heat), ${(0.08 + (0.52 * v) / hmax).toFixed(2)})` : "var(--s2)", animation: `xFade .5s ease ${i * 22 + j * 60}ms both` }}>
      {v ? rupees(v) : "—"}
    </span>
  );
  const HEAT_COLS = `minmax(76px, 1.1fr) repeat(${heatKeys.length + 1}, minmax(0, 1fr))`;

  const agingTab = (
    <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{tx(W.howLate)}</h2>
            <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(fill(W.amtPendingToday, { amt: lakh(metrics.pendingToday) }))}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
            {buckets.map((b, i) => (
              <div key={b.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 6, height: 216, textAlign: "center" }}>
                <span className="num" style={{ fontSize: 13, fontWeight: 700, animation: `xFade .4s ease ${i * 90}ms both` }}>{lakh(b.amount)}</span>
                <span style={{ width: "100%", maxWidth: 64, height: Math.max(6, Math.round((b.amount / maxB) * 132)), borderRadius: "10px 10px 3px 3px", background: bucketColor[b.key], transformOrigin: "bottom", animation: `xGrowY .7s var(--ease) ${i * 90}ms both` }} />
                <span style={{ fontSize: 12, fontWeight: 700, borderTop: "1px solid var(--bd)", alignSelf: "stretch", paddingTop: 6 }}>{tx(fill(W.daysN, { n: b.key.replace("-", "–") }))}</span>
                <span className="num" style={{ fontSize: 11, color: "var(--mut)", marginTop: -6 }}>{tx(fill(W.nStudents, { n: b.students }))}</span>
              </div>
            ))}
          </div>
          {biggest && biggest.amount > 0 ? (
            <div style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 14, fontSize: 13, lineHeight: 1.5, background: "var(--accs)", color: "var(--accfg)" }}>
              <Ic n="zap" />
              <span>{tx(biggest.key === "1-30" ? W.agingTipNew : W.agingTipOld)}</span>
            </div>
          ) : null}
        </div>
        <div className="card" style={{ padding: "16px 18px 10px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{tx(W.top10)}</h2>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.byPending)}</span>
          </div>
          {top.map((f, i) => {
            const t = dayTone(f.days);
            return (
              <Link key={f.key} href={duesHref("aging", { family: f.key })} className="tap row" style={{ display: "grid", gridTemplateColumns: "22px minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "7px 6px", borderRadius: 10, color: "var(--fg)", animation: `xIn .3s var(--ease) ${i * 40}ms both` }}>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)" }}>{i + 1}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span className="clip" style={{ fontSize: 13, fontWeight: 600 }}>{f.fatherName}</span>
                    <span className="pill num" style={{ height: 18, fontSize: 10, background: t.bg, color: t.fg }}>{f.days}d</span>
                  </span>
                  <span style={{ display: "block", height: 5, borderRadius: 3, background: "var(--s3)" }}>
                    <span style={{ display: "block", height: 5, width: `${Math.round((f.pendingToday / topMax) * 100)}%`, borderRadius: 3, background: "var(--c1)", transformOrigin: "left", animation: `xGrowX .6s var(--ease) ${i * 40}ms both` }} />
                  </span>
                </span>
                <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{rupees(f.pendingToday)}</span>
              </Link>
            );
          })}
        </div>
      </div>
      <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{tx(W.classByInst)}</h2>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.classByInstNote)}</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--mut)" }}>
            {tx(W.less)}
            <span style={{ width: 90, height: 10, borderRadius: 5, background: "linear-gradient(90deg, rgba(var(--heat), .08), rgba(var(--heat), .6))" }} />
            {tx(W.more)}
          </span>
        </div>
        <div role="table" aria-label={tx(W.classByInst)} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div role="row" style={{ display: "grid", gridTemplateColumns: HEAT_COLS, gap: 4, alignItems: "center" }}>
            {[W.cls, ...heatKeys.map((k) => heatLabel[k]), W.total].map((h, j) => (
              <span key={h.en} role="columnheader" style={{ height: 24, display: "flex", alignItems: "center", justifyContent: j ? "flex-end" : "flex-start", padding: j ? "0 8px" : 0, fontSize: 12, fontWeight: 700 }}>{tx(h)}</span>
            ))}
          </div>
          {cls.map((r, i) => (
            <div key={r.classLabel} role="row" style={{ display: "grid", gridTemplateColumns: HEAT_COLS, gap: 4, alignItems: "center" }}>
              <span className="clip" style={{ fontSize: 12, fontWeight: 600 }}>{r.classLabel}</span>
              {heatKeys.map((k, j) => heatCell(r[k], i, j))}
              <span className="num" style={{ height: 28, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 8px", fontSize: 12, fontWeight: 700 }}>{rupees(r.total)}</span>
            </div>
          ))}
          <div role="row" style={{ display: "grid", gridTemplateColumns: HEAT_COLS, gap: 4, alignItems: "center", borderTop: "2px solid var(--bd)", paddingTop: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{tx(W.allClasses)}</span>
            {[...heatKeys, "total" as const].map((k) => (
              <span key={k} className="num" style={{ height: 30, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 8px", fontSize: 12, fontWeight: 700 }}>{lakh(col(k))}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // Every promise still open: due today, coming up or broken. Counting only
  // today's said "Promises 0" over a broken ₹88,100 promise (TEST school day,
  // 6 Nov 2026, accountant P3).
  const tabCounts: Record<DuesTab, string> = { call: String(families.length), prom: String(props.promises.filter((pv) => pv.state !== "kept").length), left: String(props.left.length), aging: "" };
  const first = shown[0] ?? families[0] ?? null;

  const list = (
    <section className={`pad${selected ? " hide-m" : ""}`} style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      {/* On a phone, two tiles and then the call list: four tiles pushed the first
          family below the fold (UX review 6 Nov 2026). Promises keep their count
          on the tab; the week's takings stay on the desk. */}
      <Grid cols={selected ? 2 : 4}>
        <Tile label={tx(W.pendingToday)} value={lakh(metrics.pendingToday)} sub={tx(fill(W.kpiPendingSub, { n: metrics.students, amt: lakh(metrics.notDueYet) }))} delayMs={0} />
        <Tile label={tx(W.promisesToday)} value={metrics.promisesToday} sub={tx(fill(W.kpiPromSub, { amt: rupees(promToday.reduce((s, pv) => s + pv.amount, 0)), n: metrics.promisesKeptToday }))} delayMs={28} href={duesHref("prom")} deskOnly />
        <Tile label={tx(W.callsToday)} value={metrics.callsToday} unit={` ${tx(W.of)} ${callTarget}`} sub={tx(fill(W.leftToMake, { n: Math.max(0, callTarget - metrics.callsToday) }))} ring={Math.min(1, metrics.callsToday / callTarget)} delayMs={56} />
        <Tile label={tx(W.collectedWeek)} value={lakh(metrics.collectedWeek)} sub={weekLine(today)} tone="var(--ok)" delayMs={84} deskOnly />
      </Grid>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Seg<DuesTab>
          label={tx(W.title)}
          value={tab}
          onChange={(v) => router.push(duesHref(v))}
          style={{ width: 470, maxWidth: "100%" }}
          options={(["call", "prom", "left", "aging"] as const).map((v) => ({
            value: v,
            label: (
              <>
                {tx({ call: W.tabCall, prom: W.tabProm, left: W.tabLeft, aging: W.tabAging }[v])}
                {tabCounts[v] ? <span className="num hide-m" style={{ fontWeight: 600, color: "var(--sub)" }}> {tabCounts[v]}</span> : null}
              </>
            ),
          }))}
        />
        <span className="hide-m" style={{ flex: 1 }} />
        <FamilySearch value={filters.query} onChange={setQuery} />
        <FamilySearch value={filters.query} onChange={setQuery} phone />
      </div>

      {tab === "call" ? callList : null}
      {tab === "prom" ? promisesTab : null}
      {tab === "left" ? leftTab : null}
      {tab === "aging" ? agingTab : null}
    </section>
  );

  return (
    <VxPage>
      <TopBar
        crumb={`${tx(W.money)} · ${day(today)}`}
        title={tx(W.title)}
        mTitle={selected ? selected.fatherName : tx(W.title)}
        mSub={selected ? kidsShort(selected) : tx(fill(W.mSub, { amt: lakh(metrics.pendingToday), n: metrics.students }))}
        mBack={selected ? duesHref(tab) : "/menu"}
        actions={
          <>
            {perms.callSheet ? <Btn variant="sec" icon="download" href={`/fees/exports/defaulters?format=pdf&session=${encodeURIComponent(props.sessionLabel)}`} target="_blank">{tx(W.callSheet)}</Btn> : null}
            {first ? (
              <a href={telHref(first.phone)} onClick={dial(first)} className="tap btn pri">
                <Ic n="phone" />
                {tx(W.callNextFamily)}
              </a>
            ) : null}
          </>
        }
        mAction={
          selected ? (
            <a href={telHref(selected.phone)} onClick={dial(selected)} className="tap btn soft" style={{ height: 40, padding: "0 12px", fontSize: 13 }}>
              <Ic n="phone" size={16} />
              {tx(W.call)}
            </a>
          ) : first ? (
            <a href={telHref(first.phone)} onClick={dial(first)} className="tap btn soft" style={{ height: 40, padding: "0 12px", fontSize: 13 }}>
              <Ic n="phone" size={16} />
              {tx(W.callNext)}
            </a>
          ) : null
        }
      />
      <main>
        <div className="stack" style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0, 1fr) 440px" : "minmax(0, 1fr)", alignItems: "start", minHeight: "100%" }}>
          {list}
          {selected ? (
            <aside className="unstick" style={{ position: "sticky", top: 64, height: "calc(100dvh - 64px)", overflowY: "auto", borderLeft: "1px solid var(--bd)", background: "var(--bg)", animation: "xPush .36s var(--ease) both" }}>
              <FamilyPanel key={selected.key} {...props} family={selected} nextHref={nextFamily ? familyHref(nextFamily) : null} />
            </aside>
          ) : null}
        </div>
      </main>
      {props.writeOffFor ? <WriteOffSheet key={props.writeOffFor.studentId} row={props.writeOffFor} sessionLabel={props.sessionLabel} open={props.sheet === "wo"} canDecide={perms.writeOff} /> : null}
    </VxPage>
  );
}
