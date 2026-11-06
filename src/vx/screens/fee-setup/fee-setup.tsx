"use client";

import "./fee-setup.css";

import { useRouter } from "next/navigation";
import { Fragment, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";

import { askAdminFeeChangeAction, publishFeeSetupAction } from "@/app/(app)/fee-setup/actions";
import { INITIAL_FEE_SETUP_ACTION_STATE, type FeeSetupActionState } from "@/modules/fees/domain/types";
import {
  bandOf,
  describeDiscount,
  diffDrafts,
  draftToFormData,
  isDateLocked,
  lateFeeFor,
  perInstallment,
  raiseTuition,
  ruleCode,
  type DiscountDraft,
  type DraftChange,
  type FeeSetupDraft,
} from "@/modules/fees/vx/domain/fee-setup";
import type { FeeSetupVxData } from "@/modules/fees/vx/fee-setup-data";
import { agoP, rupees, rupeesShort } from "@/vx/format";
import { useVx, type Pair } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { TopBar, VxPage } from "@/vx/ui/page";
import { Btn, EmptyState } from "@/vx/ui/primitives";

import { BAND_WORD, F, ROW_WORD } from "./words";

export type FeeSetupView = "structure" | "edit" | "copy" | "installments" | "discounts" | "rule" | "latefee" | "transport" | "route" | "review" | "history";
type Tab = "structure" | "installments" | "discounts" | "latefee" | "transport";
type SheetName = "" | "copy" | "rule" | "route" | "review" | "history" | "ask";
type Tx = (p: Pair | string) => string;

const TABS: { key: Tab; icon: IconName; label: Pair }[] = [
  { key: "structure", icon: "layers", label: F.structure },
  { key: "installments", icon: "calendar", label: F.installments },
  { key: "discounts", icon: "percent", label: F.discounts },
  { key: "latefee", icon: "clock", label: F.latefee },
  { key: "transport", icon: "bus", label: F.transport },
];
const BAND_ORDER = ["pre", "primary", "middle", "secondary", "senior", "other"];
const C4 = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--acc)", "var(--warn)"];

function tabOf(view: FeeSetupView): Tab {
  if (view === "edit" || view === "copy" || view === "review" || view === "history") return "structure";
  if (view === "rule") return "discounts";
  if (view === "route") return "transport";
  return view;
}
function sheetOf(view: FeeSetupView): SheetName {
  return view === "copy" || view === "rule" || view === "route" || view === "review" || view === "history" ? view : "";
}

const range = (nos: number[]) => (nos.length === 0 ? "" : nos.length === 1 ? String(nos[0]) : `${nos[0]}–${nos[nos.length - 1]}`);
const delay = (i: number) => `${Math.min(i, 14) * 30}ms`;
const signed = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${rupees(Math.abs(d))}`;
const digits = (v: string) => Math.max(0, Math.round(Number(v.replace(/\D/g, "")) || 0));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "15 Sep" and "Tue 15 Sep", as the design writes dates. */
const dm = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MON[m - 1] ?? ""}`;
};
const ddm = (iso: string) => `${DOW[new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay()]} ${dm(iso)}`;
const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const streamOf = (label: string) => (/science/i.test(label) ? "science" : /commerce/i.test(label) ? "commerce" : /arts|humanities/i.test(label) ? "arts" : "");

/**
 * The table's rows, as the design draws them: one row per class band (one per
 * stream in 11–12) when every class in it pays the same tuition today, so
 * editing the row sets the fee for each of those classes; a band whose classes
 * pay different fees shows one row per class.
 */
type FeeRow = { key: string; band: string; name: string; sub: string; labels: string[] };

function classRange(labels: string[]): string {
  const nums = labels.map((l) => /^class\s+(\d{1,2})$/i.exec(l)?.[1]);
  if (labels.length > 1 && nums.every(Boolean)) return `Class ${nums[0]}–${nums[nums.length - 1]}`;
  const streams = labels.map((l) => /^(\d{1,2})\s+(.+)$/.exec(l));
  if (labels.length > 1 && streams.every((m) => m && m[2] === streams[0]?.[2])) return `${streams.map((m) => m![1]).join(" and ")} ${streams[0]![2]}`;
  return labels.join(" · ");
}

function feeRows(base: FeeSetupDraft, tx: Tx): FeeRow[] {
  const groups = new Map<string, string[]>();
  for (const c of base.classRows) {
    const band = bandOf(c.label);
    const key = band === "other" ? `class:${c.label}` : band === "senior" ? `senior:${streamOf(c.label) || c.label}` : band;
    groups.set(key, [...(groups.get(key) ?? []), c.label]);
  }
  const fee = new Map(base.classRows.map((c) => [c.label, c.annualTuition]));
  const rows: FeeRow[] = [];
  for (const band of BAND_ORDER) {
    for (const [key, labels] of groups) {
      if ((key.startsWith("class:") ? "other" : key.split(":")[0]) !== band) continue;
      const word = ROW_WORD[key];
      const same = labels.every((l) => fee.get(l) === fee.get(labels[0]));
      if (word && same && labels.length > 1) rows.push({ key: `band:${key}`, band, name: tx(word), sub: classRange(labels), labels });
      else for (const l of labels) rows.push({ key: `class:${l}`, band, name: l, sub: "", labels: [l] });
    }
  }
  return rows;
}

/** The row a link names: its own key, or the row a class label sits in. */
function rowFor(rows: FeeRow[], key: string | null): FeeRow | null {
  if (!key) return null;
  return rows.find((r) => r.key === key) ?? rows.find((r) => r.labels.includes(key)) ?? null;
}

function SwitchKnob({ on }: { on: boolean }) {
  return (
    <span className={`sw${on ? " on" : ""}`}>
      <span />
    </span>
  );
}

function RadioRow({ on, onPick, label, sub, disabled }: { on: boolean; onPick: () => void; label: ReactNode; sub?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      className="tap fs-rb"
      onClick={onPick}
      style={{ minHeight: 56, padding: "10px 14px", borderRadius: 14, border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)" }}
    >
      <span style={{ flex: "none", width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
      </span>
      <span className="fs-c" style={{ flex: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
        {sub ? <span className="fs-m">{sub}</span> : null}
      </span>
    </button>
  );
}

/** −, the value, + (design `.sq` buttons around `.big`). */
function Step({ value, onDec, onInc, label, disabled, tone, width = 56 }: { value: ReactNode; onDec: () => void; onInc: () => void; label: string; disabled?: boolean; tone?: string; width?: number }) {
  return (
    <span className="fs-f" style={{ gap: 4 }}>
      <button type="button" className="tap btn sec fs-sq" aria-label={`− ${label}`} onClick={onDec} disabled={disabled}>
        <Ic n="minus" />
      </button>
      <span className="fs-big" style={{ minWidth: width, color: tone }}>{value}</span>
      <button type="button" className="tap btn sec fs-sq" aria-label={`+ ${label}`} onClick={onInc} disabled={disabled}>
        <Ic n="plus" />
      </button>
    </span>
  );
}

export function FeeSetup({
  data,
  today,
  initialView,
  initialClass,
  initialRoute,
  canEdit,
  readOnly,
  draftStart,
  notice,
}: {
  data: FeeSetupVxData;
  today: string;
  initialView: FeeSetupView;
  initialClass: string | null;
  initialRoute: string | null;
  canEdit: boolean;
  readOnly: boolean;
  /** Unsaved edits to open with (the design fixture's review state); the page always starts from the live setup. */
  draftStart?: FeeSetupDraft;
  /** A line above the tabs: where the figures came from (live from Fees). */
  notice?: ReactNode;
}) {
  const { tx } = useVx();
  const base = data.draft;
  const [draft, setDraft] = useState<FeeSetupDraft>(draftStart ?? base);
  const [tab, setTab] = useState<Tab>(tabOf(initialView));
  const [sheet, setSheet] = useState<SheetName>(sheetOf(initialView));
  const rows = feeRows(base, tx);
  const [editClass, setEditClass] = useState<string | null>(initialView === "edit" ? (rowFor(rows, initialClass)?.key ?? rows.find((r) => r.band === "middle")?.key ?? rows[0]?.key ?? null) : null);
  const [editRoute, setEditRoute] = useState<string | null>(initialView === "route" ? (initialRoute ?? base.routeRows.find((r) => r.annualFee > 0)?.routeName ?? null) : null);
  const editable = canEdit && !readOnly;
  const changes = diffDrafts(base, draft);
  const paidNos = data.paidInstallments;
  const editing = tab === "structure" && Boolean(editClass);

  const sync = (view: FeeSetupView, extra: Record<string, string | null> = {}) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    for (const k of ["class", "route"]) url.searchParams.delete(k);
    for (const [k, v] of Object.entries(extra)) if (v) url.searchParams.set(k, v);
    window.history.replaceState(null, "", url);
  };
  const goTab = (t: Tab) => {
    setTab(t);
    setSheet("");
    setEditClass(null);
    sync(t);
  };
  const open = (s: SheetName) => {
    setSheet(s);
    sync(s && s !== "ask" ? s : tab);
  };
  const close = () => {
    setSheet("");
    setEditRoute(null);
    sync(tab);
  };
  const pickClass = (label: string | null) => {
    setEditClass(label);
    sync(label ? "edit" : tab, { class: label });
  };
  const pickRoute = (name: string) => {
    setEditRoute(name);
    setSheet("route");
    sync("route", { route: name });
  };

  const help = [
    { icon: "layers" as IconName, title: tx(F.help1), body: tx(F.help1b) },
    { icon: "lock" as IconName, title: tx(F.help2), body: tx(F.help2b) },
    { icon: "clock" as IconName, title: tx(F.help3), body: tx(F.help3b) },
  ];
  const tabIdx = Math.max(0, TABS.findIndex((t) => t.key === tab));
  const editRow = rowFor(rows, editClass);
  const editStudents = editRow ? editRow.labels.reduce((n, l) => n + (data.studentsByClass[l] ?? 0), 0) : 0;
  const askNote = !canEdit ? (
    <div className="fs-nt fs-in" style={{ flexWrap: "wrap", alignItems: "center" }}>
      <Ic n="eye" />
      <span style={{ flex: "1 1 220px" }}>{tx(F.viewOnly)}</span>
      <Btn variant="soft" icon="message" onClick={() => open("ask")} disabled={readOnly} style={{ height: 34 }}>{tx(F.ask)}</Btn>
    </div>
  ) : null;

  return (
    <VxPage className={`fs-lh${editing ? " fs-editing" : ""}`}>
      <TopBar
        crumb={editing ? `${tx(F.money)} · ${tx(F.title)}` : `${tx(F.money)} · ${tx(F.session)} ${data.sessionLabel}${data.updatedAt ? ` · ${tx(F.saved)} ${tx(agoP(data.updatedAt))}` : ""}`}
        title={tx(F.title)}
        mSub={`${tx(TABS[tabIdx].label)} · ${data.sessionLabel}`}
        mBack="/menu"
        mAction={
          <button type="button" className="tap btn ghost fs-sq4" aria-label={tx(F.history)} onClick={() => open("history")} style={{ borderRadius: 22 }}>
            <Ic n="history" size={22} />
          </button>
        }
        actions={
          <>
            <HelpButton title={tx(F.title)} steps={help} />
            <Btn variant="sec" icon="history" onClick={() => open("history")}>{tx(F.history)}</Btn>
          </>
        }
      />
      {editing ? (
        <header className="only-m glass vx-top fs-mtop" style={{ flex: "none", minHeight: 58, display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--bd)" }}>
          <button type="button" className="tap btn ghost fs-sq4" aria-label={tx(F.close)} onClick={() => pickClass(null)} style={{ borderRadius: 22 }}>
            <Ic n="chevLeft" size={24} />
          </button>
          <span className="fs-c" style={{ flex: 1, paddingLeft: 2 }}>
            <span className="fs-e" style={{ fontSize: 17, fontWeight: 700 }}>{editRow?.name}</span>
            <span className="fs-m fs-e">{tx(F.editFees)} · {editStudents} {tx(F.students)}</span>
          </span>
        </header>
      ) : null}
      {notice ? <div className={`pad${editing ? " hide-m" : ""}`} style={{ paddingBottom: 0 }}>{notice}</div> : null}
      <div className={`pad fs-tabbar${editing ? " hide-m" : ""}`}>
        <div className="hs">
          <div className="seg fs-seg" role="tablist">
            <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 5)", transform: `translateX(${tabIdx * 100}%)` }} />
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tap${tab === t.key ? " on" : ""}`} onClick={() => goTab(t.key)}>
                <Ic n={t.icon} size={14} />
                {tx(t.label)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <main>
        {tab === "structure" ? (
          <div className={`stack fs-lay${editing ? " has" : ""}`}>
            <section className={`pad fs-scr${editing ? " hide-m" : ""}`} style={{ gap: 14 }}>
              <StructureTab onAsk={canEdit ? undefined : () => open("ask")} askDisabled={readOnly} data={data} rows={rows} draft={draft} base={base} paidNos={paidNos} selected={editClass} onPick={pickClass} onCopy={() => open("copy")} editable={editable} setDraft={setDraft} initialOpen={initialView === "structure" ? (rowFor(rows, initialClass)?.key ?? null) : null} />
            </section>
            {editRow ? (
              <aside className="fs-aside">
                <EditClassPanel
                  key={editRow.key}
                  row={editRow}
                  draft={draft}
                  base={base}
                  students={editStudents}
                  paidNos={paidNos}
                  editable={editable}
                  onCancel={() => pickClass(null)}
                  onSave={(tuition) => {
                    setDraft((d) => ({ ...d, classRows: d.classRows.map((c) => (editRow.labels.includes(c.label) ? { ...c, annualTuition: tuition } : c)) }));
                    pickClass(null);
                  }}
                />
              </aside>
            ) : null}
          </div>
        ) : (
          <div className="pad fs-scr">
            {askNote}
            {tab === "installments" ? <InstallmentsTab data={data} rows={rows} draft={draft} base={base} today={today} editable={editable} setDraft={setDraft} /> : null}
            {tab === "discounts" ? <DiscountsTab data={data} draft={draft} editable={editable} setDraft={setDraft} onAdd={() => open("rule")} /> : null}
            {tab === "latefee" ? <LateFeeTab draft={draft} base={base} today={today} editable={editable} setDraft={setDraft} /> : null}
            {tab === "transport" ? <TransportTab data={data} draft={draft} base={base} editable={editable} onPick={pickRoute} /> : null}
          </div>
        )}
        <div style={{ height: changes.length && editable ? 90 : 0 }} />
      </main>
      {changes.length && editable ? (
        <div className="fs-pbar">
          <div role="status">
            <span className="fs-dt" style={{ background: "var(--tacc)", animation: "xPulse 1.8s ease infinite" }} />
            <span className="fs-c" style={{ flex: 1 }}>
              <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>
                {changes.length} {tx(F.unsaved)} {tx(changes.length === 1 ? F.change1 : F.changesN)}
              </span>
              <span className="fs-e" style={{ fontSize: 12, opacity: 0.75 }}>{tx(F.barSub)}</span>
            </span>
            <button type="button" className="tap btn hide-m" onClick={() => setDraft(base)} style={{ background: "transparent", color: "var(--tfg)", opacity: 0.8 }}>{tx(F.discard)}</button>
            <button type="button" className="tap btn" onClick={() => open("review")} style={{ background: "var(--tacc)", color: "var(--tbg)" }}>
              <span className="only-m">{tx(F.reviewShort)}</span>
              <span className="hide-m">{tx(F.review)}</span>
              <Ic n="arrowRight" />
            </button>
          </div>
        </div>
      ) : null}

      <CopySheet open={sheet === "copy"} onClose={close} base={base} editable={editable} onApply={(rows) => setDraft((d) => ({ ...d, classRows: rows }))} />
      <RuleSheet open={sheet === "rule"} onClose={close} draft={draft} editable={editable} onAdd={(rule) => setDraft((d) => ({ ...d, discounts: [...d.discounts, rule] }))} />
      {sheet === "route" && editRoute !== null ? (
        <RouteSheet
          key={editRoute}
          name={editRoute}
          draft={draft}
          base={base}
          students={data.studentsByRoute[editRoute] ?? 0}
          editable={editable}
          onClose={close}
          onSave={(name, fee) => {
            setDraft((d) => (d.routeRows.some((r) => r.routeName === name) ? { ...d, routeRows: d.routeRows.map((r) => (r.routeName === name ? { ...r, annualFee: fee } : r)) } : { ...d, routeRows: [...d.routeRows, { routeName: name, annualFee: fee }] }));
            close();
          }}
        />
      ) : null}
      {sheet === "review" ? <ReviewSheet onClose={close} draft={draft} changes={changes} data={data} today={today} editable={editable} onDone={() => setDraft(base)} /> : null}
      <HistorySheet open={sheet === "history"} onClose={close} data={data} />
      <AskSheet open={sheet === "ask"} onClose={close} />
    </VxPage>
  );
}

type SetDraft = (fn: (d: FeeSetupDraft) => FeeSetupDraft) => void;

/** The installment a change lands on first: the earliest one with no receipt. */
function firstUnpaid(count: number, paidNos: number[]) {
  for (let i = 1; i <= count; i += 1) if (!paidNos.includes(i)) return i;
  return count;
}

function LockNote({ paidNos, count, tx }: { paidNos: number[]; count: number; tx: Tx }) {
  if (!paidNos.length) return null;
  const unpaid = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !paidNos.includes(n));
  return (
    <div className="fs-nt fs-wa">
      <Ic n="lock" />
      <span>
        {tx(F.lockStart)} {range(paidNos)}. <b>{tx(F.lockBold)}</b>
        {unpaid.length ? ` (${unpaid.length > 1 ? `${unpaid.slice(0, -1).join(", ")} and ${unpaid[unpaid.length - 1]}` : unpaid[0]})` : ""}.
      </span>
    </div>
  );
}

/* ---------- structure ---------- */

function StructureTab({
  onAsk,
  askDisabled,
  data,
  rows,
  draft,
  base,
  paidNos,
  selected,
  onPick,
  onCopy,
  editable,
  setDraft,
  initialOpen,
}: {
  onAsk?: () => void;
  askDisabled: boolean;
  data: FeeSetupVxData;
  rows: FeeRow[];
  draft: FeeSetupDraft;
  base: FeeSetupDraft;
  paidNos: number[];
  selected: string | null;
  onPick: (key: string) => void;
  onCopy: () => void;
  editable: boolean;
  setDraft: SetDraft;
  initialOpen: string | null;
}) {
  const { tx } = useVx();
  const [exp, setExp] = useState<string | null>(initialOpen);
  const n = draft.installmentDates.length;
  const next = firstUnpaid(n, paidNos);
  const now = new Map(draft.classRows.map((c) => [c.label, c.annualTuition]));
  const live = new Map(base.classRows.map((c) => [c.label, c.annualTuition]));
  const studentsOf = (r: FeeRow) => r.labels.reduce((s, l) => s + (data.studentsByClass[l] ?? 0), 0);
  const groups = BAND_ORDER.map((key) => ({ key, rows: rows.filter((r) => r.band === key) })).filter((g) => g.rows.length);
  const students = Object.values(data.studentsByClass).reduce((s, v) => s + v, 0);
  const narrow = Boolean(selected);
  const X = narrow ? "hide-d" : "";
  const gc = narrow
    ? "minmax(0, 1.6fr) 64px minmax(84px, 1fr) minmax(84px, 1fr) 16px"
    : "minmax(170px, 1.7fr) 64px minmax(84px, 1fr) minmax(84px, 1fr) minmax(90px, 1fr) minmax(90px, 1fr) minmax(84px, 1fr) 16px";
  const heads: [Pair, string][] = [
    [F.colTuition, X],
    [F.colAcademic, X],
    [F.colTotal, ""],
    [F.colPer, ""],
    [F.colNew, X],
  ];
  const cell = (v: number, was: number, x: string, bold = false) => {
    const changed = v !== was;
    return (
      <span className={`fs-c num ${x}`} style={{ alignItems: "flex-end" }}>
        {changed ? <span style={{ fontSize: 11, color: "var(--sub)", textDecoration: "line-through" }}>{rupees(was)}</span> : null}
        <span className={`fs-cell${changed ? " fs-ac" : ""}`} style={{ fontSize: 14, fontWeight: bold ? 700 : 500 }}>{rupees(v)}</span>
      </span>
    );
  };
  let k = 0;
  return (
    <>
      <div className="fs-f" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <span className="fs-c">
          <span className="fs-tt">{tx(F.byClass)}</span>
          <span className="fs-m">
            {rows.length} {tx(F.bands)} · {students} {tx(F.students)} · {n} {tx(F.instWord)}
          </span>
        </span>
        {editable ? (
          <button type="button" className="tap btn sec mfull" onClick={onCopy}>
            <Ic n="copy" />
            {tx(F.raise)}
          </button>
        ) : onAsk ? (
          <button type="button" className="tap btn sec mfull" onClick={onAsk} disabled={askDisabled}>
            <Ic n="message" />
            {tx(F.ask)}
          </button>
        ) : null}
      </div>
      <LockNote paidNos={paidNos} count={n} tx={tx} />
      <div className="only-d card" style={{ overflow: "hidden" }}>
        <div className="fs-thead" style={{ gridTemplateColumns: gc }}>
          <span className="sech">{tx(F.band)}</span>
          <span className="sech" style={{ textAlign: "right" }}>{tx(F.colStudents)}</span>
          {heads.map(([label, x]) => (
            <span key={label.en} className={`sech ${x}`} style={{ textAlign: "right" }}>{tx(label)}</span>
          ))}
          <span />
        </div>
        {groups.map((g) => {
          const head = g.key === "senior" || g.rows.length > 1;
          return (
            <Fragment key={g.key}>
              {head ? <div style={{ padding: "10px 16px 4px", borderTop: "1px solid var(--bd)", fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{tx(BAND_WORD[g.key] ?? BAND_WORD.other)}</div> : null}
              {g.rows.map((r) => {
                const t = now.get(r.labels[0]) ?? 0;
                const was = live.get(r.labels[0]) ?? t;
                const per = perInstallment(draft, t);
                const perWas = perInstallment(base, was);
                const i = k++;
                return (
                  <button key={r.key} type="button" className={`tap row fs-row fs-xi${selected === r.key ? " sel" : ""}`} onClick={() => onPick(r.key)} style={{ gridTemplateColumns: gc, animationDelay: delay(i) }}>
                    <span className="fs-c" style={{ paddingLeft: head ? 12 : 0 }}>
                      <span className="fs-e" style={{ fontSize: 14, fontWeight: 700 }}>{r.name}</span>
                      <span className="fs-m fs-e">{r.sub || `${studentsOf(r)} ${tx(F.students)}`}</span>
                    </span>
                    <span className="num" style={{ fontSize: 13, color: "var(--mut)", textAlign: "right" }}>{studentsOf(r)}</span>
                    {cell(t, was, X)}
                    {cell(draft.oldStudentAcademicFeeAmount, base.oldStudentAcademicFeeAmount, X)}
                    {cell(t + draft.oldStudentAcademicFeeAmount, was + base.oldStudentAcademicFeeAmount, "", true)}
                    {cell(per[next - 1] ?? per[0] ?? 0, perWas[next - 1] ?? perWas[0] ?? 0, "")}
                    {cell(draft.newStudentAcademicFeeAmount, base.newStudentAcademicFeeAmount, X)}
                    {paidNos.length ? <Ic n="lock" size={14} style={{ color: "var(--sub)" }} /> : <span />}
                  </button>
                );
              })}
            </Fragment>
          );
        })}
      </div>
      <div className="only-m fs-c" style={{ gap: 14 }}>
        {groups.map((g) => (
          <div key={g.key} className="fs-c" style={{ gap: 8 }}>
            <span className="sech" style={{ padding: "0 4px" }}>{tx(BAND_WORD[g.key] ?? BAND_WORD.other)}</span>
            {g.rows.map((r, i) => {
              const t = now.get(r.labels[0]) ?? 0;
              const was = live.get(r.labels[0]) ?? t;
              const per = perInstallment(draft, t);
              const equal = per.every((v) => v === per[0]);
              const open = exp === r.key;
              const list: [Pair, Pair, number, number][] = [
                [F.colTuition, F.tuitionSub, t, was],
                [F.acadOld, F.acadOldSub, draft.oldStudentAcademicFeeAmount, base.oldStudentAcademicFeeAmount],
                [F.acadNew, F.acadNewSub, draft.newStudentAcademicFeeAmount, base.newStudentAcademicFeeAmount],
              ];
              return (
                <div key={r.key} className="card fs-xi" style={{ overflow: "hidden", animationDelay: delay(i) }}>
                  <button type="button" className="tap fs-rb" aria-expanded={open} onClick={() => setExp(open ? null : r.key)} style={{ padding: 14 }}>
                    <span className="fs-c" style={{ flex: 1, gap: 2 }}>
                      <span className="fs-tt fs-e">{r.name}</span>
                      <span className="fs-m">{r.sub || `${studentsOf(r)} ${tx(F.students)}`}</span>
                      {paidNos.length ? (
                        <span className="fs-f" style={{ gap: 4, fontSize: 12, color: "var(--warnfg)" }}>
                          <Ic n="lock" size={12} />
                          {tx(F.unpaidOnly)}
                        </span>
                      ) : null}
                    </span>
                    <span className="fs-c" style={{ alignItems: "flex-end" }}>
                      <span className="num fs-tt" style={{ color: t !== was ? "var(--accfg)" : "var(--fg)" }}>{rupees(t + draft.oldStudentAcademicFeeAmount)}</span>
                      <span className="num fs-m">{equal ? `${per.length} × ${rupees(per[0] ?? 0)}` : `${tx(F.inst)} ${next}–${per.length}: ${rupees(per[next - 1] ?? 0)}`}</span>
                    </span>
                    <Ic n="chevDown" style={{ color: "var(--sub)", transform: `rotate(${open ? 180 : 0}deg)`, transition: "transform .3s var(--spring)" }} />
                  </button>
                  {open ? (
                    <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--bd)" }}>
                      {list.map(([label, sub, v, w], j) => (
                        <div key={label.en} className="fs-f fs-xi" style={{ justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--bd)", animationDelay: delay(j) }}>
                          <span className="fs-c">
                            <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(label)}</span>
                            <span className="fs-m">{tx(sub)}</span>
                          </span>
                          <span className="num" style={{ fontSize: 14, fontWeight: 700, color: v !== w ? "var(--accfg)" : "var(--fg)" }}>{rupees(v)}</span>
                        </div>
                      ))}
                      <button type="button" className="tap btn soft" onClick={() => onPick(r.key)} style={{ width: "100%", marginTop: 12 }}>
                        <Ic n="edit" />
                        {tx(F.editFor)} {r.name}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <AcademicCard draft={draft} base={base} editable={editable} setDraft={setDraft} />
      {draft.customFeeHeads.length ? (
        <div className="card fs-c" style={{ padding: "16px 18px" }}>
          <span className="fs-tt">{tx(F.otherHeads)}</span>
          <span className="fs-m" style={{ marginBottom: 8 }}>{tx(F.otherHeadsSub)}</span>
          {draft.customFeeHeads.map((h) => (
            <div key={h.id} className="fs-f" style={{ justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
              <span className="fs-c">
                <span>{h.label}</span>
                <span className="fs-m">
                  {tx(h.chargeFrequency === "one_time" ? F.oneTime : F.everyYear)} · {tx(h.isActive ? F.on : F.off)}
                </span>
              </span>
              <b className="num">{rupees(h.amount)}</b>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

function AcademicCard({ draft, base, editable, setDraft }: { draft: FeeSetupDraft; base: FeeSetupDraft; editable: boolean; setDraft: SetDraft }) {
  const { tx } = useVx();
  const set = (k: "newStudentAcademicFeeAmount" | "oldStudentAcademicFeeAmount", v: string) => setDraft((d) => ({ ...d, [k]: digits(v) }));
  const fields: [Pair, "newStudentAcademicFeeAmount" | "oldStudentAcademicFeeAmount"][] = [
    [F.newPerYear, "newStudentAcademicFeeAmount"],
    [F.oldPerYear, "oldStudentAcademicFeeAmount"],
  ];
  return (
    <div className="card fs-c" style={{ padding: "16px 18px", gap: 12 }}>
      <span className="fs-c">
        <span className="fs-tt">{tx(F.academicCard)}</span>
        <span className="fs-m">{tx(F.academicCardSub)}</span>
      </span>
      <div className="g2 fs-g2">
        {fields.map(([label, k]) => {
          const changed = draft[k] !== base[k];
          return (
            <label key={k} className="field">
              <span>{tx(label)}</span>
              <span className="fs-rp">
                <span>₹</span>
                <input className="inp num" inputMode="numeric" value={String(draft[k])} onChange={(e) => set(k, e.target.value)} disabled={!editable} />
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: changed ? "var(--accfg)" : "var(--mut)" }}>{changed ? `${tx(F.liveNow)} ${rupees(base[k])}` : tx(F.sameAsLive)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function EditClassPanel({ row: feeRow, draft, base, students, paidNos, editable, onCancel, onSave }: { row: FeeRow; draft: FeeSetupDraft; base: FeeSetupDraft; students: number; paidNos: number[]; editable: boolean; onCancel: () => void; onSave: (tuition: number) => void }) {
  const { tx } = useVx();
  const label = feeRow.labels[0];
  const row = draft.classRows.find((c) => c.label === label);
  const live = base.classRows.find((c) => c.label === label)?.annualTuition ?? 0;
  const [value, setValue] = useState(String(row?.annualTuition ?? 0));
  const tuition = digits(value);
  const now = perInstallment(base, live);
  const next = perInstallment(draft, tuition);
  const delta = tuition - live;
  const n = next.length;
  const unpaidFrom = firstUnpaid(n, paidNos);
  const changed = tuition !== row?.annualTuition;
  return (
    <>
      <div className="fs-c" style={{ flex: 1, padding: "18px 22px", gap: 14 }}>
        <span className="fs-c hide-m">
          <span className="fs-h2">{feeRow.name}</span>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{feeRow.sub || tx(BAND_WORD[feeRow.band] ?? BAND_WORD.other)} · {students} {tx(F.students)}</span>
        </span>
        {paidNos.length ? (
          <div className="fs-nt fs-wa" style={{ padding: "10px 12px", fontSize: 12 }}>
            <Ic n="lock" size={14} style={{ marginTop: 2 }} />
            <span>{tx(F.editLock)} {range(paidNos)} {tx(F.editLockTail)}</span>
          </div>
        ) : null}
        <label className="field fs-xi">
          <span>{tx(F.tuitionYear)}</span>
          <span className="fs-rp">
            <span>₹</span>
            <input className={`inp num${tuition <= 0 ? " err" : ""}`} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} disabled={!editable} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 500, color: delta ? "var(--accfg)" : "var(--mut)" }}>
            {tx(F.everyStudent)} · {delta ? `${tx(F.liveNow)} ${rupees(live)}` : tx(F.sameAsLive)}
          </span>
        </label>
        <span className="fs-m">{tx(F.acadNote(rupees(draft.oldStudentAcademicFeeAmount), rupees(draft.newStudentAcademicFeeAmount)))}</span>
        <div className="card fs-c" style={{ padding: "14px 16px", gap: 10 }}>
          <div className="fs-f" style={{ justifyContent: "space-between" }}>
            <span className="fs-c">
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{tx(F.yearlyTotal)}</span>
              <span className="num" style={{ fontSize: 26, fontWeight: 700 }}>{rupees(tuition + draft.oldStudentAcademicFeeAmount)}</span>
            </span>
            {delta ? (
              <span className="pill fs-in fs-pl" style={{ animation: "xPopIn .4s var(--spring) both" }}>
                {signed(delta)} {tx(F.aYear)}
              </span>
            ) : null}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 6 }}>
            {next.map((v, i) => {
              const paid = paidNos.includes(i + 1);
              const moved = v !== now[i];
              return (
                <span key={i} className={`fs-c ${moved && !paid ? "fs-ac" : "fs-nu"}`} style={{ padding: 8, borderRadius: 10, gap: 2, color: moved && !paid ? undefined : "var(--mut)" }}>
                  <span className="fs-f" style={{ gap: 3, fontSize: 11, fontWeight: 700, opacity: 0.75 }}>
                    <Ic n={paid ? "lock" : moved ? "arrowUp" : "calendar"} size={11} />
                    {tx(F.inst)} {i + 1}
                  </span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700, color: moved && !paid ? undefined : "var(--fg)", opacity: moved && !paid ? 1 : 0.85 }}>{rupees(v)}</span>
                </span>
              );
            })}
          </div>
          <div className="fs-f" style={{ alignItems: "flex-start", fontSize: 13, fontWeight: 600, color: delta ? "var(--info)" : "var(--mut)" }}>
            <Ic n="users" size={14} style={{ marginTop: 2 }} />
            <span>
              {delta
                ? `${tx(F.affects)} ${students} ${tx(F.students)} · ${signed(delta)} ${tx(F.eachThisYear)}${paidNos.length ? ` · ${tx(F.inst)} ${unpaidFrom}–${n}` : ""}`
                : tx(F.noChangeYet)}
            </span>
          </div>
        </div>
      </div>
      <div className="glass fs-foot">
        <button type="button" className="tap btn sec" onClick={onCancel}>{tx(editable ? F.cancel : F.close)}</button>
        {editable ? (
          <button type="button" className="tap btn pri" onClick={() => onSave(tuition)} disabled={!changed || tuition <= 0} style={{ opacity: changed && tuition > 0 ? 1 : 0.5 }}>
            <Ic n="check" />
            {tx(F.saveToChanges)}
          </button>
        ) : null}
      </div>
    </>
  );
}

function CopySheet({ open, onClose, base, editable, onApply }: { open: boolean; onClose: () => void; base: FeeSetupDraft; editable: boolean; onApply: (rows: FeeSetupDraft["classRows"]) => void }) {
  const { tx } = useVx();
  const [pct, setPct] = useState(5);
  const raised = raiseTuition(base.classRows, pct);
  const changed = raised.filter((r, i) => r.annualTuition !== base.classRows[i]?.annualTuition).length;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(F.raise)}
      sub={tx(F.sheetCopySub)}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={onClose}>{tx(F.cancel)}</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6 }} disabled={!editable || !changed} onClick={() => { onApply(raised); onClose(); }}>
            <Ic n="check" />
            {tx(F.putInChanges)}
          </button>
        </>
      }
    >
      <div className="fs-c fs-lh" style={{ gap: 12 }}>
        <div className="fs-f" style={{ justifyContent: "space-between", padding: "12px 14px", borderRadius: 14, background: "var(--s2)" }}>
          <span className="fs-c">
            <span style={{ fontSize: 14, fontWeight: 700 }}>{tx(F.raiseBy)}</span>
            <span className="fs-m">{tx(F.raiseSub)}</span>
          </span>
          <span className="fs-f">
            <button type="button" className="tap btn sec fs-sq4" aria-label="− 1%" onClick={() => setPct((v) => Math.max(-20, v - 1))}><Ic n="minus" /></button>
            <span className="num serif" style={{ minWidth: 60, textAlign: "center", fontSize: 28, fontWeight: 600 }}>{pct}%</span>
            <button type="button" className="tap btn sec fs-sq4" aria-label="+ 1%" onClick={() => setPct((v) => Math.min(40, v + 1))}><Ic n="plus" /></button>
          </span>
        </div>
        <div className="card fs-ls" style={{ overflow: "hidden" }}>
          {raised.map((r) => {
            const was = base.classRows.find((c) => c.label === r.label)?.annualTuition ?? 0;
            const d = r.annualTuition - was;
            return (
              <div key={r.label} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) repeat(2, minmax(0, 1fr))", gap: 8, alignItems: "center", minHeight: 46, padding: "0 14px" }}>
                <span className="fs-c">
                  <span className="fs-e" style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</span>
                  <span className="num fs-m">{rupees(was)}</span>
                </span>
                <span className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: "right" }}>{rupees(r.annualTuition)}</span>
                <span style={{ textAlign: "right" }}>
                  <span className={`pill num ${d === 0 ? "fs-nu" : d > 0 ? "fs-in" : "fs-wa"}`}>{d === 0 ? tx(F.same) : signed(d)}</span>
                </span>
              </div>
            );
          })}
        </div>
        <span className="fs-m">{tx(F.copyNote)}</span>
      </div>
    </Sheet>
  );
}

/* ---------- installments ---------- */

function DateChip({ date, locked, moved, editable, min, onPick, label }: { date: string; locked: boolean; moved: boolean; editable: boolean; min: string; onPick: (v: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const can = editable && !locked;
  return (
    <span style={{ position: "relative" }}>
      <button
        type="button"
        className={`tap chip${moved ? " on" : ""}`}
        aria-pressed={moved}
        aria-label={`${label} ${dm(date)}`}
        disabled={!can}
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
        style={{ height: 30, padding: "0 9px", fontSize: 12, opacity: 1, cursor: can ? "pointer" : "default" }}
      >
        <Ic n={locked ? "lock" : "calendar"} size={13} />
        {dm(date)}
      </button>
      {can ? <input ref={ref} type="date" value={date} min={min} tabIndex={-1} aria-hidden="true" onChange={(e) => e.target.value && onPick(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, pointerEvents: "none" }} /> : null}
    </span>
  );
}

function InstallmentsTab({ data, rows, draft, base, today, editable, setDraft }: { data: FeeSetupVxData; rows: FeeRow[]; draft: FeeSetupDraft; base: FeeSetupDraft; today: string; editable: boolean; setDraft: SetDraft }) {
  const { tx } = useVx();
  const dates = draft.installmentDates;
  const cols = Math.max(1, dates.length);
  const nextIdx = dates.findIndex((d) => d > today);
  const done = nextIdx === -1 ? dates.length : nextIdx;
  const setDate = (i: number, v: string) => setDraft((d) => ({ ...d, installmentDates: d.installmentDates.map((x, j) => (j === i ? v : x)) }));
  // How far along the line today is: whole steps for passed dates, a part of the step to the next one.
  const part = done > 0 && done < dates.length ? Math.min(1, Math.max(0, daysFrom(dates[done - 1], today) / Math.max(1, daysFrom(dates[done - 1], dates[done])))) : 0;
  const along = cols > 1 ? Math.min(1, Math.max(0, (done - 1 + part) / (cols - 1))) : 0;
  const span = 100 - 100 / cols;
  const sampleRow = draft.classRows.find((c) => c.annualTuition > 0) ?? draft.classRows[0];
  const shares = sampleRow ? perInstallment(draft, sampleRow.annualTuition) : dates.map(() => 0);
  const shareSum = shares.reduce((s, v) => s + v, 0) || 1;
  const pcts = shares.map((v) => Math.round((v / shareSum) * 100));
  const nowBy = new Map(draft.classRows.map((c) => [c.label, c.annualTuition]));
  const baseBy = new Map(base.classRows.map((c) => [c.label, c.annualTuition]));
  const tcols = `minmax(0, 1.4fr) repeat(${cols + 1}, minmax(0, 1fr))`;
  return (
    <>
      <div className="card" style={{ padding: "18px 16px 16px" }}>
        <div className="fs-f" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <span className="fs-tt">{tx(F.whenDue)}</span>
          <span className="fs-m">{tx(F.today)} · {ddm(today)}</span>
        </div>
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          <span style={{ position: "absolute", top: 17, left: `${50 / cols}%`, right: `${50 / cols}%`, height: 4, borderRadius: 2, background: "var(--s3)" }} />
          <span style={{ position: "absolute", top: 17, left: `${50 / cols}%`, width: `${(span * along).toFixed(1)}%`, height: 4, borderRadius: 2, background: "var(--ok)", transformOrigin: "left", animation: "xGrowX .9s .15s var(--ease) both" }} />
          {dates.map((d, i) => {
            const locked = isDateLocked(base.installmentDates[i] ?? d, today);
            const moved = d !== base.installmentDates[i];
            const isDone = i < done;
            const isNext = i === done;
            const left = daysFrom(today, d);
            return (
              <div key={i} className="fs-c fs-xi" style={{ alignItems: "center", gap: 6, textAlign: "center", position: "relative", animationDelay: delay(i) }}>
                <span
                  className="fs-ib"
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    background: isDone ? "var(--ok)" : "var(--card)",
                    color: isDone ? "var(--onsolid)" : isNext ? "var(--acc)" : "var(--sub)",
                    border: isDone ? 0 : isNext ? "3px solid var(--acc)" : "2px solid var(--bds)",
                    animation: isNext ? "xPulse 1.8s ease infinite" : "none",
                  }}
                >
                  <Ic n={isDone ? "check" : isNext ? "clock" : "calendar"} />
                </span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{tx(F.inst)} {i + 1}</span>
                <DateChip date={d} locked={locked} moved={moved} editable={editable} min={today} onPick={(v) => setDate(i, v)} label={`${tx(F.dueDate)} · ${tx(F.inst)} ${i + 1}`} />
                <span style={{ fontSize: 12, lineHeight: 1.3, color: isDone ? "var(--ok)" : isNext ? "var(--accfg)" : "var(--mut)" }}>
                  {isDone
                    ? `${tx(F.duePassed)}${data.paidInstallments.includes(i + 1) ? ` · ${tx(F.receiptsWritten)}` : ""}`
                    : isNext
                      ? `${tx(F.nextIn)} ${left} ${tx(F.days)}`
                      : `${tx(F.inDays)} ${left} ${tx(F.days)}`.trim()}
                </span>
              </div>
            );
          })}
        </div>
        <span className="fs-m" style={{ display: "block", marginTop: 12, textAlign: "center" }}>{tx(editable ? F.datesHint : F.datesLocked)}</span>
      </div>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.25fr)", gap: 16, alignItems: "start" }}>
        <div className="card fs-c" style={{ padding: "16px 18px", gap: 4 }}>
          <div className="fs-f" style={{ justifyContent: "space-between" }}>
            <span className="fs-tt">{tx(F.split)}</span>
            <span className="pill num fs-ok fs-pl">{tx(F.total100)}</span>
          </div>
          <span className="fs-m">{tx(F.splitSub(cols))}</span>
          <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--s3)", margin: "12px 0 6px" }}>
            {pcts.map((v, i) => (
              <span key={i} style={{ width: `${(shares[i] / shareSum) * 100}%`, background: C4[i % C4.length], transition: "width .5s var(--ease)" }} />
            ))}
          </div>
          <div className="fs-c fs-ls">
            {dates.map((d, i) => {
              const locked = isDateLocked(base.installmentDates[i] ?? d, today);
              return (
                <div key={i} className="fs-f" style={{ gap: 12, padding: "9px 0" }}>
                  <span className="fs-dt" style={{ borderRadius: 3, background: C4[i % C4.length] }} />
                  <span className="fs-c" style={{ flex: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(F.installment)} {i + 1}</span>
                    <span className="fs-m fs-f" style={{ gap: 4 }}>
                      {locked ? <Ic n="lock" size={12} /> : null}
                      {locked ? tx(F.lockedShort) : `${tx(F.due)} ${dm(d)}`}
                    </span>
                  </span>
                  <span className="fs-big" style={{ opacity: locked ? 0.45 : 1 }}>{pcts[i]}%</span>
                </div>
              );
            })}
          </div>
          <div className="fs-c" style={{ gap: 8, marginTop: 8 }} role="radiogroup" aria-label={tx(F.split)}>
            <RadioRow on={draft.academicFeeDistribution === "first_only"} onPick={() => editable && setDraft((d) => ({ ...d, academicFeeDistribution: "first_only" }))} label={tx(F.firstOnly)} sub={tx(F.firstOnlySub)} disabled={!editable} />
            <RadioRow on={draft.academicFeeDistribution === "equal"} onPick={() => editable && setDraft((d) => ({ ...d, academicFeeDistribution: "equal" }))} label={tx(F.spread)} sub={tx(F.spreadSub)} disabled={!editable} />
            {draft.academicFeeDistribution !== base.academicFeeDistribution ? (
              <span className="pill fs-ac" style={{ alignSelf: "flex-start" }}>
                <Ic n="edit" size={12} />
                {tx(F.changedNotLive)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="fs-c" style={{ padding: "14px 16px 10px" }}>
            <span className="fs-tt">{tx(F.eachPays)}</span>
            <span className="fs-m">{tx(F.eachPaysSub)}</span>
          </div>
          <div className="fs-ls">
            <div style={{ display: "grid", gridTemplateColumns: tcols, gap: 6, padding: "8px 16px", background: "var(--s2)" }}>
              <span className="sech" style={{ fontSize: 11 }}>{tx(F.band)}</span>
              {dates.map((_, i) => (
                <span key={i} className="sech" style={{ fontSize: 11, textAlign: "right" }}>{tx(F.inst)} {i + 1}</span>
              ))}
              <span className="sech" style={{ fontSize: 11, textAlign: "right" }}>{tx(F.year)}</span>
            </div>
            {rows.map((r) => {
              const t = nowBy.get(r.labels[0]) ?? 0;
              const per = perInstallment(draft, t);
              const was = perInstallment(base, baseBy.get(r.labels[0]) ?? t);
              const all = [...per, per.reduce((s, v) => s + v, 0)];
              const old = [...was, was.reduce((s, v) => s + v, 0)];
              return (
                <div key={r.key} style={{ display: "grid", gridTemplateColumns: tcols, gap: 6, alignItems: "center", minHeight: 42, padding: "0 16px" }}>
                  <span className="fs-e" style={{ fontSize: 13, fontWeight: 600 }}>{r.band === "senior" && r.labels.length > 1 ? `11–12 ${r.name}` : r.name}</span>
                  {all.map((v, i) => {
                    const ch = v !== old[i];
                    const paid = i < per.length && i < done;
                    return (
                      <span key={i} className="num" style={{ fontSize: 13, textAlign: "right", fontWeight: ch || i === per.length ? 700 : 500, color: ch ? "var(--accfg)" : paid ? "var(--mut)" : "var(--fg)" }}>{rupees(v)}</span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- discounts ---------- */

function DiscountsTab({ data, draft, editable, setDraft, onAdd }: { data: FeeSetupVxData; draft: FeeSetupDraft; editable: boolean; setDraft: SetDraft; onAdd: () => void }) {
  const { tx } = useVx();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const total = Object.values(data.ruleStudents).reduce((s, v) => s + v, 0);
  const setRule = (key: string, patch: Partial<DiscountDraft>) => setDraft((d) => ({ ...d, discounts: d.discounts.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const icon = (d: DiscountDraft): IconName => (d.code === "rte" ? "shield" : d.code.includes("staff") ? "briefcase" : d.code.includes("child") || d.code.includes("sibling") ? "users" : "percent");
  const big = (d: DiscountDraft) => (d.calculationType === "tuition_zero" ? "100%" : d.calculationType === "tuition_percentage" ? `${d.percentage ?? 0}%` : rupees(d.fixedTuitionAmount ?? 0));
  return (
    <>
      <div className="fs-f" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <span className="fs-c">
          <span className="fs-tt">{tx(F.discTitle)}</span>
          <span className="fs-m">
            {total} {tx(F.students)} · {draft.discounts.length} {tx(F.rules)} · {tx(F.onTuition)}
          </span>
        </span>
        {editable ? (
          <button type="button" className="tap btn pri mfull" onClick={onAdd}>
            <Ic n="plus" />
            {tx(F.addRule)}
          </button>
        ) : null}
      </div>
      <div className="g2 fs-g2">
        {draft.discounts.map((d, i) => {
          const count = d.id ? (data.ruleStudents[d.id] ?? 0) : 0;
          const names = d.id ? (data.ruleStudentNames[d.id] ?? []) : [];
          const isNew = !d.id;
          return (
            <div key={d.key} className="card rise fs-c" style={{ padding: 16, gap: 10, animationDelay: delay(i) }}>
              <div className="fs-f" style={{ gap: 12, alignItems: "flex-start", opacity: d.isActive ? 1 : 0.5, transition: "opacity .3s ease" }}>
                <span className={`fs-ib ${isNew ? "fs-in" : "fs-ac"}`} style={{ width: 42, height: 42, borderRadius: 13 }}>
                  <Ic n={isNew ? "tag" : icon(d)} />
                </span>
                <span className="fs-c" style={{ flex: 1 }}>
                  <span className="fs-tt">{d.displayName}</span>
                  <span className="fs-m">{describeDiscount(d)}</span>
                </span>
                <button type="button" className="tap" role="switch" aria-checked={d.isActive} aria-label={d.displayName} disabled={!editable} onClick={() => setRule(d.key, { isActive: !d.isActive })} style={{ border: 0, background: "transparent", padding: 4 }}>
                  <SwitchKnob on={d.isActive} />
                </button>
              </div>
              <div className="fs-f" style={{ justifyContent: "space-between", alignItems: "flex-end", opacity: d.isActive ? 1 : 0.5, transition: "opacity .3s ease" }}>
                {editable && d.calculationType !== "tuition_zero" ? (
                  <button type="button" className="tap num serif" onClick={() => setEditKey(editKey === d.key ? null : d.key)} style={{ border: 0, background: "transparent", padding: 0, color: "var(--fg)", fontFamily: "\"Source Serif 4\", Georgia, serif", fontSize: 28, fontWeight: 600, lineHeight: 1 }}>{big(d)}</button>
                ) : (
                  <span className="num serif" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>{big(d)}</span>
                )}
                <span className="fs-c" style={{ alignItems: "flex-end" }}>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{isNew ? tx(F.newNotLive) : `${count} ${tx(F.students)}`}</span>
                  <span className="fs-m">{tx(d.calculationType === "tuition_fixed_amount" ? F.paysThis : F.offTuition)}</span>
                </span>
              </div>
              <div className="fs-f" style={{ flexWrap: "wrap", gap: 6, fontSize: 12, color: "var(--mut)" }}>
                {tx(F.tuitionOnly)} ·<span className="pill fs-wa">{tx(F.givenPerStudent)}</span>
                {names.length ? (
                  <button type="button" className="tap btn ghost" style={{ height: 30, marginLeft: "auto", fontSize: 13, padding: "0 10px" }} onClick={() => setOpenKey(openKey === d.key ? null : d.key)}>
                    {tx(openKey === d.key ? F.hide : F.who)}
                  </button>
                ) : null}
              </div>
              {editKey === d.key && editable && d.calculationType !== "tuition_zero" ? (
                <label className="field fadein">
                  <span>{tx(d.calculationType === "tuition_percentage" ? F.pctOff : F.tuitionPays)}</span>
                  <span className="fs-rp">
                    <span>{d.calculationType === "tuition_percentage" ? "%" : "₹"}</span>
                    <input
                      className="inp num"
                      inputMode="numeric"
                      value={String(d.calculationType === "tuition_percentage" ? (d.percentage ?? 0) : (d.fixedTuitionAmount ?? 0))}
                      onChange={(e) => {
                        const v = digits(e.target.value);
                        setRule(d.key, d.calculationType === "tuition_percentage" ? { percentage: Math.min(100, v) } : { fixedTuitionAmount: v });
                      }}
                    />
                  </span>
                </label>
              ) : null}
              {!d.isActive && d.id ? <div className="fadein fs-wa" style={{ padding: "8px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{tx(F.ruleOffNote)}</div> : null}
              {openKey === d.key ? (
                <div className="fs-c" style={{ gap: 4, padding: 10, borderRadius: 10, background: "var(--s2)" }}>
                  {names.map((n, j) => (
                    <span key={j} style={{ fontSize: 13 }}>{n}</span>
                  ))}
                  {count > names.length ? <span className="fs-m">+ {count - names.length} {tx(F.more)}</span> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {!draft.discounts.length ? <EmptyState icon="percent" title={tx(F.noRules)} body={tx(F.noRulesBody)} /> : null}
      <span className="fs-m">{tx(F.discNote)}</span>
    </>
  );
}

function RuleSheet({ open, onClose, draft, editable, onAdd }: { open: boolean; onClose: () => void; draft: FeeSetupDraft; editable: boolean; onAdd: (d: DiscountDraft) => void }) {
  const { tx } = useVx();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DiscountDraft["calculationType"]>("tuition_percentage");
  const [v, setV] = useState(25);
  const ok = name.trim().length >= 3 && (kind === "tuition_zero" || (kind === "tuition_percentage" ? v > 0 && v <= 100 : v >= 0));
  const add = () => {
    const code = ruleCode(name, draft.discounts.map((d) => d.code));
    onAdd({ key: `new-${code}`, id: null, code, displayName: name.trim(), calculationType: kind, percentage: kind === "tuition_percentage" ? v : null, fixedTuitionAmount: kind === "tuition_fixed_amount" ? v : null, isActive: true, isBuiltin: false });
    setName("");
    onClose();
  };
  const types: [DiscountDraft["calculationType"], Pair, number][] = [
    ["tuition_percentage", F.pctOffChip, 25],
    ["tuition_fixed_amount", F.fixedChip, 5000],
    ["tuition_zero", F.freeChip, 0],
  ];
  const pct = kind === "tuition_percentage";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(F.addRule)}
      sub={tx(F.addRuleSub)}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={onClose}>{tx(F.cancel)}</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6 }} disabled={!ok || !editable} onClick={add}>
            <Ic n="plus" />
            {tx(F.addRuleCta)}
          </button>
        </>
      }
    >
      <div className="fs-c fs-lh" style={{ gap: 14 }}>
        <label className="field">
          <span>{tx(F.ruleName)}</span>
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder={tx(F.ruleNamePh)} />
        </label>
        <div className="fs-c" style={{ gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{tx(F.typeAmount)}</span>
          <div className="fs-f" style={{ flexWrap: "wrap", gap: 10 }}>
            {types.map(([k, label, start]) => (
              <button key={k} type="button" className={`tap chip${kind === k ? " on" : ""}`} aria-pressed={kind === k} onClick={() => { setKind(k); setV(start); }}>{tx(label)}</button>
            ))}
            {kind !== "tuition_zero" ? (
              <Step
                value={pct ? `${v}%` : rupees(v)}
                width={76}
                label={tx(F.typeAmount)}
                onDec={() => setV((x) => (pct ? Math.max(5, x - 5) : Math.max(0, x - 500)))}
                onInc={() => setV((x) => (pct ? Math.min(100, x + 5) : Math.min(500000, x + 500)))}
              />
            ) : null}
          </div>
        </div>
        <span className="fs-m">{tx(F.discountNote)}</span>
      </div>
    </Sheet>
  );
}

/* ---------- late fee ---------- */

function LateFeeTab({ draft, base, today, editable, setDraft }: { draft: FeeSetupDraft; base: FeeSetupDraft; today: string; editable: boolean; setDraft: SetDraft }) {
  const { tx } = useVx();
  const inst = Math.max(0, draft.installmentDates.filter((d) => d <= today).length - 1);
  const due = draft.installmentDates[inst] ?? today;
  const plus = (n: number) => new Date(Date.parse(`${due}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const options = [0, 3, 10, 20, 35].map(plus);
  const [paidOn, setPaidOn] = useState<string | null>(null);
  const on = paidOn ?? options[2];
  const fee = lateFeeFor({ dueDate: due, paidOn: on, flat: draft.lateFeeFlatAmount });
  const charging = draft.lateFeeFlatAmount > 0;
  const late = daysFrom(due, on);
  const setFlat = (v: number) => setDraft((d) => ({ ...d, lateFeeFlatAmount: Math.max(0, Math.min(5000, v)) }));
  return (
    <div className="stack fs-g2" style={{ gap: 16, alignItems: "start" }}>
      <div className="card fs-c" style={{ padding: "6px 18px 16px" }}>
        <button type="button" className="tap fs-rb" role="switch" aria-checked={charging} disabled={!editable} onClick={() => setFlat(charging ? 0 : base.lateFeeFlatAmount || 100)} style={{ padding: "12px 0" }}>
          <span className="fs-c" style={{ flex: 1 }}>
            <span className="fs-tt">{tx(F.charge)}</span>
            <span className="fs-m">{tx(charging ? F.chargeOn : F.chargeOff)}</span>
          </span>
          <SwitchKnob on={charging} />
        </button>
        <div className="fs-f" style={{ gap: 10, padding: "11px 0", borderTop: "1px solid var(--bd)", opacity: charging ? 1 : 0.45, transition: "opacity .3s ease" }}>
          <span className="fs-c" style={{ flex: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(F.perInst)}</span>
            <span className="fs-m">{draft.lateFeeFlatAmount !== base.lateFeeFlatAmount ? `${tx(F.liveNow)} ${rupees(base.lateFeeFlatAmount)}` : tx(F.perInstSub)}</span>
          </span>
          {editable ? (
            <Step value={rupees(draft.lateFeeFlatAmount)} width={62} tone={draft.lateFeeFlatAmount !== base.lateFeeFlatAmount ? "var(--accfg)" : undefined} label={tx(F.perInst)} onDec={() => setFlat(draft.lateFeeFlatAmount - 50)} onInc={() => setFlat(draft.lateFeeFlatAmount + 50)} />
          ) : (
            <span className="fs-big" style={{ minWidth: 62 }}>{rupees(draft.lateFeeFlatAmount)}</span>
          )}
        </div>
        <div className="fs-c" style={{ gap: 8, paddingTop: 12, borderTop: "1px solid var(--bd)" }}>
          <span className="fs-c">
            <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(F.whoWaives)}</span>
            <span className="fs-m">{tx(F.whoWaivesSub)}</span>
          </span>
          <span style={{ fontSize: 13 }}>{tx(F.whoWaivesBody)}</span>
        </div>
      </div>
      <div className="fs-c" style={{ gap: 16 }}>
        <div className="card fs-c" style={{ padding: "16px 18px", gap: 12 }}>
          <span className="fs-c">
            <span className="fs-tt">{tx(F.tryIt)}</span>
            <span className="fs-m">
              {tx(F.installment)} {inst + 1} · {tx(F.due)} {ddm(due)}
            </span>
          </span>
          <div className="fs-c" style={{ gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{tx(F.paidOn)}</span>
            <div className="hs" style={{ display: "flex", gap: 6 }}>
              {options.map((d) => (
                <button key={d} type="button" className={`tap chip${on === d ? " on" : ""}`} aria-pressed={on === d} onClick={() => setPaidOn(d)}>{dm(d)}</button>
              ))}
            </div>
          </div>
          <div className="fs-c" style={{ gap: 8, padding: 14, borderRadius: 14, background: "var(--s2)" }}>
            <div className="fs-f" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{tx(F.lateFee)}</span>
              <span className="num serif" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1, color: fee ? "var(--warnfg)" : "var(--ok)" }}>{rupees(fee)}</span>
            </div>
            <div className="fs-f fs-m" style={{ justifyContent: "space-between" }}>
              <span>{!charging ? tx(F.lateIsOff) : late > 0 ? tx(F.paidLate(late)) : tx(F.paidByDue)}</span>
              <span className="num">{tx(F.flatNote)}</span>
            </div>
          </div>
          <div className="fs-f" style={{ alignItems: "flex-start", fontSize: 13, fontWeight: 600, color: "var(--accfg)" }}>
            <Ic n="info" />
            <span>{fee ? tx(F.verdictYes(rupees(fee))) : tx(F.verdictNo)}</span>
          </div>
        </div>
        <div className="fs-nt fs-ok" style={{ borderRadius: 16, padding: "14px 16px" }}>
          <Ic n="shield" />
          <span>
            <b>{tx(F.notDefaulterB)}</b> {tx(F.notDefaulter)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- transport ---------- */

function TransportTab({ data, draft, base, editable, onPick }: { data: FeeSetupVxData; draft: FeeSetupDraft; base: FeeSetupDraft; editable: boolean; onPick: (name: string) => void }) {
  const { tx } = useVx();
  const n = Math.max(1, draft.installmentDates.length);
  const riders = Object.values(data.studentsByRoute).reduce((s, v) => s + v, 0);
  const baseBy = new Map(base.routeRows.map((r) => [r.routeName, r.annualFee]));
  return (
    <>
      <div className="fs-f" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <span className="fs-c">
          <span className="fs-tt">{tx(F.busRoutes)}</span>
          <span className="fs-m">
            {draft.routeRows.filter((r) => r.annualFee > 0).length} {tx(F.routes)} · {riders} {tx(F.onBus)} · {tx(F.splitOver)} {n} {tx(F.instWord)}
          </span>
        </span>
        {editable ? <Btn variant="soft" icon="plus" onClick={() => onPick("")}>{tx(F.addRoute)}</Btn> : null}
      </div>
      <div className="g2 fs-g2">
        {draft.routeRows.map((r, i) => {
          const was = baseBy.get(r.routeName);
          const changed = was !== undefined && was !== r.annualFee;
          return (
            <div key={r.routeName} className="card rise fs-c" style={{ padding: 16, gap: 12, animationDelay: delay(i) }}>
              <div className="fs-f" style={{ gap: 12, alignItems: "flex-start" }}>
                <span className="fs-ib serif" style={{ width: 44, height: 44, borderRadius: 13, background: "var(--pri)", color: "var(--prifg)", fontSize: 20, fontWeight: 700 }}>{i + 1}</span>
                <span className="fs-c" style={{ flex: 1 }}>
                  <span className="fs-tt fs-e">{r.routeName}</span>
                  <span className="fs-m">
                    {data.studentsByRoute[r.routeName] ?? 0} {tx(F.students)}
                    {was === undefined ? ` · ${tx(F.newPill)}` : changed ? ` · ${tx(F.editedPill)}` : ""}
                  </span>
                </span>
                <span className="fs-c" style={{ alignItems: "flex-end" }}>
                  {changed ? <span className="num" style={{ fontSize: 11, color: "var(--sub)", textDecoration: "line-through" }}>{rupees(was)}</span> : null}
                  <span className="num fs-tt" style={{ color: changed ? "var(--accfg)" : undefined }}>
                    {rupees(r.annualFee)} {tx(F.aYear)}
                  </span>
                  <span className="num fs-m">
                    {rupees(Math.round(r.annualFee / n))} × {n}
                  </span>
                </span>
              </div>
              <button type="button" className="tap btn sec" onClick={() => onPick(r.routeName)}>
                <Ic n="edit" />
                {tx(F.editRoute)}
              </button>
            </div>
          );
        })}
      </div>
      <span className="fs-m">{tx(F.stopsNote)}</span>
    </>
  );
}

function RouteSheet({ name, draft, base, students, editable, onClose, onSave }: { name: string; draft: FeeSetupDraft; base: FeeSetupDraft; students: number; editable: boolean; onClose: () => void; onSave: (name: string, fee: number) => void }) {
  const { tx } = useVx();
  const isNew = !name;
  const row = draft.routeRows.find((r) => r.routeName === name);
  const live = base.routeRows.find((r) => r.routeName === name)?.annualFee;
  const [title, setTitle] = useState(name);
  const [fee, setFee] = useState(row?.annualFee ?? 6000);
  const n = Math.max(1, draft.installmentDates.length);
  const clash = isNew && draft.routeRows.some((r) => r.routeName.toLowerCase() === title.trim().toLowerCase());
  const d = live !== undefined ? fee - live : 0;
  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? tx(F.addRoute) : name}
      sub={isNew ? tx(F.addRouteSub) : tx(F.routeSub(students, n))}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={onClose}>{tx(editable ? F.cancel : F.close)}</button>
          {editable ? (
            <button type="button" className="tap btn pri" style={{ flex: 1.6 }} disabled={(isNew && (title.trim().length < 2 || clash)) || fee === row?.annualFee} onClick={() => onSave(isNew ? title.trim() : name, fee)}>
              <Ic n="check" />
              {tx(F.saveToChanges)}
            </button>
          ) : null}
        </>
      }
    >
      <div className="fs-c fs-lh" style={{ gap: 14 }}>
        {isNew ? (
          <label className="field">
            <span>{tx(F.routeName)}</span>
            <input className={`inp${clash ? " err" : ""}`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tx(F.routeNamePh)} disabled={!editable} />
            {clash ? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--bad)" }}>{tx(F.routeClash)}</span> : null}
          </label>
        ) : null}
        <div className="fs-c" style={{ gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{tx(F.feeYear)}</span>
          <div className="fs-f">
            <button type="button" className="tap btn sec fs-sq4" aria-label={`− ₹500`} onClick={() => setFee((v) => Math.max(0, v - 500))} disabled={!editable}><Ic n="minus" /></button>
            <span className="fs-rp">
              <span>₹</span>
              <input className={`inp num${fee <= 0 ? " err" : ""}`} inputMode="numeric" aria-label={tx(F.feeYear)} value={String(fee)} onChange={(e) => setFee(digits(e.target.value))} disabled={!editable} />
            </span>
            <button type="button" className="tap btn sec fs-sq4" aria-label={`+ ₹500`} onClick={() => setFee((v) => v + 500)} disabled={!editable}><Ic n="plus" /></button>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: d ? "var(--info)" : "var(--mut)" }}>
            {rupees(Math.round(fee / n))} {tx(F.eachInst)} · {live === undefined ? tx(F.newPill) : d ? `${students} ${tx(F.students)} · ${signed(d)} ${tx(F.eachAYear)}` : tx(F.sameAsLive)}
          </span>
        </div>
        <span className="fs-m">{tx(F.stopsNote)}</span>
      </div>
    </Sheet>
  );
}

/* ---------- review & publish ---------- */

function parentMessage(changes: DraftChange[], session: string): { hi: string; en: string } {
  const lines = changes.map((c) => `• ${c.title}: ${c.before} → ${c.after}`).join("\n");
  return {
    hi: `प्रिय अभिभावक, सत्र ${session} की शुल्क व्यवस्था में बदलाव:\n${lines}\nये बदलाव बाकी किस्तों पर लागू होंगे। — श्री वीर पत्ता सी. सै. स्कूल, आमेट`,
    en: `Dear parent, fee changes for ${session}:\n${lines}\nThey apply to the installments still to pay. — VPPS`,
  };
}

const AREA_ICON: Record<DraftChange["area"], IconName> = { class: "layers", route: "bus", installment: "calendar", latefee: "clock", academic: "book", discount: "percent", head: "tag" };

function ReviewSheet({ onClose, draft, changes, data, today, editable, onDone }: { onClose: () => void; draft: FeeSetupDraft; changes: DraftChange[]; data: FeeSetupVxData; today: string; editable: boolean; onDone: () => void }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [state, setState] = useState<FeeSetupActionState>(INITIAL_FEE_SETUP_ACTION_STATE);
  const [tell, setTell] = useState(true);
  const preview = state.status === "preview" ? state.preview : null;
  const msg = parentMessage(changes, data.sessionLabel);
  const nextIdx = draft.installmentDates.findIndex((d) => d > today);
  const n = changes.length;
  const nWord = `${n} ${tx(n === 1 ? F.change1 : F.changesN)}`;
  const check = () =>
    start(async () => {
      const r = await publishFeeSetupAction(state, draftToFormData(draft, "preview", null));
      setState(r);
      if (r.status === "error") toast.show({ text: r.message ?? tx(F.checkFail), tone: "bad" });
    });
  const publish = () =>
    start(async () => {
      const r = await publishFeeSetupAction(state, draftToFormData(draft, "apply", state.changeBatchId));
      setState(r);
      if (r.status === "success") {
        toast.show({ text: r.message ?? tx(F.published), tone: "ok" });
        onDone();
        onClose();
        router.refresh();
      } else {
        toast.show({ text: r.message ?? tx(F.publishFail), tone: "bad" });
      }
    });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${msg.hi}\n\n${msg.en}`);
      toast.show({ text: tx(F.copied), tone: "ok" });
    } catch {
      toast.show({ text: tx(F.copyFail), tone: "bad" });
    }
  };
  const delta = preview?.feeDeltaTotal ?? 0;
  const kpis: [Pair, string, string, string][] = [
    [F.affected, preview ? String(preview.studentsAffected) : "—", preview ? `${tx(F.of)} ${preview.studentsInScope} ${tx(F.inScope)}` : tx(F.countFirst), "var(--fg)"],
    [F.changeSession, preview ? `${delta >= 0 ? "+" : "−"}${rupeesShort(Math.abs(delta))}` : "—", preview ? tx(delta >= 0 ? F.moreToCollect : F.lessToCollect) : tx(F.countFirst), delta > 0 ? "var(--info)" : "var(--fg)"],
    [F.startsFrom, nextIdx >= 0 ? `${tx(F.inst)} ${nextIdx + 1}` : "—", nextIdx >= 0 ? `${ddm(draft.installmentDates[nextIdx])} · ${tx(F.nextUnpaid)}` : "", "var(--fg)"],
  ];
  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={tx(F.reviewTitle)}
      sub={`${nWord} · ${tx(F.notLive)}`}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={onClose}>{tx(F.keepEditing)}</button>
          {preview ? (
            <button type="button" className="tap btn pri" style={{ flex: 1.6 }} disabled={busy || !editable} onClick={publish}>
              <Ic n="send" />
              {busy ? tx(F.publishing) : `${tx(F.publish)} ${nWord}`}
            </button>
          ) : (
            <button type="button" className="tap btn pri" style={{ flex: 1.6 }} disabled={busy || !editable || !n} onClick={check}>
              <Ic n="search" />
              {busy ? tx(F.counting) : tx(F.check)}
            </button>
          )}
        </>
      }
    >
      <div className="fs-c fs-lh" style={{ gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {kpis.map(([label, v, sub, fg], i) => (
            <span key={label.en} className="fs-c rise" style={{ padding: "10px 12px", borderRadius: 14, background: "var(--s2)", animationDelay: delay(i) }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{tx(label)}</span>
              <span className="num" style={{ fontSize: 18, fontWeight: 700, color: fg }}>{v}</span>
              <span className="fs-m">{sub}</span>
            </span>
          ))}
        </div>
        {!preview ? (
          <div className="fs-nt fs-in">
            <Ic n="info" />
            <span>{tx(F.countInfo)}</span>
          </div>
        ) : null}
        {preview && preview.studentsEndingInCredit ? (
          <div className="fs-nt fs-wa">
            <Ic n="alert" />
            <span>{tx(F.creditNote(preview.studentsEndingInCredit, rupees(preview.creditTotal)))}</span>
          </div>
        ) : null}
        {preview && (preview.blockedInstallments > 0 || preview.rowsMarkedForReview > 0) ? (
          <div className="fs-nt fs-wa">
            <Ic n="alert" />
            <span>
              {tx(F.heldNote(preview.blockedInstallments))}
              {preview.rowsMarkedForReview ? ` ${preview.rowsMarkedForReview} ${tx(F.reviewRows)}` : ""}
            </span>
          </div>
        ) : null}
        {preview ? <span className="fs-m">{tx(F.rowsLine(preview.installmentsToUpdate, preview.installmentsToInsert, preview.installmentsToCancel))}</span> : null}
        <div className="fs-c">
          <span className="sech">{tx(F.whatChanges)}</span>
          {!n ? <EmptyState icon="edit" title={tx(F.noChanges)} body={tx(F.noChangesBody)} /> : null}
          <div className="fs-c fs-ls">
            {changes.map((c, i) => (
              <div key={c.key} className="fs-f fs-xi" style={{ alignItems: "flex-start", gap: 12, padding: "12px 0", animationDelay: delay(i) }}>
                <span className="fs-ib fs-t36 fs-ac">
                  <Ic n={AREA_ICON[c.area]} />
                </span>
                <span className="fs-c" style={{ flex: 1, gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{c.title}</span>
                  <span className="fs-f" style={{ flexWrap: "wrap", gap: 6 }}>
                    <span className="num" style={{ fontSize: 13, color: "var(--sub)", textDecoration: "line-through" }}>{c.before}</span>
                    <Ic n="arrowRight" size={14} style={{ color: "var(--sub)" }} />
                    <span className="num fs-ac" style={{ fontSize: 13, fontWeight: 700, padding: "1px 8px", borderRadius: 7 }}>{c.after}</span>
                  </span>
                  {c.area === "latefee" ? <span className="fs-m">{tx(F.apart)}</span> : null}
                  {c.area === "class" ? <span className="fs-m">{data.studentsByClass[c.title.split(" · ")[0]] ?? 0} {tx(F.students)}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="card" style={{ padding: "4px 14px 12px" }}>
          <button type="button" className="tap fs-rb" role="switch" aria-checked={tell} onClick={() => setTell(!tell)} style={{ padding: "10px 0" }}>
            <span className="fs-ib fs-t36 fs-ok">
              <Ic n="message" />
            </span>
            <span className="fs-c" style={{ flex: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(F.tellParents)}</span>
              <span className="fs-m">{tx(F.tellSub)}</span>
            </span>
            <SwitchKnob on={tell} />
          </button>
          {tell && n ? (
            <div className="fadein fs-c" style={{ gap: 10 }}>
              <div style={{ padding: 12, borderRadius: 14, background: "var(--wabg)" }}>
                <div style={{ maxWidth: 440, padding: "10px 12px 6px", borderRadius: "4px 14px 14px 14px", background: "var(--wab)", color: "var(--wafg)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-line", boxShadow: "0 1px 1px rgba(0,0,0,.12)" }}>
                  {msg.hi}
                  <span style={{ display: "block", marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,.08)", opacity: 0.85 }}>{msg.en}</span>
                </div>
              </div>
              <Btn variant="sec" icon="copy" onClick={copy} style={{ alignSelf: "flex-start" }}>{tx(F.copyMsg)}</Btn>
            </div>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

/* ---------- history & ask ---------- */

function HistorySheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: FeeSetupVxData }) {
  const { tx } = useVx();
  const tone = (s: string) => (s === "applied" ? "fs-ok" : s === "failed" || s === "rejected" ? "fs-er" : "fs-nu");
  return (
    <Sheet open={open} onClose={onClose} title={tx(F.versions)} sub={tx(F.versionsSub)}>
      <div className="fs-c" style={{ gap: 10 }}>
        {data.history.map((h, i) => (
          <div key={h.id} className="card fs-c" style={{ padding: "14px 16px", gap: 6 }}>
            <div className="fs-f" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <span className="fs-tt" style={{ flex: 1, minWidth: 160 }}>
                {i === 0 && h.status === "applied" ? `${tx(F.live)} · ` : ""}
                {h.targetLabel || h.scopeLabel}
              </span>
              <span className={`pill ${tone(h.status)}`}>{h.statusLabel}</span>
            </div>
            <span className="fs-m">
              {h.createdByName ?? tx(F.someone)} · {ddm(h.appliedAt ?? h.createdAt)} · {tx(agoP(h.appliedAt ?? h.createdAt))}
            </span>
            {h.changedFieldLabels.length ? (
              <span style={{ fontSize: 13 }}>
                {h.changedFieldLabels.slice(0, 6).join(", ")}
                {h.changedFieldLabels.length > 6 ? ` +${h.changedFieldLabels.length - 6}` : ""}
              </span>
            ) : null}
            {h.summary ? (
              <span className="fs-m">
                {h.summary.studentsAffected} {tx(F.students)} · {h.summary.installmentsToUpdate} {tx(F.rowsRepriced)}
                {h.summary.blockedInstallments ? ` · ${h.summary.blockedInstallments} ${tx(F.held)}` : ""}
              </span>
            ) : null}
          </div>
        ))}
        {!data.history.length ? <EmptyState icon="history" title={tx(F.noHistory)} /> : null}
        <span className="fs-m">{tx(F.historyNote)}</span>
      </div>
    </Sheet>
  );
}

function AskSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tx } = useVx();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [what, setWhat] = useState("");
  const [why, setWhy] = useState("");
  const send = () =>
    start(async () => {
      const r = await askAdminFeeChangeAction({ what, why });
      toast.show({ text: r.message, tone: r.ok ? "ok" : "bad" });
      if (r.ok) {
        setWhat("");
        setWhy("");
        onClose();
      }
    });
  const field: CSSProperties = { minHeight: 90 };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(F.ask)}
      sub={tx(F.askSub)}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={onClose}>{tx(F.cancel)}</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6 }} disabled={busy || what.trim().length < 3 || why.trim().length < 3} onClick={send}>
            <Ic n="send" />
            {tx(F.sendRequest)}
          </button>
        </>
      }
    >
      <div className="fs-c" style={{ gap: 14 }}>
        <label className="field">
          <span>{tx(F.whichFee)}</span>
          <input className="inp" value={what} onChange={(e) => setWhat(e.target.value)} placeholder={tx(F.whichFeePh)} />
        </label>
        <label className="field">
          <span>{tx(F.whatWhy)}</span>
          <textarea className="inp" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={tx(F.whatWhyPh)} style={field} />
        </label>
      </div>
    </Sheet>
  );
}
