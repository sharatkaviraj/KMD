"use client";

import "./fee-setup.css";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition, type ReactNode } from "react";

import { askAdminFeeChangeAction, publishFeeSetupAction } from "@/app/(app)/fee-setup/actions";
import { INITIAL_FEE_SETUP_ACTION_STATE, type FeeSetupActionState } from "@/modules/fees/domain/types";
import {
  BANDS,
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
import { ago, dayMonth, rupees, rupeesShort, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p } from "@/vx/text";
import { Chip, Field, Input, RadioCard, Seg, Stepper, Switch, Textarea } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState, Kpi, Pill } from "@/vx/ui/primitives";

export type FeeSetupView = "structure" | "edit" | "copy" | "installments" | "discounts" | "rule" | "latefee" | "transport" | "route" | "review" | "history";
type Tab = "structure" | "installments" | "discounts" | "latefee" | "transport";
type SheetName = "" | "copy" | "rule" | "route" | "review" | "history" | "ask";

const T = {
  title: p("Fee setup", "फीस व्यवस्था"),
  structure: p("Structure", "ढांचा"),
  installments: p("Installments", "किस्तें"),
  discounts: p("Discounts", "छूट"),
  latefee: p("Late fee", "विलंब शुल्क"),
  transport: p("Transport", "बस"),
  history: p("History", "इतिहास"),
  review: p("Review & publish", "जांचें और लागू करें"),
  ask: p("Ask admin to change", "एडमिन से बदलवाएं"),
};
const TABS: { key: Tab; icon: IconName; label: typeof T.structure }[] = [
  { key: "structure", icon: "layers", label: T.structure },
  { key: "installments", icon: "calendar", label: T.installments },
  { key: "discounts", icon: "percent", label: T.discounts },
  { key: "latefee", icon: "clock", label: T.latefee },
  { key: "transport", icon: "bus", label: T.transport },
];

function tabOf(view: FeeSetupView): Tab {
  if (view === "edit" || view === "copy" || view === "review" || view === "history") return "structure";
  if (view === "rule") return "discounts";
  if (view === "route") return "transport";
  return view;
}
function sheetOf(view: FeeSetupView): SheetName {
  return view === "copy" || view === "rule" || view === "route" || view === "review" || view === "history" ? view : "";
}

/** Phone or desktop, for the one panel that is a side column on desktop and a sheet on a phone. */
function usePhone() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(max-width: 899px)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(max-width: 899px)").matches,
    () => false,
  );
}

const range = (nos: number[]) => (nos.length === 0 ? "" : nos.length === 1 ? String(nos[0]) : `${nos[0]}–${nos[nos.length - 1]}`);

export function FeeSetup({
  data,
  today,
  initialView,
  initialClass,
  initialRoute,
  canEdit,
  readOnly,
}: {
  data: FeeSetupVxData;
  today: string;
  initialView: FeeSetupView;
  initialClass: string | null;
  initialRoute: string | null;
  canEdit: boolean;
  readOnly: boolean;
}) {
  const { tx } = useVx();
  const phone = usePhone();
  const base = data.draft;
  const [draft, setDraft] = useState<FeeSetupDraft>(base);
  const [tab, setTab] = useState<Tab>(tabOf(initialView));
  const [sheet, setSheet] = useState<SheetName>(sheetOf(initialView));
  const [editClass, setEditClass] = useState<string | null>(initialView === "edit" ? (initialClass ?? base.classRows.find((c) => bandOf(c.label) === "middle")?.label ?? base.classRows[0]?.label ?? null) : null);
  const [editRoute, setEditRoute] = useState<string | null>(initialView === "route" ? (initialRoute ?? base.routeRows.find((r) => r.annualFee > 0)?.routeName ?? null) : null);
  const editable = canEdit && !readOnly;
  const changes = diffDrafts(base, draft);
  const paidNos = data.paidInstallments;

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
    { icon: "layers" as IconName, title: "Nothing is live until you publish", body: "Edits collect in the bar at the bottom. Review shows every change and how many students it touches before anything changes." },
    { icon: "lock" as IconName, title: "Paid money stays paid", body: "A new fee reprices the year. Receipts already written are never edited; a family that has paid more than the new total gets credit." },
    { icon: "clock" as IconName, title: "Late fee is separate", body: "It is charged on its own line and never added to the fee." },
  ];

  const editPanel = editClass ? (
    <EditClassPanel
      key={editClass}
      label={editClass}
      draft={draft}
      base={base}
      students={data.studentsByClass[editClass] ?? 0}
      paidNos={paidNos}
      editable={editable}
      onCancel={() => pickClass(null)}
      onSave={(tuition) => {
        setDraft((d) => ({ ...d, classRows: d.classRows.map((c) => (c.label === editClass ? { ...c, annualTuition: tuition } : c)) }));
        pickClass(null);
      }}
    />
  ) : null;

  return (
    <VxPage>
      <TopBar
        crumb={`Money · Session ${data.sessionLabel}${data.updatedAt ? ` · saved ${ago(data.updatedAt)}` : ""}`}
        title={tx(T.title)}
        mSub={`${tx(TABS.find((t) => t.key === tab)!.label)} · ${data.sessionLabel}`}
        mBack="/menu"
        mAction={<Btn variant="ghost" icon="history" onClick={() => open("history")} ariaLabel={tx(T.history)} />}
        actions={
          <>
            <HelpButton title="Fee setup" steps={help} />
            {!canEdit ? <Btn icon="message" onClick={() => open("ask")} disabled={readOnly}>{tx(T.ask)}</Btn> : null}
            <Btn icon="history" onClick={() => open("history")}>{tx(T.history)}</Btn>
          </>
        }
      />
      <div style={{ padding: "14px 28px", borderBottom: "1px solid var(--bd)" }} className="pad">
        <div className="fs-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tap fs-tab${tab === t.key ? " on" : ""}`} onClick={() => goTab(t.key)}>
              <Ic n={t.icon} size={16} />
              {tx(t.label)}
            </button>
          ))}
        </div>
      </div>
      <div className={`fs-lay${editPanel && !phone ? " has" : ""}`}>
        <Section>
          {!canEdit ? (
            <div className="fs-info">
              <Ic n="eye" size={18} />
              <span style={{ flex: 1 }}>View only. Fees are changed by the admin; ask and it shows in your requests.</span>
              <Btn variant="soft" icon="message" onClick={() => open("ask")} disabled={readOnly} style={{ height: 34 }}>{tx(T.ask)}</Btn>
            </div>
          ) : null}
          {tab === "structure" ? <StructureTab data={data} draft={draft} base={base} paidNos={paidNos} selected={editClass} onPick={pickClass} onCopy={() => open("copy")} editable={editable} setDraft={setDraft} /> : null}
          {tab === "installments" ? <InstallmentsTab data={data} draft={draft} base={base} today={today} editable={editable} setDraft={setDraft} /> : null}
          {tab === "discounts" ? <DiscountsTab data={data} draft={draft} editable={editable} setDraft={setDraft} onAdd={() => open("rule")} /> : null}
          {tab === "latefee" ? <LateFeeTab draft={draft} base={base} today={today} editable={editable} setDraft={setDraft} /> : null}
          {tab === "transport" ? <TransportTab data={data} draft={draft} base={base} editable={editable} onPick={pickRoute} /> : null}
          <div style={{ height: changes.length ? 70 : 0 }} />
        </Section>
        {editPanel && !phone ? <aside className="fs-aside">{editPanel}</aside> : null}
      </div>
      {changes.length && editable ? (
        <div className="fs-bar" role="status">
          <span className="dot" />
          <span className="fs-c" style={{ flex: 1 }}>
            <b>{changes.length} unsaved {changes.length === 1 ? "change" : "changes"}</b>
            <span style={{ fontSize: 12, opacity: 0.8 }}>Not live yet · parents see nothing till you publish</span>
          </span>
          <button type="button" className="tap btn ghost" onClick={() => setDraft(base)}>Discard</button>
          <button type="button" className="tap btn" style={{ background: "var(--acc)", color: "var(--onsolid)" }} onClick={() => open("review")}>
            {tx(T.review)} <Ic n="arrowRight" size={16} />
          </button>
        </div>
      ) : null}

      <Sheet open={Boolean(editPanel) && phone} onClose={() => pickClass(null)} title={editClass ?? ""}>
        {editPanel ?? <span />}
      </Sheet>
      <CopySheet open={sheet === "copy"} onClose={close} draft={draft} base={base} editable={editable} onApply={(rows) => setDraft((d) => ({ ...d, classRows: rows }))} />
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
      {sheet === "review" ? <ReviewSheet onClose={close} draft={draft} changes={changes} data={data} editable={editable} onDone={() => setDraft(base)} /> : null}
      <HistorySheet open={sheet === "history"} onClose={close} data={data} />
      <AskSheet open={sheet === "ask"} onClose={close} />
    </VxPage>
  );
}

type SetDraft = (fn: (d: FeeSetupDraft) => FeeSetupDraft) => void;

function LockNote({ paidNos, count }: { paidNos: number[]; count: number }) {
  if (!paidNos.length) return null;
  const unpaid = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !paidNos.includes(n));
  return (
    <div className="fs-lock">
      <Ic n="lock" size={18} />
      <span>
        Receipts exist for Installments {range(paidNos)}. <b>Money already paid stays paid</b>; a change reprices the year{unpaid.length ? ` and lands on what is unpaid (${unpaid.join(" and ")})` : ""}. A family that has paid more than the new total gets credit, counted for you before you publish.
      </span>
    </div>
  );
}

/* ---------- structure ---------- */

function StructureTab({ data, draft, base, paidNos, selected, onPick, onCopy, editable, setDraft }: { data: FeeSetupVxData; draft: FeeSetupDraft; base: FeeSetupDraft; paidNos: number[]; selected: string | null; onPick: (l: string) => void; onCopy: () => void; editable: boolean; setDraft: SetDraft }) {
  const n = draft.installmentDates.length;
  const baseBy = new Map(base.classRows.map((c) => [c.label, c.annualTuition]));
  const groups = BANDS.map((b) => ({ band: b, rows: draft.classRows.filter((c) => bandOf(c.label) === b.key) })).filter((g) => g.rows.length);
  const students = Object.values(data.studentsByClass).reduce((s, v) => s + v, 0);
  const narrow = Boolean(selected);
  return (
    <>
      <div className="fs-f" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <span className="fs-c">
          <b style={{ fontSize: 16 }}>Yearly fee by class</b>
          <span className="fs-m">{draft.classRows.length} classes · {students} students · {n} installments</span>
        </span>
        {editable ? <Btn icon="copy" onClick={onCopy}>Raise every class by %</Btn> : null}
      </div>
      <LockNote paidNos={paidNos} count={n} />
      <Card pad={false} style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="fs-tbl">
            <thead>
              <tr>
                <th>Class</th>
                <th className="hide-p">Students</th>
                <th>Tuition</th>
                {!narrow ? <th className="hide-p">Academic</th> : null}
                <th className="hide-p">Yearly total</th>
                <th>Per installment</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <BandRows key={g.band.key} label={g.band.label} narrow={narrow}>
                  {g.rows.map((c) => {
                    const was = baseBy.get(c.label);
                    const changed = was !== undefined && was !== c.annualTuition;
                    const per = perInstallment(draft, c.annualTuition);
                    const equal = per.every((v) => v === per[0]);
                    return (
                      <tr key={c.label} className={`fs-row${selected === c.label ? " on" : ""}`} onClick={() => onPick(c.label)}>
                        <td>
                          <b>{c.label}</b>
                          <span className="fs-m" style={{ display: "block" }}>{data.studentsByClass[c.label] ?? 0} students</span>
                        </td>
                        <td className="hide-p">{data.studentsByClass[c.label] ?? 0}</td>
                        <td>
                          {changed ? <span className="fs-was">{rupees(was)}</span> : null}
                          <span className={changed ? "fs-new" : undefined}>{rupees(c.annualTuition)}</span>
                        </td>
                        {!narrow ? <td className="hide-p">{rupees(draft.oldStudentAcademicFeeAmount)}</td> : null}
                        <td className="hide-p"><b>{rupees(c.annualTuition + draft.oldStudentAcademicFeeAmount)}</b></td>
                        <td>
                          <span className="fs-f" style={{ justifyContent: "flex-end", gap: 6 }}>
                            {equal ? `${per.length} × ${rupees(per[0])}` : `${rupees(per[0])} + ${per.length - 1} × ${rupees(per[1] ?? 0)}`}
                            {paidNos.length ? <Ic n="lock" size={14} style={{ color: "var(--mut)" }} /> : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </BandRows>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <AcademicCard draft={draft} base={base} editable={editable} setDraft={setDraft} />
      {draft.customFeeHeads.length ? (
        <Card>
          <b>Other fee heads</b>
          <span className="fs-m" style={{ display: "block", marginBottom: 8 }}>Charged per student as set in the detailed fee setup</span>
          {draft.customFeeHeads.map((h) => (
            <div key={h.id} className="fs-f" style={{ justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
              <span className="fs-c">
                <span>{h.label}</span>
                <span className="fs-m">{h.chargeFrequency === "one_time" ? "One time" : "Every year"} · {h.isActive ? "on" : "off"}</span>
              </span>
              <b className="num">{rupees(h.amount)}</b>
            </div>
          ))}
        </Card>
      ) : null}
    </>
  );
}

function BandRows({ label, children, narrow }: { label: string; children: ReactNode; narrow: boolean }) {
  return (
    <>
      <tr className="fs-band">
        <td colSpan={narrow ? 5 : 6}>{label}</td>
      </tr>
      {children}
    </>
  );
}

function AcademicCard({ draft, base, editable, setDraft }: { draft: FeeSetupDraft; base: FeeSetupDraft; editable: boolean; setDraft: SetDraft }) {
  const set = (k: "newStudentAcademicFeeAmount" | "oldStudentAcademicFeeAmount", v: string) => setDraft((d) => ({ ...d, [k]: Math.max(0, Math.round(Number(v.replace(/\D/g, "")) || 0)) }));
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="fs-c">
        <b>Academic fee · every class</b>
        <span className="fs-m">A new student pays the new-student amount once; everyone else the old-student amount</span>
      </span>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
        <Field label="New students · per year" hint={draft.newStudentAcademicFeeAmount !== base.newStudentAcademicFeeAmount ? `Live now ${rupees(base.newStudentAcademicFeeAmount)}` : "Same as live"}>
          <Input inputMode="numeric" lead="₹" value={String(draft.newStudentAcademicFeeAmount)} onChange={(e) => set("newStudentAcademicFeeAmount", e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Old students · per year" hint={draft.oldStudentAcademicFeeAmount !== base.oldStudentAcademicFeeAmount ? `Live now ${rupees(base.oldStudentAcademicFeeAmount)}` : "Same as live"}>
          <Input inputMode="numeric" lead="₹" value={String(draft.oldStudentAcademicFeeAmount)} onChange={(e) => set("oldStudentAcademicFeeAmount", e.target.value)} disabled={!editable} />
        </Field>
      </div>
    </Card>
  );
}

function EditClassPanel({ label, draft, base, students, paidNos, editable, onCancel, onSave }: { label: string; draft: FeeSetupDraft; base: FeeSetupDraft; students: number; paidNos: number[]; editable: boolean; onCancel: () => void; onSave: (tuition: number) => void }) {
  const row = draft.classRows.find((c) => c.label === label);
  const live = base.classRows.find((c) => c.label === label)?.annualTuition ?? 0;
  const [value, setValue] = useState(String(row?.annualTuition ?? 0));
  const tuition = Math.max(0, Math.round(Number(value.replace(/\D/g, "")) || 0));
  const now = perInstallment(base, live);
  const next = perInstallment(draft, tuition);
  const delta = tuition - live;
  return (
    <div className="fs-c" style={{ gap: 14, padding: 20, flex: 1 }}>
      <span className="fs-c">
        <b className="serif" style={{ fontSize: 22 }}>{label}</b>
        <span className="fs-m">{students} students · band {BANDS.find((b) => b.key === bandOf(label))?.label}</span>
      </span>
      {paidNos.length ? (
        <div className="fs-lock">
          <Ic n="lock" size={16} />
          <span>Receipts exist for Inst {range(paidNos)} · paid money stays paid; the new fee lands on what is unpaid</span>
        </div>
      ) : null}
      <Field label="Tuition · per year" hint={delta ? <span style={{ color: "var(--accfg)" }}>Every student · live now {rupees(live)}</span> : "Same as live"}>
        <Input inputMode="numeric" lead="₹" value={value} onChange={(e) => setValue(e.target.value)} disabled={!editable} autoFocus={editable} />
      </Field>
      <span className="fs-m">Academic fee {rupees(draft.oldStudentAcademicFeeAmount)} (old) or {rupees(draft.newStudentAcademicFeeAmount)} (new) is set once for every class, below the table.</span>
      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="fs-f" style={{ justifyContent: "space-between" }}>
          <span className="fs-c">
            <span className="fs-m">Yearly total · old student</span>
            <b className="num" style={{ fontSize: 26 }}>{rupees(tuition + draft.oldStudentAcademicFeeAmount)}</b>
          </span>
          {delta ? <Pill tone={delta > 0 ? "acc" : "warn"}>{delta > 0 ? "+" : "−"}{rupees(Math.abs(delta))} a year</Pill> : null}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${next.length}, minmax(0,1fr))`, gap: 6 }}>
          {next.map((v, i) => {
            const paid = paidNos.includes(i + 1);
            const moved = v !== now[i];
            return (
              <span key={i} className="fs-c" style={{ padding: "8px 10px", borderRadius: 10, background: moved ? "var(--accs)" : "var(--s2)", color: moved ? "var(--accfg)" : "var(--fg)" }}>
                <span style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 3 }}>{paid ? <Ic n="lock" size={11} /> : moved ? <Ic n="arrowUp" size={11} /> : null}Inst {i + 1}</span>
                <b className="num" style={{ fontSize: 14 }}>{rupees(v)}</b>
              </span>
            );
          })}
        </div>
        {delta ? (
          <span className="fs-f" style={{ color: "var(--info)", fontSize: 13, fontWeight: 600 }}>
            <Ic n="users" size={15} /> Affects {students} students · {delta > 0 ? "+" : "−"}{rupees(Math.abs(delta))} each this year
          </span>
        ) : null}
      </Card>
      <span style={{ flex: 1 }} />
      <div className="fs-f" style={{ gap: 10 }}>
        <button type="button" className="tap btn sec" style={{ flex: 1, height: 46 }} onClick={onCancel}>{editable ? "Cancel" : "Close"}</button>
        {editable ? (
          <button type="button" className="tap btn pri" style={{ flex: 1.6, height: 46 }} onClick={() => onSave(tuition)} disabled={tuition === row?.annualTuition}>
            <Ic n="check" size={18} />Save to changes
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CopySheet({ open, onClose, draft, base, editable, onApply }: { open: boolean; onClose: () => void; draft: FeeSetupDraft; base: FeeSetupDraft; editable: boolean; onApply: (rows: FeeSetupDraft["classRows"]) => void }) {
  const [pct, setPct] = useState(5);
  const raised = raiseTuition(base.classRows, pct);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Raise every class by %"
      sub="Starts from the live fees, rounded to ₹100"
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onClose}>Cancel</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6, height: 48 }} disabled={!editable} onClick={() => { onApply(raised); onClose(); }}><Ic n="check" size={18} />Put in changes</button>
        </>
      }
    >
      <div className="fs-c" style={{ gap: 14 }}>
        <Stepper value={pct} onChange={setPct} min={-20} max={40} label="Raise by percent" />
        <div className="fs-f" style={{ flexWrap: "wrap", gap: 6 }}>
          {[3, 5, 8, 10].map((v) => <Chip key={v} on={pct === v} onClick={() => setPct(v)}>{v}%</Chip>)}
        </div>
        <Card pad={false} style={{ overflow: "hidden" }}>
          {raised.map((r) => {
            const was = base.classRows.find((c) => c.label === r.label)?.annualTuition ?? 0;
            return (
              <div key={r.label} className="fs-f" style={{ justifyContent: "space-between", padding: "9px 14px", borderTop: "1px solid var(--bd)" }}>
                <span>{r.label}</span>
                <span className="num"><span className="fs-m" style={{ textDecoration: "line-through", marginRight: 8 }}>{rupees(was)}</span><b>{rupees(r.annualTuition)}</b></span>
              </div>
            );
          })}
        </Card>
        <span className="fs-m">Replaces any class fee you already edited in this draft ({draft.classRows.filter((c, i) => c.annualTuition !== base.classRows[i]?.annualTuition).length} now). Nothing is live until you publish.</span>
      </div>
    </Sheet>
  );
}

/* ---------- installments ---------- */

function InstallmentsTab({ data, draft, base, today, editable, setDraft }: { data: FeeSetupVxData; draft: FeeSetupDraft; base: FeeSetupDraft; today: string; editable: boolean; setDraft: SetDraft }) {
  const dates = draft.installmentDates;
  const nextIdx = dates.findIndex((d) => d > today);
  const done = nextIdx === -1 ? dates.length : nextIdx;
  const days = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const setDate = (i: number, v: string) => setDraft((d) => ({ ...d, installmentDates: d.installmentDates.map((x, j) => (j === i ? v : x)) }));
  const cols = dates.length;
  const sample = BANDS.map((b) => draft.classRows.find((c) => bandOf(c.label) === b.key)).filter(Boolean) as FeeSetupDraft["classRows"];
  return (
    <>
      <Card style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="fs-f" style={{ justifyContent: "space-between" }}>
          <b>When fees fall due</b>
          <span className="fs-m">Today · {shortDay(today)}</span>
        </div>
        <div className="fs-tl" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          <i style={{ left: `${50 / cols}%`, right: `${50 / cols}%` }}>
            <b style={{ width: `${cols > 1 ? (Math.max(0, done - 1) / (cols - 1)) * 100 : 0}%` }} />
          </i>
          {dates.map((d, i) => {
            const locked = isDateLocked(base.installmentDates[i] ?? d, today);
            const moved = d !== base.installmentDates[i];
            return (
              <div key={i}>
                <span className={`fs-dot${i < done ? " done" : i === done ? " next" : ""}`}>
                  <Ic n={i < done ? "check" : i === done ? "clock" : "calendar"} size={18} />
                </span>
                <b>Inst {i + 1}</b>
                {locked || !editable ? (
                  <Pill icon={locked ? "lock" : "calendar"}>{dayMonth(d)}</Pill>
                ) : (
                  <Input type="date" value={d} min={today} onChange={(e) => e.target.value && setDate(i, e.target.value)} aria-label={`Installment ${i + 1} due date`} style={{ width: 150, height: 36, borderColor: moved ? "var(--acc)" : undefined }} />
                )}
                <span className="fs-m" style={{ color: i < done ? "var(--ok)" : i === done ? "var(--accfg)" : undefined }}>
                  {i < done ? `Due passed${data.paidInstallments.includes(i + 1) ? " · receipts written" : ""}` : i === done ? `Next · in ${days(d)} days` : `In ${days(d)} days`}
                </span>
              </div>
            );
          })}
        </div>
        <span className="fs-m" style={{ textAlign: "center" }}>{editable ? "Pick a new date for an installment still ahead. Passed dates are locked." : "Passed dates are locked."}</span>
      </Card>
      <div className="g2 stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,0.9fr) minmax(0,1.1fr)", gap: 14, alignItems: "start" }}>
        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="fs-c">
            <b>How the year is split</b>
            <span className="fs-m">Tuition and bus fee are always split equally over the {cols} installments. Choose where the academic fee goes.</span>
          </span>
          <RadioCard checked={draft.academicFeeDistribution === "first_only"} onSelect={() => editable && setDraft((d) => ({ ...d, academicFeeDistribution: "first_only" }))} title="All academic fee in Installment 1" sub="The first bill is bigger" />
          <RadioCard checked={draft.academicFeeDistribution === "equal"} onSelect={() => editable && setDraft((d) => ({ ...d, academicFeeDistribution: "equal" }))} title="Academic fee spread over every installment" sub="Every bill is the same" />
          {draft.academicFeeDistribution !== base.academicFeeDistribution ? <Pill tone="acc" icon="edit">Changed · not live yet</Pill> : null}
        </Card>
        <Card pad={false} style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 16px" }} className="fs-c">
            <b>What each class pays</b>
            <span className="fs-m">Per installment, old student, with your edits · one class from each band</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="fs-tbl">
              <thead>
                <tr>
                  <th>Class</th>
                  {dates.map((_, i) => <th key={i} className={i > 1 ? "hide-p" : undefined}>Inst {i + 1}</th>)}
                  <th>Year</th>
                </tr>
              </thead>
              <tbody>
                {sample.map((c) => {
                  const per = perInstallment(draft, c.annualTuition);
                  return (
                    <tr key={c.label}>
                      <td><b>{c.label}</b></td>
                      {per.map((v, i) => <td key={i} className={i > 1 ? "hide-p" : undefined}>{rupees(v)}</td>)}
                      <td><b>{rupees(per.reduce((s, v) => s + v, 0))}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ---------- discounts ---------- */

function DiscountsTab({ data, draft, editable, setDraft, onAdd }: { data: FeeSetupVxData; draft: FeeSetupDraft; editable: boolean; setDraft: SetDraft; onAdd: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const total = Object.values(data.ruleStudents).reduce((s, v) => s + v, 0);
  const setRule = (key: string, patch: Partial<DiscountDraft>) => setDraft((d) => ({ ...d, discounts: d.discounts.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const icon = (d: DiscountDraft): IconName => (d.code === "rte" ? "shield" : d.code.includes("staff") ? "briefcase" : d.code.includes("child") || d.code.includes("sibling") ? "users" : "percent");
  const big = (d: DiscountDraft) => (d.calculationType === "tuition_zero" ? "100%" : d.calculationType === "tuition_percentage" ? `${d.percentage ?? 0}%` : rupees(d.fixedTuitionAmount ?? 0));
  return (
    <>
      <div className="fs-f" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <span className="fs-c">
          <b style={{ fontSize: 16 }}>Discounts and concessions</b>
          <span className="fs-m">{total} students this session · {draft.discounts.length} rules · on tuition only</span>
        </span>
        {editable ? <Btn variant="soft" icon="plus" onClick={onAdd}>Add a rule</Btn> : null}
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
        {draft.discounts.map((d, i) => {
          const count = d.id ? (data.ruleStudents[d.id] ?? 0) : 0;
          const names = d.id ? (data.ruleStudentNames[d.id] ?? []) : [];
          return (
            <Card key={d.key} pad={false} className="rise" style={{ animationDelay: `${i * 30}ms` }}>
              <div className="fs-rule">
                <div className="fs-f" style={{ alignItems: "flex-start", gap: 12 }}>
                  <span className="fs-ib"><Ic n={icon(d)} size={20} /></span>
                  <span className="fs-c" style={{ flex: 1 }}>
                    <b style={{ fontSize: 15 }}>{d.displayName}</b>
                    <span className="fs-m">{describeDiscount(d)}</span>
                  </span>
                  <Switch on={d.isActive} onChange={(on) => setRule(d.key, { isActive: on })} label={d.isActive ? "On" : "Off"} disabled={!editable} />
                </div>
                <div className="fs-f" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
                  <span className="fs-pct">{big(d)}</span>
                  <span className="fs-c" style={{ alignItems: "flex-end" }}>
                    <b>{d.id ? `${count} students` : "New · not live"}</b>
                    <span className="fs-m">{d.calculationType === "tuition_fixed_amount" ? "pays this tuition" : "off tuition"}</span>
                  </span>
                </div>
                <div className="fs-f" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="fs-m">Tuition only ·</span>
                  <Pill tone="mut">Given per student by the admin</Pill>
                  {names.length ? <button type="button" className="tap btn ghost" style={{ height: 30, marginLeft: "auto", fontSize: 13 }} onClick={() => setOpenKey(openKey === d.key ? null : d.key)}>{openKey === d.key ? "Hide" : "Who"}</button> : null}
                </div>
                {editable && d.calculationType !== "tuition_zero" ? (
                  <Field label={d.calculationType === "tuition_percentage" ? "Percent off tuition" : "Tuition they pay · per year"}>
                    <Input
                      inputMode="numeric"
                      lead={d.calculationType === "tuition_percentage" ? "%" : "₹"}
                      value={String(d.calculationType === "tuition_percentage" ? (d.percentage ?? 0) : (d.fixedTuitionAmount ?? 0))}
                      onChange={(e) => {
                        const v = Math.max(0, Math.round(Number(e.target.value.replace(/\D/g, "")) || 0));
                        setRule(d.key, d.calculationType === "tuition_percentage" ? { percentage: Math.min(100, v) } : { fixedTuitionAmount: v });
                      }}
                    />
                  </Field>
                ) : null}
                {openKey === d.key ? (
                  <div className="fs-c" style={{ gap: 4, padding: 10, borderRadius: 10, background: "var(--s2)" }}>
                    {names.map((n, j) => <span key={j} style={{ fontSize: 13 }}>{n}</span>)}
                    {count > names.length ? <span className="fs-m">+ {count - names.length} more</span> : null}
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
      {!draft.discounts.length ? <EmptyState icon="percent" title="No discount rules" body="Add a rule such as a sibling or staff-child discount." /> : null}
      <span className="fs-m">Which student gets which rule is set on the student. Turning a rule off reprices the students on it when you publish.</span>
    </>
  );
}

function RuleSheet({ open, onClose, draft, editable, onAdd }: { open: boolean; onClose: () => void; draft: FeeSetupDraft; editable: boolean; onAdd: (d: DiscountDraft) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DiscountDraft["calculationType"]>("tuition_percentage");
  const [value, setValue] = useState("10");
  const v = Math.max(0, Math.round(Number(value.replace(/\D/g, "")) || 0));
  const ok = name.trim().length >= 3 && (kind === "tuition_zero" || (kind === "tuition_percentage" ? v > 0 && v <= 100 : v >= 0));
  const add = () => {
    const code = ruleCode(name, draft.discounts.map((d) => d.code));
    onAdd({ key: `new-${code}`, id: null, code, displayName: name.trim(), calculationType: kind, percentage: kind === "tuition_percentage" ? v : null, fixedTuitionAmount: kind === "tuition_fixed_amount" ? v : null, isActive: true, isBuiltin: false });
    setName("");
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a rule"
      sub="A discount on tuition, given to students one by one"
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onClose}>Cancel</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6, height: 48 }} disabled={!ok || !editable} onClick={add}><Ic n="plus" size={18} />Add to changes</button>
        </>
      }
    >
      <div className="fs-c" style={{ gap: 14 }}>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Sibling discount" /></Field>
        <Field label="What they get">
          <div className="fs-c" style={{ gap: 8 }}>
            <RadioCard checked={kind === "tuition_percentage"} onSelect={() => setKind("tuition_percentage")} title="A percent off tuition" icon="percent" />
            <RadioCard checked={kind === "tuition_fixed_amount"} onSelect={() => setKind("tuition_fixed_amount")} title="A fixed yearly tuition" icon="rupee" />
            <RadioCard checked={kind === "tuition_zero"} onSelect={() => setKind("tuition_zero")} title="Free tuition" icon="gift" />
          </div>
        </Field>
        {kind !== "tuition_zero" ? (
          <Field label={kind === "tuition_percentage" ? "Percent" : "Tuition per year"} error={kind === "tuition_percentage" && v > 100 ? "At most 100%" : undefined}>
            <Input inputMode="numeric" lead={kind === "tuition_percentage" ? "%" : "₹"} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        ) : null}
        <span className="fs-m">Discounts apply to tuition only; academic fee, bus fee and late fee are not reduced.</span>
      </div>
    </Sheet>
  );
}

/* ---------- late fee ---------- */

function LateFeeTab({ draft, base, today, editable, setDraft }: { draft: FeeSetupDraft; base: FeeSetupDraft; today: string; editable: boolean; setDraft: SetDraft }) {
  const [inst, setInst] = useState(() => Math.max(0, draft.installmentDates.filter((d) => d <= today).length - 1));
  const due = draft.installmentDates[inst] ?? today;
  const plus = (n: number) => new Date(Date.parse(`${due}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const options = [0, 3, 10, 20, 35].map(plus);
  const [paidOn, setPaidOn] = useState<string | null>(null);
  const on = paidOn ?? options[2];
  const fee = lateFeeFor({ dueDate: due, paidOn: on, flat: draft.lateFeeFlatAmount });
  const charging = draft.lateFeeFlatAmount > 0;
  return (
    <div className="g2 stack" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14, alignItems: "start" }}>
      <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="fs-f" style={{ justifyContent: "space-between" }}>
          <span className="fs-c">
            <b>Charge a late fee</b>
            <span className="fs-m">{charging ? "On · once for each installment paid after its due date" : "Off"}</span>
          </span>
          <Switch on={charging} onChange={(v) => setDraft((d) => ({ ...d, lateFeeFlatAmount: v ? base.lateFeeFlatAmount || 100 : 0 }))} label="Charge a late fee" disabled={!editable} />
        </div>
        <div className="fs-f" style={{ justifyContent: "space-between", borderTop: "1px solid var(--bd)", paddingTop: 12 }}>
          <span className="fs-c">
            <b>Per installment</b>
            <span className="fs-m">{draft.lateFeeFlatAmount !== base.lateFeeFlatAmount ? `Live now ${rupees(base.lateFeeFlatAmount)}` : "Same as live"}</span>
          </span>
          {editable ? <Stepper value={draft.lateFeeFlatAmount} onChange={(v) => setDraft((d) => ({ ...d, lateFeeFlatAmount: v }))} min={0} max={5000} label="Late fee per installment" /> : <b className="num">{rupees(draft.lateFeeFlatAmount)}</b>}
        </div>
        <div className="fs-f" style={{ gap: 6, flexWrap: "wrap" }}>
          {editable ? [50, 100, 200, 300].map((v) => <Chip key={v} on={draft.lateFeeFlatAmount === v} onClick={() => setDraft((d) => ({ ...d, lateFeeFlatAmount: v }))}>{rupees(v)}</Chip>) : null}
        </div>
        <div className="fs-c" style={{ gap: 6, borderTop: "1px solid var(--bd)", paddingTop: 12 }}>
          <b>Who can waive a late fee</b>
          <span className="fs-m">Admin and accountant, at the Payment Desk. Each waiver needs a reason and is logged.</span>
        </div>
        <div className="fs-info"><Ic n="info" size={16} /><span>A late fee is always its own line. It is never added to the fee, and a family whose only debt is a late fee is not a defaulter.</span></div>
      </Card>
      <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="fs-c">
          <b>Try it</b>
          <span className="fs-m">Installment {inst + 1} · due {shortDay(due)}</span>
        </span>
        <Seg options={draft.installmentDates.map((_, i) => ({ value: String(i), label: `Inst ${i + 1}` }))} value={String(inst)} onChange={(v) => { setInst(Number(v)); setPaidOn(null); }} label="Installment" />
        <span className="fs-m">Paid on</span>
        <div className="fs-f" style={{ gap: 6, flexWrap: "wrap" }}>
          {options.map((d) => <Chip key={d} on={on === d} onClick={() => setPaidOn(d)}>{dayMonth(d)}</Chip>)}
        </div>
        <div className="fs-f" style={{ justifyContent: "space-between", padding: 14, borderRadius: 14, background: fee ? "var(--warns)" : "var(--oks)" }}>
          <span className="fs-c">
            <b>Late fee</b>
            <span className="fs-m">{fee ? `Paid ${Math.round((Date.parse(`${on}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000)} days after the due date` : "Paid by the due date"}</span>
          </span>
          <b className="serif" style={{ fontSize: 30, color: fee ? "var(--warnfg)" : "var(--ok)" }}>{rupees(fee)}</b>
        </div>
        <span className="fs-m">Charged on its own receipt line. The installment itself does not change.</span>
      </Card>
    </div>
  );
}

/* ---------- transport ---------- */

function TransportTab({ data, draft, base, editable, onPick }: { data: FeeSetupVxData; draft: FeeSetupDraft; base: FeeSetupDraft; editable: boolean; onPick: (name: string) => void }) {
  const n = Math.max(1, draft.installmentDates.length);
  const riders = Object.values(data.studentsByRoute).reduce((s, v) => s + v, 0);
  const baseBy = new Map(base.routeRows.map((r) => [r.routeName, r.annualFee]));
  return (
    <>
      <div className="fs-f" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <span className="fs-c">
          <b style={{ fontSize: 16 }}>Bus routes</b>
          <span className="fs-m">{draft.routeRows.filter((r) => r.annualFee > 0).length} routes · {riders} students on a bus · split over {n} installments</span>
        </span>
        {editable ? <Btn variant="soft" icon="plus" onClick={() => onPick("")}>Add a route</Btn> : null}
      </div>
      <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
        {draft.routeRows.map((r, i) => {
          const was = baseBy.get(r.routeName);
          const changed = was !== undefined && was !== r.annualFee;
          return (
            <button key={r.routeName} type="button" className="card tap lift rise" style={{ textAlign: "left", padding: 16, display: "flex", flexDirection: "column", gap: 8, color: "var(--fg)", animationDelay: `${Math.min(i, 12) * 25}ms` }} onClick={() => onPick(r.routeName)}>
              <span className="fs-f" style={{ gap: 10 }}>
                <span className="fs-ib" style={{ width: 34, height: 34 }}><Ic n="bus" size={17} /></span>
                <span className="fs-c" style={{ flex: 1 }}>
                  <b className="fs-e">{r.routeName}</b>
                  <span className="fs-m">{data.studentsByRoute[r.routeName] ?? 0} students</span>
                </span>
                {was === undefined ? <Pill tone="acc">New</Pill> : changed ? <Pill tone="acc">Edited</Pill> : null}
              </span>
              <span className="fs-f" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <span>
                  {changed ? <span className="fs-was">{rupees(was)}</span> : null}
                  <b className="num" style={{ fontSize: 20 }}>{rupees(r.annualFee)}</b> <span className="fs-m">a year</span>
                </span>
                <span className="fs-m">{rupees(Math.round(r.annualFee / n))} × {n}</span>
              </span>
            </button>
          );
        })}
      </div>
      <span className="fs-m">Stops, bus numbers and drivers are not kept in the fee system yet; only each route&apos;s yearly fee is.</span>
    </>
  );
}

function RouteSheet({ name, draft, base, students, editable, onClose, onSave }: { name: string; draft: FeeSetupDraft; base: FeeSetupDraft; students: number; editable: boolean; onClose: () => void; onSave: (name: string, fee: number) => void }) {
  const isNew = !name;
  const row = draft.routeRows.find((r) => r.routeName === name);
  const live = base.routeRows.find((r) => r.routeName === name)?.annualFee;
  const [title, setTitle] = useState(name);
  const [fee, setFee] = useState(row?.annualFee ?? 6000);
  const n = Math.max(1, draft.installmentDates.length);
  const clash = isNew && draft.routeRows.some((r) => r.routeName.toLowerCase() === title.trim().toLowerCase());
  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? "Add a route" : name}
      sub={isNew ? "A new bus route and its yearly fee" : `${students} students · bus fee split over ${n} installments`}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onClose}>{editable ? "Cancel" : "Close"}</button>
          {editable ? (
            <button type="button" className="tap btn pri" style={{ flex: 1.6, height: 48 }} disabled={(isNew && (title.trim().length < 2 || clash)) || fee === row?.annualFee} onClick={() => onSave(isNew ? title.trim() : name, fee)}>
              <Ic n="check" size={18} />Save to changes
            </button>
          ) : null}
        </>
      }
    >
      <div className="fs-c" style={{ gap: 14 }}>
        {isNew ? (
          <Field label="Route name" error={clash ? "A route with this name exists" : undefined}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Station road" disabled={!editable} />
          </Field>
        ) : null}
        <Field label="Fee per year" hint={`${rupees(Math.round(fee / n))} each installment${live !== undefined ? (live === fee ? " · same as live" : ` · live now ${rupees(live)}`) : ""}`}>
          <div className="fs-f">
            <Btn icon="minus" onClick={() => setFee((v) => Math.max(0, v - 500))} disabled={!editable} ariaLabel="Less" />
            <Input inputMode="numeric" lead="₹" value={String(fee)} onChange={(e) => setFee(Math.max(0, Math.round(Number(e.target.value.replace(/\D/g, "")) || 0)))} disabled={!editable} style={{ flex: 1 }} />
            <Btn icon="plus" onClick={() => setFee((v) => v + 500)} disabled={!editable} ariaLabel="More" />
          </div>
        </Field>
        {!isNew && live !== undefined && fee !== live ? (
          <div className="fs-info"><Ic n="users" size={16} /><span>{students} students · {fee > live ? "+" : "−"}{rupees(Math.abs(fee - live))} each a year</span></div>
        ) : null}
        <span className="fs-m">Stops, bus number and driver are not kept in the fee system yet.</span>
      </div>
    </Sheet>
  );
}

/* ---------- review & publish ---------- */

function parentMessage(changes: DraftChange[], session: string): string {
  const hi = changes.map((c) => `• ${c.title}: ${c.before} → ${c.after}`).join("\n");
  return `प्रिय अभिभावक, सत्र ${session} की शुल्क व्यवस्था में बदलाव:\n${hi}\nये बदलाव बाकी किस्तों पर लागू होंगे। — श्री वीर पत्ता सी. सै. स्कूल, आमेट\n\nDear parent, fee changes for ${session}:\n${hi}\nThey apply to the installments still to pay. — VPPS`;
}

const AREA_ICON: Record<DraftChange["area"], IconName> = { class: "layers", route: "bus", installment: "calendar", latefee: "clock", academic: "book", discount: "percent", head: "tag" };

function ReviewSheet({ onClose, draft, changes, data, editable, onDone }: { onClose: () => void; draft: FeeSetupDraft; changes: DraftChange[]; data: FeeSetupVxData; editable: boolean; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [state, setState] = useState<FeeSetupActionState>(INITIAL_FEE_SETUP_ACTION_STATE);
  const [tell, setTell] = useState(false);
  const preview = state.status === "preview" ? state.preview : null;
  const msg = parentMessage(changes, data.sessionLabel);
  const check = () =>
    start(async () => {
      const r = await publishFeeSetupAction(state, draftToFormData(draft, "preview", null));
      setState(r);
      if (r.status === "error") toast.show({ text: r.message ?? "Could not check the changes", tone: "bad" });
    });
  const publish = () =>
    start(async () => {
      const r = await publishFeeSetupAction(state, draftToFormData(draft, "apply", state.changeBatchId));
      setState(r);
      if (r.status === "success") {
        toast.show({ text: r.message ?? "Published", tone: "ok" });
        onDone();
        onClose();
        router.refresh();
      } else {
        toast.show({ text: r.message ?? "Could not publish", tone: "bad" });
      }
    });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg);
      toast.show({ text: "Copied · send it from Fee reminders or WhatsApp", tone: "ok" });
    } catch {
      toast.show({ text: "Could not copy on this device", tone: "bad" });
    }
  };
  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title="Review and publish"
      sub={`${changes.length} ${changes.length === 1 ? "change" : "changes"} · not live until you publish`}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onClose}>Keep editing</button>
          {preview ? (
            <button type="button" className="tap btn pri" style={{ flex: 2, height: 48 }} disabled={busy || !editable} onClick={publish}><Ic n="send" size={18} />{busy ? "Publishing…" : `Publish ${changes.length} ${changes.length === 1 ? "change" : "changes"}`}</button>
          ) : (
            <button type="button" className="tap btn pri" style={{ flex: 2, height: 48 }} disabled={busy || !editable || !changes.length} onClick={check}><Ic n="search" size={18} />{busy ? "Counting…" : "Check who is affected"}</button>
          )}
        </>
      }
    >
      <div className="fs-c" style={{ gap: 14 }}>
        {preview ? (
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
            <Kpi label="Students affected" value={String(preview.studentsAffected)} sub={`of ${preview.studentsInScope} in scope`} />
            <Kpi label="Change this session" value={`${preview.feeDeltaTotal >= 0 ? "+" : "−"}${rupeesShort(Math.abs(preview.feeDeltaTotal))}`} sub={preview.feeDeltaTotal >= 0 ? "more to collect" : "less to collect"} tone="var(--accfg)" />
            <Kpi label="Ending in credit" value={String(preview.studentsEndingInCredit)} sub={preview.creditTotal ? `${rupees(preview.creditTotal)} becomes refundable credit` : "nobody overpaid"} tone={preview.studentsEndingInCredit ? "var(--warnfg)" : undefined} />
          </div>
        ) : (
          <div className="fs-info"><Ic n="info" size={16} /><span>First the change is counted against every student — nothing changes yet. Then you publish.</span></div>
        )}
        {preview && (preview.blockedInstallments > 0 || preview.rowsMarkedForReview > 0) ? (
          <div className="fs-lock"><Ic n="alert" size={16} /><span>{preview.blockedInstallments} installment rows are held (an EMI plan, or a moved date on a paid row) and stay as they are.{preview.rowsMarkedForReview ? ` ${preview.rowsMarkedForReview} rows are marked for review.` : ""}</span></div>
        ) : null}
        {preview ? <span className="fs-m">{preview.installmentsToUpdate} installment rows repriced · {preview.installmentsToInsert} added · {preview.installmentsToCancel} cancelled</span> : null}
        <b className="fs-m" style={{ letterSpacing: ".06em", textTransform: "uppercase" }}>What changes</b>
        {!changes.length ? <EmptyState icon="edit" title="No changes yet" body="Edit a class fee, an installment date, a discount, the late fee or a bus route; each one collects here." /> : null}
        {changes.map((c) => (
          <div key={c.key} className="fs-f" style={{ alignItems: "flex-start", gap: 12, paddingBottom: 10, borderBottom: "1px solid var(--bd)" }}>
            <span className="fs-ib" style={{ width: 36, height: 36 }}><Ic n={AREA_ICON[c.area]} size={17} /></span>
            <span className="fs-c" style={{ gap: 4 }}>
              <b>{c.title}</b>
              <span className="fs-f" style={{ gap: 8 }}>
                <span className="fs-m" style={{ textDecoration: "line-through" }}>{c.before}</span>
                <Ic n="arrowRight" size={14} style={{ color: "var(--mut)" }} />
                <Pill tone="acc">{c.after}</Pill>
              </span>
              {c.area === "latefee" ? <span className="fs-m">Charged apart from fees</span> : null}
              {c.area === "class" ? <span className="fs-m">{data.studentsByClass[c.title.split(" · ")[0]] ?? 0} students</span> : null}
            </span>
          </div>
        ))}
        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="fs-f" style={{ justifyContent: "space-between" }}>
            <span className="fs-f" style={{ gap: 10 }}>
              <span className="fs-ib" style={{ width: 34, height: 34 }}><Ic n="message" size={17} /></span>
              <span className="fs-c">
                <b>Tell parents</b>
                <span className="fs-m">A message to copy · nothing is sent from here</span>
              </span>
            </span>
            <Switch on={tell} onChange={setTell} label="Show the parent message" />
          </div>
          {tell ? (
            <>
              <div className="fs-wa"><div>{msg}</div></div>
              <Btn icon="copy" onClick={copy}>Copy message</Btn>
            </>
          ) : null}
        </Card>
      </div>
    </Sheet>
  );
}

/* ---------- history & ask ---------- */

function HistorySheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: FeeSetupVxData }) {
  const tone = (s: string) => (s === "applied" ? "ok" : s === "failed" || s === "rejected" ? "bad" : "mut") as "ok" | "bad" | "mut";
  return (
    <Sheet open={open} onClose={onClose} title="Version history" sub="Every publish, newest first · each one is kept">
      <div className="fs-c" style={{ gap: 10 }}>
        {data.history.map((h, i) => (
          <Card key={h.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="fs-f" style={{ justifyContent: "space-between" }}>
              <b>{i === 0 && h.status === "applied" ? "Live · " : ""}{h.targetLabel || h.scopeLabel}</b>
              <Pill tone={tone(h.status)}>{h.statusLabel}</Pill>
            </div>
            <span className="fs-m">{shortDay(h.appliedAt ?? h.createdAt)} · {h.createdByName ?? "Someone"} · {ago(h.appliedAt ?? h.createdAt)}</span>
            {h.changedFieldLabels.length ? <span style={{ fontSize: 13 }}>{h.changedFieldLabels.slice(0, 6).join(", ")}{h.changedFieldLabels.length > 6 ? ` +${h.changedFieldLabels.length - 6}` : ""}</span> : null}
            {h.summary ? <span className="fs-m">{h.summary.studentsAffected} students · {h.summary.installmentsToUpdate} rows repriced{h.summary.blockedInstallments ? ` · ${h.summary.blockedInstallments} held` : ""}</span> : null}
          </Card>
        ))}
        {!data.history.length ? <EmptyState icon="history" title="No published changes yet" /> : null}
        <span className="fs-m">To go back to an earlier version, set those values again and publish; the history keeps both.</span>
      </div>
    </Sheet>
  );
}

function AskSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
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
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ask admin to change"
      sub="The admin sees it in Requests"
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1, height: 48 }} onClick={onClose}>Cancel</button>
          <button type="button" className="tap btn pri" style={{ flex: 1.6, height: 48 }} disabled={busy || what.trim().length < 3 || why.trim().length < 3} onClick={send}><Ic n="send" size={18} />Send request</button>
        </>
      }
    >
      <div className="fs-c" style={{ gap: 14 }}>
        <Field label="Which fee"><Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="For example: Class 7 tuition, or a route fee" /></Field>
        <Field label="What and why"><Textarea value={why} onChange={(e) => setWhy(e.target.value)} placeholder="For example: parents of the new route were told ₹5,500" style={{ minHeight: 90 }} /></Field>
      </div>
    </Sheet>
  );
}
