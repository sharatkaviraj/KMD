"use client";

import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { activatePlanAction, logCallAction, previewPlanAction, queueFamilyReminderAction, undoPlanAction, type PlanPreview } from "@/app/(app)/dues/actions";
import { CALL_OUTCOMES, type CallOutcome, type DuesFamily } from "@/modules/defaulters/vx/domain/families";
import { addDays } from "@/modules/receipts/vx/domain/day-close";
import { renderMessage } from "@/modules/whatsapp/vx/domain/reminders";
import { shownSr } from "@/vx/domain/tell-apart";
import { dateLabel, dayMonth, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { Chip, Field, Seg, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";

import { Choice, Inset } from "./bits";
import { duesHref, kidLink } from "./href";
import { contactTone, day, dayTone, firstName, ini, kidsShort, maskPhone, telHref, TONES } from "./look";
import type { DuesProps, DuesSheet, KidInstallment } from "./types";
import { CHANNEL_WORD, fill, instList, LOG_OUTCOME_WORD, OUTCOME_SUB, OUTCOME_WORD, W } from "./words";

type Props = DuesProps & {
  family: DuesFamily;
  /** The next family on the call list, offered after a call is logged (accountant B3). */
  nextHref?: string | null;
};

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** The WhatsApp chat as the design draws it: Hindi, a rule, English, and the pay link. */
function WaChat({ hi, en, link }: { hi: string; en: string; link?: string }) {
  const bubble: CSSProperties = { maxWidth: "94%", padding: "9px 11px 6px", borderRadius: "4px 14px 14px 14px", background: "var(--wab)", color: "var(--wafg)", boxShadow: "0 1px 1px rgba(0,0,0,.12)", display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, lineHeight: 1.5, animation: "xIn .35s var(--ease) both" };
  return (
    <div style={{ borderRadius: 16, background: "var(--wabg)", padding: "14px 12px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <div style={bubble}>
        <p lang="hi" style={{ margin: 0, whiteSpace: "pre-line" }}>{hi}</p>
        <hr style={{ width: "100%", margin: 0, border: 0, borderTop: "1px solid currentColor", opacity: 0.15 }} />
        <p style={{ margin: 0, whiteSpace: "pre-line" }}>{en}</p>
        <small style={{ alignSelf: "flex-end", fontSize: 11, opacity: 0.6 }}>now</small>
      </div>
      {link ? (
        <span style={{ ...bubble, flexDirection: "row", justifyContent: "center", alignItems: "center", width: "94%", borderRadius: 10, padding: 9, color: "var(--info)", fontWeight: 600 }}>
          <Ic n="link" size={15} />
          {link}
        </span>
      ) : null}
    </div>
  );
}

/** One installment as a tile: paid green, pending amber, not due grey, last session red. */
function InstTile({ i, tx }: { i: KidInstallment; tx: (p: { en: string; hi?: string }) => string }) {
  const label = i.carry ? tx(W.lastSession) : `Inst ${i.no}`;
  const paid = i.pending <= 0;
  const overdue = i.status === "overdue";
  const look = i.carry && !paid
    ? { bg: "var(--bads)", fg: "var(--bad)", icon: "alert" as const, text: tx(W.lastSession), sub: tx(fill(W.amtPending, { amt: rupees(i.pending) })) }
    : paid
      ? { bg: "var(--oks)", fg: "var(--ok)", icon: "check" as const, text: tx(fill(W.instPaid, { label })), sub: i.amount ? rupees(i.amount) : dayMonth(i.dueDate) }
      : overdue
        ? { bg: "var(--warns)", fg: "var(--warnfg)", icon: "alert" as const, text: tx(fill(W.instPending, { label })), sub: rupees(i.pending) }
        : { bg: "var(--s2)", fg: "var(--mut)", icon: "clock" as const, text: tx(fill(W.instNotDue, { label })), sub: `${rupees(i.pending || i.amount || 0)} · ${dayMonth(i.dueDate)}` };
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 11, background: look.bg, color: look.fg, minWidth: 0 }}>
      <Ic n={look.icon} size={15} />
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{look.text}</span>
        <span className="num clip" style={{ fontSize: 11 }}>{look.sub}</span>
      </span>
    </span>
  );
}

export function FamilyPanel(props: Props) {
  const { family: f, tab, today, sessionLabel, perms, detail } = props;
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<DuesSheet | null>(props.sheet === "wo" ? null : props.sheet);
  const [calling, setCalling] = useState(Boolean(props.dialing));
  const kidIds = f.kids.map((k) => k.studentId);
  const back = duesHref(tab);
  const phone = maskPhone(f.phone);

  // ----- call / promise -----
  const [outcome, setOutcome] = useState<CallOutcome | null>(props.sheet === "promise" ? "promised" : null);
  const days = useMemo(() => [1, 2, 4, 7].map((n) => addDays(today, n)), [today]);
  const [promiseDay, setPromiseDay] = useState(days[1]);
  const [amount, setAmount] = useState(f.pendingToday);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function openCall(preset: CallOutcome | null, dialing = false) {
    setOutcome(preset);
    setError(null);
    setCalling(dialing);
    setSheet(preset === "promised" ? "promise" : "call");
  }

  const nextText =
    outcome === "promised"
      ? tx(fill(W.nextPromised, { d: day(promiseDay) }))
      : outcome === "visit"
        ? tx(fill(W.nextVisit, { d: day(promiseDay) }))
        : outcome === "noreach"
          ? tx(W.nextNoReach)
          : outcome === "wrong"
            ? tx(fill(W.nextWrong, { c: f.kids[0]?.classLabel ?? "" }))
            : outcome === "time"
              ? tx(fill(W.nextTime, { d: day(addDays(today, 7)) }))
              : tx(W.nextNone);

  function saveCall() {
    if (!outcome) return;
    setError(null);
    start(async () => {
      const res = await logCallAction({ studentIds: kidIds, sessionLabel, outcome, promisedOn: promiseDay, amount, note, phone: f.phone });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSheet(null);
      setNote("");
      // logCallAction revalidates /dues, so its answer already carries the
      // fresh list; a router.refresh() here rendered the whole page a second
      // time on every call (accountant B3).
      const next = props.nextHref;
      toast.show({ text: tx(W.logged), action: next ? { label: tx(W.nextFamily), onClick: () => router.push(next) } : undefined, ms: next ? 8000 : undefined });
    });
  }

  // ----- WhatsApp: preview and queue only -----
  const first = f.kids[0];
  const dueDate = addDays(today, -Math.max(0, f.days));
  const message = renderMessage("gentle", "both", {
    hi: { parent: f.fatherName, student: first?.fullName.split(" ")[0] ?? "", amount: rupees(f.pendingToday), "due date": dateLabel(dueDate) },
    en: { parent: f.fatherName, student: first?.fullName.split(" ")[0] ?? "", amount: rupees(f.pendingToday), "due date": dateLabel(dueDate) },
  });
  function queueWa() {
    setError(null);
    start(async () => {
      const res = await queueFamilyReminderAction({ studentIds: kidIds, sessionLabel, familyName: f.fatherName, template: "gentle", amount: f.pendingToday });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSheet(null);
      toast.show({ text: tx(W.waQueued), tone: "info" });
    });
  }

  // ----- EMI plan -----
  const [planKid, setPlanKid] = useState(first?.studentId ?? "");
  const [parts, setParts] = useState(4);
  const firstDays = useMemo(() => [addDays(today, 2), addDays(today, 7), addDays(today, 12), addDays(today, 25)], [today]);
  const [planFirst, setPlanFirst] = useState(firstDays[0]);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [planDone, setPlanDone] = useState<{ planId: string | null } | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);
  const kid = f.kids.find((k) => k.studentId === planKid) ?? first;
  const scope = kid?.overdueInstallments?.includes(0) ? "old_and_current" : "current_year_only";

  useEffect(() => {
    if (sheet !== "plan" || !kid || planDone) return;
    let live = true;
    previewPlanAction({ studentId: kid.studentId, sessionLabel, scope, parts, firstDueDate: planFirst }).then((res) => {
      if (live) setPreview(res);
    });
    return () => {
      live = false;
    };
  }, [sheet, kid, sessionLabel, scope, parts, planFirst, planDone]);

  function savePlan() {
    if (!kid) return;
    setError(null);
    start(async () => {
      const res = await activatePlanAction({ studentId: kid.studentId, sessionLabel, scope, parts, firstDueDate: planFirst, reason, clientRequestId: requestId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlanDone({ planId: res.planId });
      router.refresh();
    });
  }

  function undoPlan() {
    if (!planDone?.planId || !kid) return;
    start(async () => {
      const res = await undoPlanAction({ planId: planDone.planId as string, studentId: kid.studentId, sessionLabel });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlanDone(null);
      setRequestId(newRequestId());
      setSheet(null);
      toast.show({ text: tx(W.planUndone), tone: "info" });
      router.refresh();
    });
  }

  const contacts = detail?.contacts ?? [];
  const nameOf = (id: string) => f.kids.find((k) => k.studentId === id)?.fullName.split(" ")[0] ?? "";
  const planReady = preview?.ok === true && preview.canActivate && perms.plan && perms.planEnabled;
  const notDue = [...new Set(Object.values(detail?.installments ?? {}).flat().filter((i) => i.status !== "overdue" && i.pending > 0 && !i.carry).map((i) => i.no))];
  const tone = dayTone(f.days);
  const promise = props.promises.find((pv) => pv.familyKey === f.key && (pv.state === "due" || pv.state === "upcoming"));
  const tile: CSSProperties = { height: 64, borderRadius: 14, flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, padding: "0 4px" };
  const money: { label: string; value: string; sub: string; bg: string; fg: string; vc: string }[] = [
    { label: tx(W.pendingToday), value: rupees(f.pendingToday), sub: tx(instList(f.overdueInstallments)), bg: "var(--warns)", fg: "var(--warnfg)", vc: "var(--fg)" },
    { label: tx(W.notDueYet), value: rupees(f.notDueYet), sub: notDue.length ? tx(instList(notDue)) : "", bg: "var(--s2)", fg: "var(--mut)", vc: "var(--fg)" },
    { label: tx(W.lateFee), value: rupees(f.lateFee), sub: tx(W.keptSeparate), bg: "var(--s2)", fg: "var(--mut)", vc: "var(--mut)" },
  ];
  const callSub = `${phone} · ${tx(W.pendingToday).toLowerCase()} ${rupees(f.pendingToday)} · ${kidsShort(f)}`;
  const isPromise = outcome === "promised" || outcome === "visit";
  const half = Math.round(f.pendingToday / 2 / 10) * 10;
  const schedule = preview?.ok ? preview.schedule : [];

  return (
    <div style={{ padding: "18px 20px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden="true" style={{ flex: "none", width: 48, height: 48, borderRadius: 16, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700 }}>{ini(f.fatherName)}</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <h2 className="serif clip" style={{ margin: 0, fontSize: 21, fontWeight: 600, lineHeight: 1.2 }}>{f.fatherName}</h2>
          <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{phone} · {f.kids.length === 1 ? tx(W.oneChild) : tx(fill(W.nChildren, { n: f.kids.length }))}</span>
        </span>
        <span className="only-d">
          <Btn variant="ghost" icon="x" href={back} ariaLabel={tx(W.close)} style={{ width: 36, height: 36, padding: 0 }} />
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {promise ? <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--infos)", color: "var(--info)", animation: "xPopIn .4s var(--spring) both" }}>{tx(fill(W.promisedPill, { amt: rupees(promise.amount), date: day(promise.promisedOn) }))}</span> : null}
        <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: tone.bg, color: tone.fg, animation: "xPopIn .4s var(--spring) both" }}>{tx(fill(W.oldestDue, { n: f.days }))}</span>
      </div>

      <div className="card" style={{ padding: 6, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
        {money.map((m) => (
          <div key={m.label} style={{ display: "flex", flexDirection: "column", gap: 1, padding: "10px 10px 9px", borderRadius: 13, background: m.bg, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: m.fg }}>{m.label}</span>
            <span className="num" style={{ fontSize: 17, fontWeight: 700, color: m.vc }}>{m.value}</span>
            <span className="clip" style={{ fontSize: 11, color: "var(--mut)" }}>{m.sub}</span>
          </div>
        ))}
      </div>
      <span style={{ fontSize: 12, color: "var(--mut)", marginTop: -6 }}>{tx(W.threeApart)}</span>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {f.phone ? (
          <a href={telHref(f.phone)} onClick={() => openCall(null, true)} className="tap btn pri" style={tile}>
            <Ic n="phone" />
            {tx(W.call)}
          </a>
        ) : (
          <Btn variant="pri" icon="phone" disabled style={tile}>{tx(W.call)}</Btn>
        )}
        <Btn variant="sec" icon="message" onClick={() => setSheet("wa")} disabled={!perms.log} style={tile}>{tx(W.whatsapp)}</Btn>
        <Btn variant="sec" icon="edit" onClick={() => openCall(null)} disabled={!perms.log} style={tile}>{tx(W.logCall)}</Btn>
        <Btn variant="sec" icon="calCheck" onClick={() => openCall("promised")} disabled={!perms.log} style={tile}>{tx(W.promise)}</Btn>
        <Btn variant="sec" icon="layers" onClick={() => setSheet("plan")} style={tile}>{tx(W.emiPlan)}</Btn>
        {perms.collect && first ? <Btn variant="sec" icon="rupee" href={`/payments?student=${first.studentId}`} style={tile}>{tx(W.collectFee)}</Btn> : null}
      </div>

      {f.kids.map((k, i) => {
        const inst = (detail?.installments[k.studentId] ?? []).slice().sort((a, b) => (a.carry === b.carry ? a.no - b.no : a.carry ? -1 : 1));
        const meta = detail?.meta?.[k.studentId];
        const t = TONES[(i + 1) % TONES.length];
        const sr = shownSr(meta?.admissionNo);
        const link = kidLink(k.studentId, perms);
        const metaLine = [k.classLabel, sr ? `SR ${sr}` : null,meta?.route ? tx(fill(W.route, { r: meta.route })) : k.transportRouteId ? tx(W.usesBus) : null].filter(Boolean).join(" · ");
        return (
          <div key={k.studentId} className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 18, background: t[0], color: t[1], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{ini(k.fullName)}</span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{k.fullName}</span>
                <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{metaLine}</span>
              </span>
              {link ? (
                <>
                  <Link href={link.href} className="tap btn ghost only-d" style={{ height: 34, padding: "0 8px", fontSize: 13 }}>
                    {tx(link.to === "student" ? W.openStudent : W.openOnDesk)}
                    <Ic n="chevRight" size={15} />
                  </Link>
                  <Link href={link.href} className="tap btn ghost only-m" style={{ padding: "0 8px", fontSize: 13 }}>
                    {tx(W.open)}
                    <Ic n="chevRight" size={15} />
                  </Link>
                </>
              ) : null}
            </div>
            {inst.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                {inst.map((x) => (
                  <InstTile key={`${x.no}-${x.dueDate}-${x.carry}`} i={x} tx={tx} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column" }}>
        <h3 className="sech" style={{ marginBottom: 8 }}>{tx(W.history)}</h3>
        {contacts.length === 0 ? (
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.noHistory)}</span>
        ) : (
          contacts.map((c, i) => {
            const words = [c.channel ? tx(CHANNEL_WORD[c.channel] ?? CHANNEL_WORD.call) : null, c.outcome && c.outcome !== "other" ? tx(LOG_OUTCOME_WORD[c.outcome] ?? LOG_OUTCOME_WORD.other) : null, c.note ? `“${c.note}”` : null].filter(Boolean);
            return (
              <div key={`${c.at}-${c.studentId}-${i}`} style={{ display: "grid", gridTemplateColumns: "14px minmax(0, 1fr)", gap: 10, padding: "6px 0", animation: `xIn .3s var(--ease) ${i * 60}ms both` }}>
                <span style={{ width: 10, height: 10, marginTop: 4, borderRadius: 5, background: contactTone(c.outcome, c.channel) }} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{words.join(" · ")}</span>
                  <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{day(c.at)}{f.kids.length > 1 ? ` · ${nameOf(c.studentId)}` : ""}</span>
                </span>
              </div>
            );
          })
        )}
      </div>
      <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.5 }}>{tx(W.historyNote)}</span>

      {/* Log call / promise */}
      <Sheet
        open={sheet === "call" || sheet === "promise"}
        onClose={() => setSheet(null)}
        title={tx(fill(W.logCallTitle, { name: f.fatherName }))}
        sub={callSub}
        footer={
          <>
            <Btn variant="sec" onClick={() => setSheet(null)} style={{ flex: 1 }}>{tx(W.cancel)}</Btn>
            <Btn variant="pri" icon="check" disabled={!outcome || busy || (outcome === "promised" && !(amount > 0))} onClick={saveCall} style={{ flex: 1.6 }}>{tx(W.saveCall)}</Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
          {calling ? (
            <div className="fadein" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: "var(--oks)", color: "var(--ok)", fontSize: 13, fontWeight: 600 }}>
              <span style={{ flex: "none", width: 10, height: 10, borderRadius: 5, background: "var(--ok)", animation: "xPulse 1.6s ease infinite" }} />
              <span className="num" style={{ flex: 1 }}>{tx(fill(W.calling, { ph: phone }))}</span>
              <span className="only-d" style={{ fontWeight: 500 }}>{tx(W.hangUp)}</span>
            </div>
          ) : null}
          <h3 className="sech">{tx(W.whatHappened)}</h3>
          <div role="radiogroup" aria-label={tx(W.whatHappened)} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
            {CALL_OUTCOMES.map((o) => (
              <Choice key={o} on={outcome === o} onPick={() => setOutcome(o)} label={tx(OUTCOME_WORD[o])} sub={tx(OUTCOME_SUB[o])} />
            ))}
          </div>
          {isPromise ? (
            <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h3 className="sech" style={{ marginTop: 4 }}>{tx(outcome === "visit" ? W.whenCome : W.whenPay)}</h3>
              <div className="hs" role="group" style={{ display: "flex", gap: 6 }}>
                {days.map((d, i) => (
                  <Chip key={d} icon="calendar" on={promiseDay === d} onClick={() => setPromiseDay(d)}>{i === 0 ? tx(fill(W.tomorrowDay, { d: day(d) })) : day(d)}</Chip>
                ))}
              </div>
            </div>
          ) : null}
          {outcome === "promised" ? (
            <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h3 className="sech" style={{ marginTop: 4 }}>{tx(W.howMuch)}</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="sec" icon="minus" ariaLabel={tx(W.less500)} onClick={() => setAmount((a) => Math.max(500, a - 500))} style={{ width: 44, height: 44, padding: 0 }} />
                <input
                  className="num"
                  inputMode="numeric"
                  aria-label={tx(W.amount)}
                  value={rupees(amount)}
                  onChange={(e) => setAmount(Math.min(f.pendingToday, Number(e.target.value.replace(/[^\d]/g, "")) || 0))}
                  style={{ width: 112, minWidth: 112, textAlign: "center", fontSize: 24, fontWeight: 700, border: 0, background: "transparent", outline: "none", color: "var(--fg)" }}
                />
                <Btn variant="sec" icon="plus" ariaLabel={tx(W.more500)} onClick={() => setAmount((a) => Math.min(f.pendingToday, a + 500))} style={{ width: 44, height: 44, padding: 0 }} />
                <span style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                  <Chip on={amount === f.pendingToday} onClick={() => setAmount(f.pendingToday)}>{tx(W.full)} {rupees(f.pendingToday)}</Chip>
                  <Chip on={amount === half} onClick={() => setAmount(half)}>{tx(W.half)} {rupees(half)}</Chip>
                </span>
              </div>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(fill(W.amtHint, { p: rupees(f.pendingToday), l: rupees(f.lateFee) }))}</span>
            </div>
          ) : null}
          <Field label={tx(W.note)} style={{ marginTop: 4 }}>
            <Textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={tx(W.notePh)} style={{ minHeight: 64 }} />
          </Field>
          <Inset icon="calendar" bg="var(--accs)" fg="var(--accfg)">
            <b>{tx(W.nextLabel)}</b> {nextText}
          </Inset>
          {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
        </div>
      </Sheet>

      {/* WhatsApp: preview and queue only */}
      <Sheet
        open={sheet === "wa"}
        onClose={() => setSheet(null)}
        title={tx(W.waTitle)}
        sub={tx(fill(W.waTo, { name: f.fatherName, ph: phone }))}
        footer={
          <>
            <Btn variant="sec" onClick={() => setSheet(null)} style={{ flex: 1 }}>{tx(W.cancel)}</Btn>
            <Btn variant="pri" icon="send" disabled={busy} onClick={queueWa} style={{ flex: 1.6 }}>{tx(W.waQueue)}</Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
          <WaChat hi={message.hi ?? ""} en={message.en ?? ""} link="फीस जमा करें · Pay fee" />
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--mut)" }}>
            <Ic n="info" size={16} />
            {tx(W.waFooter)}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--mut)" }}>
            <Ic n="clock" size={16} />
            {tx(W.waNote)}
          </span>
          {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
        </div>
      </Sheet>

      {/* EMI plan */}
      <Sheet
        open={sheet === "plan"}
        onClose={() => setSheet(null)}
        wide
        title={tx(fill(W.planTitleName, { name: f.fatherName }))}
        sub={`${kidsShort(f)} · ${phone}`}
        footer={
          planDone ? undefined : (
            <>
              <Btn variant="sec" onClick={() => setSheet(null)} style={{ flex: 1 }}>{tx(W.cancel)}</Btn>
              <Btn variant="pri" icon="check" disabled={!planReady || busy} onClick={savePlan} style={{ flex: 1.6 }}>{tx(W.savePlan2)}</Btn>
            </>
          )
        }
      >
        {planDone && preview?.ok ? (
          <div className="fadein" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: "4px 0 8px" }}>
            <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" style={{ flex: "none", animation: "xPopIn .5s var(--spring) both" }}>
              <circle cx="48" cy="48" r="44" style={{ fill: "var(--oks)" }} />
              <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: "276.5", strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
              <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: "60", strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
            </svg>
            <h3 className="serif" style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>{tx(W.planSaved)}</h3>
            <span style={{ fontSize: 14, color: "var(--mut)", maxWidth: 460, lineHeight: 1.6 }}>
              {tx(fill(W.planDoneLine, { name: kid ? firstName(kid.fullName) : f.fatherName, total: rupees(preview.openingBalance), n: preview.schedule.length, per: rupees(preview.monthlyAmount), first: day(preview.schedule[0]?.dueDate ?? planFirst) }))}
              {preview.lateFeeWaived > 0 ? ` ${tx(W.waiveLate)} · ${rupees(preview.lateFeeWaived)}.` : ""}
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 6 }}>
              <Btn variant="pri" onClick={() => setSheet(null)}>{tx(W.done)}</Btn>
              <Btn variant="ghost" icon="undo" disabled={busy || !planDone.planId} onClick={undoPlan} style={{ color: "var(--bad)" }}>{tx(W.undoPlan)}</Btn>
            </div>
            {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, alignItems: "start", paddingTop: 4 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)" }}>
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{tx(W.pendingToday)}</span>
                  <span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{rupees(preview?.ok ? preview.openingBalance : (kid?.overdueAmount ?? f.pendingToday))}</span>
                </span>
                <span className="num" style={{ fontSize: 12, textAlign: "right" }}>
                  {tx(fill(W.lateShown, { amt: rupees(kid?.lateFee ?? f.lateFee) }))}
                  <br />
                  {tx(W.shownApart)}
                </span>
              </div>
              {!perms.planEnabled ? <Banner tone="warn">{tx(W.planOff)}</Banner> : !perms.plan ? <Banner tone="info">{tx(W.planAdminOnly)}</Banner> : null}
              {f.kids.length > 1 ? (
                <div className="hs" role="group" aria-label={tx(W.child)} style={{ display: "flex", gap: 6 }}>
                  {f.kids.map((k) => (
                    <Chip key={k.studentId} on={planKid === k.studentId} onClick={() => setPlanKid(k.studentId)}>{firstName(k.fullName)}</Chip>
                  ))}
                </div>
              ) : null}
              <h3 className="sech" style={{ marginTop: 4 }}>{tx(W.splitInto)}</h3>
              <Seg<string> label={tx(W.splitInto)} value={String(parts)} onChange={(v) => setParts(Number(v))} options={[2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: tx(fill(W.nParts, { n })) }))} />
              <h3 className="sech" style={{ marginTop: 4 }}>{tx(W.firstPart)}</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {firstDays.map((d) => (
                  <Chip key={d} on={planFirst === d} onClick={() => setPlanFirst(d)}>{day(d)}</Chip>
                ))}
              </div>
              {preview?.ok && preview.lateFeeWaived > 0 ? (
                <Inset icon="check" bg="var(--oks)" fg="var(--ok)">
                  {tx(W.waiveLate)} · <span className="num">{rupees(preview.lateFeeWaived)}</span>
                </Inset>
              ) : null}
              {preview?.ok ? (
                <span style={{ fontSize: 12, color: "var(--mut)" }}>
                  {tx(W.planCovers)}: {preview.covers.join(", ")} · {rupees(preview.openingBalance)}
                </span>
              ) : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <h3 className="sech">{tx(W.schedule)}</h3>
              {!preview ? (
                <span style={{ color: "var(--mut)" }}>{tx(W.loading)}</span>
              ) : !preview.ok ? (
                <Banner tone="warn">{preview.error}</Banner>
              ) : (
                <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 3, height: 10, marginBottom: 6 }}>
                    {schedule.map((x, i) => (
                      <span key={`${x.dueDate}-bar-${i}`} style={{ flex: x.amount, borderRadius: 5, background: i % 2 ? "var(--c2)" : "var(--c1)", transformOrigin: "left", animation: `xGrowX .5s var(--ease) ${i * 50}ms both` }} />
                    ))}
                  </div>
                  {schedule.map((x, i) => (
                    <div key={`${x.dueDate}-${i}`} style={{ display: "grid", gridTemplateColumns: "62px minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "5px 0", borderTop: i ? "1px solid var(--bd)" : 0, animation: `xIn .3s var(--ease) ${i * 50}ms both` }}>
                      <span className="pill" style={{ justifyContent: "center", background: "var(--s2)", color: "var(--mut)" }}>{tx(fill(W.partN, { n: i + 1 }))}</span>
                      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>{day(x.dueDate)}</span>
                        <span style={{ fontSize: 11, color: "var(--sub)" }}>{tx(i ? W.sameDate : W.firstPartNote)}</span>
                      </span>
                      <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{rupees(x.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {preview?.ok && preview.hasActivePlan ? <Banner tone="warn">{tx(W.planActive)}</Banner> : null}
              {preview?.ok ? preview.errors.map((e) => <Banner key={e} tone="warn">{e}</Banner>) : null}
              {preview?.ok ? (
                <Field label={tx(W.reason)}>
                  <input className="inp" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
                </Field>
              ) : null}
              {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
