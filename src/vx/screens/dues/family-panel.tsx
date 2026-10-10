"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { activatePlanAction, logCallAction, previewPlanAction, queueFamilyReminderAction, undoPlanAction, type PlanPreview } from "@/app/(app)/dues/actions";
import { CALL_OUTCOMES, type CallOutcome, type DuesFamily } from "@/modules/defaulters/vx/domain/families";
import { addDays } from "@/modules/receipts/vx/domain/day-close";
import { renderMessage } from "@/modules/whatsapp/vx/domain/reminders";
import { agoP, dateLabel, dayMonth, initials, rupees, shortDay } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Chip, ChipRow, DateChips, Field, Input, RadioCard, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Avatar, avatarColor, Btn, Card, Pill, SecHead, Stat, SuccessTick, WhatsAppPreview } from "@/vx/ui/primitives";

import { duesHref } from "./href";
import type { DuesProps, DuesSheet } from "./types";
import { CHANNEL_WORD, LOG_OUTCOME_WORD, OUTCOME_WORD, W } from "./words";

type Props = DuesProps & { family: DuesFamily };

function dayChoices(today: string, tx: (p: { en: string; hi?: string }) => string) {
  return [
    { value: today, label: tx(W.pToday) },
    { value: addDays(today, 1), label: tx(W.tomorrow) },
    { value: addDays(today, 3), label: tx(W.in3), sub: ` · ${dayMonth(addDays(today, 3))}` },
    { value: addDays(today, 7), label: tx(W.in7), sub: ` · ${dayMonth(addDays(today, 7))}` },
  ];
}

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function FamilyPanel(props: Props) {
  const { family: f, tab, today, sessionLabel, perms, detail } = props;
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<DuesSheet | null>(props.sheet === "wo" ? null : props.sheet);
  const kidIds = f.kids.map((k) => k.studentId);
  const back = duesHref(tab);

  // ----- call / promise -----
  const [outcome, setOutcome] = useState<CallOutcome | null>(props.sheet === "promise" ? "promised" : null);
  const [day, setDay] = useState(addDays(today, 1));
  const [amount, setAmount] = useState(f.pendingToday);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function openCall(preset: CallOutcome | null) {
    setOutcome(preset);
    setError(null);
    setSheet(preset === "promised" ? "promise" : "call");
  }

  const nextFollowUp =
    outcome === "promised" || outcome === "visit"
      ? shortDay(day)
      : outcome === "noreach"
        ? shortDay(addDays(today, 1))
        : outcome === "time"
          ? shortDay(addDays(today, 7))
          : outcome === "wrong"
            ? tx(W.fixNumber)
            : "—";

  function saveCall() {
    if (!outcome) return;
    setError(null);
    start(async () => {
      const res = await logCallAction({ studentIds: kidIds, sessionLabel, outcome, promisedOn: day, amount, note, phone: f.phone });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSheet(null);
      setNote("");
      toast.show({ text: tx(W.logged) });
      router.refresh();
    });
  }

  // ----- WhatsApp -----
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
  const [parts, setParts] = useState(3);
  const firstDays = useMemo(
    () => [addDays(today, 7), addDays(today, 15), addDays(today, 30)].map((d) => ({ value: d, label: dayMonth(d) })),
    [today],
  );
  const [planFirst, setPlanFirst] = useState(firstDays[1].value);
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

  return (
    <div style={{ padding: "18px 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar text={initials(f.fatherName)} bg={avatarColor(f.fatherName)} size={46} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <strong className="clip" style={{ fontSize: 17 }}>{f.fatherName}</strong>
          <span className="clip num" style={{ fontSize: 13, color: "var(--mut)" }}>{f.phone ?? "—"} · {f.days} {tx(W.days)}</span>
        </span>
        <Btn variant="ghost" icon="x" href={back} ariaLabel={tx(W.close)} style={{ width: 40, padding: 0 }} />
      </div>

      <Card style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
        <Stat label={tx(W.pendingToday)} value={rupees(f.pendingToday)} tone="var(--bad)" />
        <Stat label={tx(W.notDueYet)} value={rupees(f.notDueYet)} />
        <Stat label={tx(W.lateFee)} value={rupees(f.lateFee)} sub={tx(W.keptSeparate)} />
      </Card>
      <span style={{ fontSize: 12, color: "var(--mut)", marginTop: -6 }}>{tx(W.threeApart)}</span>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
        <Btn variant="pri" icon="phone" href={f.phone ? `tel:${f.phone.replace(/[^\d+]/g, "")}` : undefined} disabled={!f.phone}>{tx(W.call)}</Btn>
        <Btn variant="sec" icon="message" onClick={() => setSheet("wa")} disabled={!perms.log}>{tx(W.whatsapp)}</Btn>
        <Btn variant="sec" icon="edit" onClick={() => openCall(null)} disabled={!perms.log}>{tx(W.logCall)}</Btn>
        <Btn variant="sec" icon="flag" onClick={() => openCall("promised")} disabled={!perms.log}>{tx(W.promise)}</Btn>
        <Btn variant="sec" icon="calendar" onClick={() => setSheet("plan")}>{tx(W.emiPlan)}</Btn>
        {perms.collect && first ? <Btn variant="soft" icon="rupee" href={`/payments?student=${first.studentId}`}>{tx(W.collectFee)}</Btn> : null}
      </div>

      {f.kids.map((k) => {
        const inst = detail?.installments[k.studentId] ?? [];
        return (
          <Card key={k.studentId} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <strong className="clip">{k.fullName}</strong>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{k.classLabel}{k.transportRouteId ? ` · ${tx(W.usesBus)}` : ""}</span>
              </span>
              <span style={{ fontWeight: 700 }} className="num">{rupees(k.overdueAmount)}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(92px,1fr))", gap: 6 }}>
              {inst.map((i) => {
                const paid = i.pending <= 0;
                const overdue = i.status === "overdue";
                return (
                  <div key={`${i.no}-${i.dueDate}`} style={{ borderRadius: 12, padding: "8px 10px", background: paid ? "var(--oks)" : overdue ? "var(--bads)" : "var(--s2)", display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--mut)" }}>{i.label}</span>
                    <span className="num" style={{ fontWeight: 700, color: paid ? "var(--ok)" : overdue ? "var(--bad)" : undefined }}>{paid ? tx(W.paid) : rupees(i.pending)}</span>
                    <span style={{ fontSize: 11, color: "var(--mut)" }}>
                      {paid ? dayMonth(i.dueDate) : overdue ? dayMonth(i.dueDate) : `${tx(W.notDue)} · ${dayMonth(i.dueDate)}`}
                      {i.lateFee > 0 ? ` · +${rupees(i.lateFee)}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <SecHead>{tx(W.history)}</SecHead>
        <Card pad={false}>
          {contacts.length === 0 ? (
            <span style={{ display: "block", padding: 14, color: "var(--mut)" }}>{tx(W.noHistory)}</span>
          ) : (
            contacts.map((c, i) => (
              <div key={`${c.at}-${c.studentId}-${i}`} style={{ display: "flex", gap: 10, padding: "10px 14px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 600 }}>
                    {c.channel ? tx(CHANNEL_WORD[c.channel] ?? CHANNEL_WORD.call) : ""} · {c.outcome ? tx(LOG_OUTCOME_WORD[c.outcome] ?? LOG_OUTCOME_WORD.other) : ""}
                  </span>
                  <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{nameOf(c.studentId)}{c.note ? ` · ${c.note}` : ""}</span>
                </span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(agoP(c.at))}</span>
              </div>
            ))
          )}
        </Card>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.historyNote)}</span>
      </section>

      {/* Log call / promise */}
      <Sheet
        open={sheet === "call" || sheet === "promise"}
        onClose={() => setSheet(null)}
        icon="phone"
        title={tx(W.logCall)}
        sub={`${f.fatherName} · ${rupees(f.pendingToday)} ${tx(W.pendingToday).toLowerCase()}`}
        footer={
          <>
            <Btn variant="sec" full onClick={() => setSheet(null)}>{tx(W.close)}</Btn>
            <Btn variant="pri" full disabled={!outcome || busy || (outcome === "promised" && !(amount > 0))} onClick={saveCall}>{tx(W.save)}</Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SecHead>{tx(W.howDidItGo)}</SecHead>
          {CALL_OUTCOMES.map((o) => (
            <RadioCard key={o} name="call-outcome" checked={outcome === o} onSelect={() => setOutcome(o)} title={<Bi {...OUTCOME_WORD[o]} />} sub={o === "promised" ? tx(W.oPromisedSub) : undefined} />
          ))}
          {outcome === "promised" || outcome === "visit" ? (
            <>
              <SecHead>{tx(W.when)}</SecHead>
              <DateChips days={dayChoices(today, tx)} value={day} onChange={setDay} />
            </>
          ) : null}
          {outcome === "promised" ? (
            <>
              <Field label={tx(W.amount)}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Btn variant="sec" icon="minus" ariaLabel="-500" onClick={() => setAmount((a) => Math.max(0, a - 500))} />
                  <Input inputMode="numeric" value={String(amount)} onChange={(e) => setAmount(Number(e.target.value.replace(/[^\d]/g, "")) || 0)} style={{ textAlign: "center" }} />
                  <Btn variant="sec" icon="plus" ariaLabel="+500" onClick={() => setAmount((a) => a + 500)} />
                </div>
              </Field>
              <ChipRow label={tx(W.amount)}>
                <Chip on={amount === f.pendingToday} onClick={() => setAmount(f.pendingToday)}>{tx(W.full)} · {rupees(f.pendingToday)}</Chip>
                <Chip on={amount === Math.round(f.pendingToday / 2)} onClick={() => setAmount(Math.round(f.pendingToday / 2))}>{tx(W.half)} · {rupees(Math.round(f.pendingToday / 2))}</Chip>
              </ChipRow>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>
                {rupees(f.pendingToday)} {tx(W.promiseNote)} {f.lateFee > 0 ? `(${tx(W.lateFee)} ${rupees(f.lateFee)})` : ""}
              </span>
            </>
          ) : null}
          <Field label={tx(W.note)}>
            <Textarea value={note} rows={2} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Pill tone="info" icon="calendar">{tx(W.nextFollowUp)}: {nextFollowUp}</Pill>
          {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
        </div>
      </Sheet>

      {/* WhatsApp: preview and queue only */}
      <Sheet
        open={sheet === "wa"}
        onClose={() => setSheet(null)}
        icon="message"
        title={tx(W.waTitle)}
        sub={f.fatherName}
        footer={
          <>
            <Btn variant="sec" full onClick={() => setSheet(null)}>{tx(W.close)}</Btn>
            <Btn variant="pri" full icon="send" disabled={busy} onClick={queueWa}>{tx(W.waQueue)}</Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <WhatsAppPreview lines={[message.hi ?? "", "", message.en ?? ""]} footer="फीस जमा करें · Pay fee" />
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.waFooter)}</span>
          <Banner tone="info">{tx(W.waNote)}</Banner>
          {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
        </div>
      </Sheet>

      {/* EMI plan */}
      <Sheet
        open={sheet === "plan"}
        onClose={() => setSheet(null)}
        icon="calendar"
        title={tx(W.planTitle)}
        sub={kid ? `${kid.fullName} · ${kid.classLabel}` : undefined}
        footer={
          planDone ? (
            <>
              <Btn variant="sec" full disabled={busy || !planDone.planId} onClick={undoPlan}>{tx(W.undoPlan)}</Btn>
              <Btn variant="pri" full onClick={() => setSheet(null)}>{tx(W.done)}</Btn>
            </>
          ) : (
            <>
              <Btn variant="sec" full onClick={() => setSheet(null)}>{tx(W.close)}</Btn>
              <Btn variant="pri" full disabled={!planReady || busy} onClick={savePlan}>{tx(W.savePlan)}</Btn>
            </>
          )
        }
      >
        {planDone && preview?.ok ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: "12px 0" }}>
            <SuccessTick />
            <strong style={{ fontSize: 18 }}>{tx(W.planSaved)}</strong>
            <span style={{ color: "var(--mut)" }}>
              {preview.schedule.length} × {rupees(preview.monthlyAmount)} · {dayMonth(preview.schedule[0]?.dueDate)} – {dayMonth(preview.schedule[preview.schedule.length - 1]?.dueDate)}
            </span>
            {preview.lateFeeWaived > 0 ? <Pill tone="ok">{tx(W.waiveLate)} · {rupees(preview.lateFeeWaived)}</Pill> : null}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!perms.planEnabled ? <Banner tone="warn">{tx(W.planOff)}</Banner> : !perms.plan ? <Banner tone="info">{tx(W.planAdminOnly)}</Banner> : null}
            {f.kids.length > 1 ? (
              <ChipRow label={tx(W.child)}>
                {f.kids.map((k) => (
                  <Chip key={k.studentId} on={planKid === k.studentId} onClick={() => setPlanKid(k.studentId)}>{k.fullName.split(" ")[0]}</Chip>
                ))}
              </ChipRow>
            ) : null}
            <SecHead>{tx(W.parts)}</SecHead>
            <ChipRow label={tx(W.parts)}>
              {[2, 3, 4, 5, 6].map((n) => (
                <Chip key={n} on={parts === n} onClick={() => setParts(n)}>{n}</Chip>
              ))}
            </ChipRow>
            <SecHead>{tx(W.firstPart)}</SecHead>
            <DateChips days={firstDays} value={planFirst} onChange={setPlanFirst} />
            {preview === null ? (
              <span style={{ color: "var(--mut)" }}>{tx(W.loading)}</span>
            ) : !preview.ok ? (
              <Banner tone="warn">{preview.error}</Banner>
            ) : (
              <>
                <Card pad={false}>
                  {preview.schedule.map((s, i) => (
                    <div key={`${s.dueDate}-${i}`} style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                      <span>{i + 1} · {shortDay(s.dueDate)}</span>
                      <span className="num" style={{ fontWeight: 700 }}>{rupees(s.amount)}</span>
                    </div>
                  ))}
                </Card>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>
                  {tx(W.planCovers)}: {preview.covers.join(", ")} · {rupees(preview.openingBalance)}
                </span>
                {preview.lateFeeWaived > 0 ? <Pill tone="ok" icon="check">{tx(W.waiveLate)} · {rupees(preview.lateFeeWaived)}</Pill> : null}
                {preview.hasActivePlan ? <Banner tone="warn">{tx(W.planActive)}</Banner> : null}
                {preview.errors.map((e) => (
                  <Banner key={e} tone="warn">{e}</Banner>
                ))}
                <Field label={tx(W.reason)}>
                  <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
                </Field>
              </>
            )}
            {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
          </div>
        )}
      </Sheet>
    </div>
  );
}
