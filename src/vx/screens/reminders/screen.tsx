"use client";

import "./reminders.css";

import Link from "@/vx/ui/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { cancelBatchAction, saveRuleAction } from "@/app/(app)/reminders/actions";
import { addDays } from "@/modules/receipts/vx/domain/day-close";
import { funnelRates, messageCost, SEND_TIMES, TEMPLATE_IDS, TEMPLATES, type SendTime, type TemplateId } from "@/modules/whatsapp/vx/domain/reminders";
import { pct, rupees, rupeesShort } from "@/vx/format";
import { useVx, type Pair } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar, VxPage } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";

import type { BatchRow, RemindersProps, RuleRow, RunView } from "./types";
import { ChipBtn, dayShort, RadioRow, SwitchKnob } from "./bits";
import { ReminderWizard } from "./wizard";
import { TIME_WORD, W } from "./words";

type Tx = (p: Pair | string) => string;

const V = (x: string) => `var(--${x})`;
const delay = (i: number) => `${Math.min(i, 12) * 40}ms`;
const pc = (a: number, b: number) => `${pct(a, b)}%`;

/** The provider's error, said the way the design labels it. */
function failKind(error: string | null): { word: Pair; bad: boolean } {
  if (error && /whats ?app/i.test(error)) return { word: W.notOnWhatsApp, bad: false };
  if (error && /invalid|number/i.test(error)) return { word: W.invalidNumber, bad: true };
  return { word: W.notDeliveredTitle, bad: true };
}

export function timingWord(ruleKey: string, option: string, tx: Tx): string {
  if (option === "mon") return tx(W.everyMon);
  if (option === "thu") return tx(W.everyThu);
  if (option === "0") return tx(W.onTheDay);
  const after = ruleKey === "after_due";
  const one = option === "1";
  return `${option} ${tx(after ? (one ? W.dayAfter : W.daysAfter) : one ? W.dayBefore : W.daysBefore)}`;
}

function RuleSheet({ rule, canEdit, onClose }: { rule: RuleRow; canEdit: boolean; onClose: () => void }) {
  const { tx, language } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [enabled, setEnabled] = useState(rule.enabled);
  const [timing, setTiming] = useState(rule.timingChoice);
  const [time, setTime] = useState<SendTime>((SEND_TIMES as readonly string[]).includes(rule.sendTime) ? (rule.sendTime as SendTime) : "10");
  const [audience, setAudience] = useState(rule.audience);
  const [template, setTemplate] = useState<TemplateId>(rule.template);
  const [quiet, setQuiet] = useState(rule.quietHours);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const title = language === "hi" && rule.titleHi ? rule.titleHi : rule.titleEn;
  const whenLine = `${timingWord(rule.ruleKey, timing, tx)} · ${TIME_WORD[time]}`;

  function save() {
    setError(null);
    start(async () => {
      const res = await saveRuleAction({
        ruleKey: rule.ruleKey,
        enabled,
        timingChoice: timing,
        sendTime: time,
        audience,
        template,
        quietHours: quiet,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.show({ text: `${tx(W.saved)} · ${title}` });
      onClose();
      router.refresh();
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      sub={tx(W.ruleSub)}
      footer={
        <>
          <button type="button" className="tap btn sec" onClick={onClose} style={{ flex: 1 }}>
            {tx(W.cancel)}
          </button>
          <button type="button" className="tap btn pri" disabled={!canEdit || busy} onClick={save} style={{ flex: 1.6 }}>
            <Ic n="check" />
            {tx(W.save)}
          </button>
        </>
      }
    >
      <div
        className="rm-lh"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          paddingTop: 4,
        }}
      >
        {!canEdit ? <Banner tone="info">{tx(W.adminOnly)}</Banner> : null}
        <button type="button" className="tap card rm-sw" role="switch" aria-checked={enabled} disabled={!canEdit} onClick={() => setEnabled(!enabled)} style={{ border: "1px solid var(--bd)" }}>
          <span className="rm-c" style={{ flex: 1 }}>
            <span className="rm-b">{tx(enabled ? W.ruleIsOn : W.ruleIsOff)}</span>
            <span className="rm-m">{whenLine}</span>
          </span>
          <SwitchKnob on={enabled} />
        </button>
        <span className="sech" style={{ marginTop: 4 }}>
          {tx(W.ruleWhen)}
        </span>
        <div className="rm-f" style={{ flexWrap: "wrap", gap: 6 }}>
          {rule.timingOptions.map((o) => (
            <ChipBtn key={o} on={timing === o} onClick={() => setTiming(o)}>
              {timingWord(rule.ruleKey, o, tx)}
            </ChipBtn>
          ))}
        </div>
        <div className="rm-f" style={{ flexWrap: "wrap", gap: 6 }}>
          {SEND_TIMES.map((t) => (
            <ChipBtn key={t} clock on={time === t} onClick={() => setTime(t)}>
              {TIME_WORD[t]}
            </ChipBtn>
          ))}
        </div>
        <span className="sech" style={{ marginTop: 4 }}>
          {tx(W.ruleWho)}
        </span>
        <RadioRow on={audience === "all"} onPick={() => setAudience("all")} label={tx(W.everyoneApplies)} />
        <RadioRow on={audience === "skip_promised"} onPick={() => setAudience("skip_promised")} label={tx(W.skipPromised)} />
        <span className="sech" style={{ marginTop: 4 }}>
          {tx(W.ruleTemplate)}
        </span>
        <div className="rm-f" style={{ flexWrap: "wrap", gap: 6 }}>
          {TEMPLATE_IDS.map((id) => (
            <ChipBtn key={id} on={template === id} onClick={() => setTemplate(id)}>
              {tx(TEMPLATES[id].label)}
            </ChipBtn>
          ))}
        </div>
        <button
          type="button"
          className="tap card rm-sw"
          role="switch"
          aria-checked={quiet}
          disabled={!canEdit}
          onClick={() => setQuiet(!quiet)}
          style={{ border: "1px solid var(--bd)", marginTop: 4 }}
        >
          <Ic n="moon" style={{ color: "var(--mut)" }} />
          <span className="rm-c" style={{ flex: 1 }}>
            <span className="rm-b">{tx(W.quietSwitch)}</span>
            <span className="rm-m">{tx(W.quietSub)}</span>
          </span>
          <SwitchKnob on={quiet} />
        </button>
        <div className="rm-in" style={{ background: "var(--accs)", color: "var(--accfg)" }}>
          <Ic n="calendar" style={{ marginTop: 2 }} />
          <span>
            {whenLine} · {tx(TEMPLATES[template].label)} · {tx(W.hindiFirst)}. {tx(W.autoNote)}
          </span>
        </div>
        {error ? <Banner tone="bad">{error}</Banner> : null}
      </div>
    </Sheet>
  );
}

/** One row of "Reminders sent": a run the fee app's sender made, or a batch queued here. */
type CampRow = {
  key: string;
  href: string;
  name: string;
  auto: boolean;
  line: string;
  wd: string;
  wr: string;
  wp: string;
  funnel: string;
  amt: string;
  amtTone: string;
  status: string;
};

function runRow(r: RunView, tx: Tx): CampRow {
  return {
    key: r.runId,
    href: `/reminders?view=results&run=${r.runId}`,
    name: r.name,
    auto: r.source === "cron",
    line: `${dayShort(r.startedAt)} · ${r.messaged} ${tx(W.families)}`,
    wd: pc(r.delivered, r.messaged),
    wr: pc(r.read, r.messaged),
    wp: pc(r.familiesPaid, r.messaged),
    funnel: `${r.messaged} → ${r.delivered} → ${r.read} → ${r.familiesPaid}`,
    amt: rupees(r.moneyCollected),
    amtTone: r.moneyCollected ? V("ok") : V("fg"),
    status: tx(W.paidWithin7),
  };
}

function batchRow(b: BatchRow, tx: Tx): CampRow {
  const word = b.status === "cancelled" ? W.cancelled : b.status === "prepared" ? W.prepared : b.status === "scheduled" ? W.scheduled : W.tQueued;
  return {
    key: b.id,
    href: `/reminders?view=sending&batch=${b.id}`,
    name: b.name,
    auto: false,
    line: `${dayShort(b.createdAt)} · ${b.audienceLine ?? ""}`,
    wd: "0%",
    wr: "0%",
    wp: "0%",
    funnel: `${tx(W.waiting)} · ${b.familyCount} ${tx(W.families)}`,
    amt: tx(word),
    amtTone: V("fg"),
    status: b.status === "scheduled" && b.scheduledFor ? dayShort(b.scheduledFor) : `${tx(W.about)} ${rupees(b.costEstimate)}`,
  };
}

export function RemindersScreen(props: RemindersProps) {
  const { view, runs, batches, rules, batch, result, perms } = props;
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [ruleOpen, setRuleOpen] = useState<string | null>(props.ruleOpen);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  const since = addDays(props.today, -30);
  const recent = runs.filter((r) => r.startedAt >= since);
  const sent = recent.reduce((s, r) => s + r.messaged, 0);
  const read = recent.reduce((s, r) => s + r.read, 0);
  const paid = recent.reduce((s, r) => s + r.familiesPaid, 0);
  const collected = recent.reduce((s, r) => s + r.moneyCollected, 0);
  const openRule = rules.find((r) => r.ruleKey === ruleOpen) ?? null;
  const ruleOn = (r: RuleRow) => flipped[r.ruleKey] ?? r.enabled;
  const autoOn = rules.filter(ruleOn).length;
  const intro = view === "empty" && (runs.length > 0 || batches.length > 0);

  function toggleRule(rule: RuleRow) {
    if (!perms.rules) {
      setRuleOpen(rule.ruleKey);
      return;
    }
    const before = ruleOn(rule);
    const save = (enabled: boolean) =>
      saveRuleAction({
        ruleKey: rule.ruleKey,
        enabled,
        timingChoice: rule.timingChoice,
        sendTime: rule.sendTime,
        audience: rule.audience,
        template: rule.template,
        quietHours: rule.quietHours,
      });
    setFlipped((f) => ({ ...f, [rule.ruleKey]: !before }));
    start(async () => {
      const res = await save(!before);
      if (!res.ok) {
        setFlipped((f) => ({ ...f, [rule.ruleKey]: before }));
        toast.show({ text: res.error, tone: "bad" });
        return;
      }
      toast.show({
        text: `${rule.titleEn} · ${tx(before ? W.paused : W.switchedOn)}`,
        undo: async () => {
          setFlipped((f) => ({ ...f, [rule.ruleKey]: before }));
          await save(before);
          router.refresh();
        },
      });
      router.refresh();
    });
  }

  if (view === "wizard") {
    return (
      <VxPage className="rm-lh">
        <ReminderWizard {...props} />
      </VxPage>
    );
  }

  let body: ReactNode;
  if (view === "sending" && batch) {
    const cancelled = batch.status === "cancelled";
    const title = cancelled ? W.cancelledFor : batch.status === "prepared" ? W.preparedFor : batch.status === "scheduled" ? W.scheduledFor : W.queuedFor;
    body = (
      <div className="pad" style={{ padding: 28, display: "flex", justifyContent: "center" }}>
        <div
          className="card rm-c"
          style={{
            maxWidth: 620,
            width: "100%",
            padding: "28px 24px",
            alignItems: "center",
            gap: 14,
            textAlign: "center",
          }}
        >
          <div style={{ position: "relative", width: 168, height: 168 }}>
            <svg width="168" height="168" viewBox="0 0 168 168" aria-hidden="true">
              <circle cx="84" cy="84" r="72" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 12 }} />
            </svg>
            <div
              className="rm-c"
              style={{
                position: "absolute",
                inset: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span className="num" style={{ fontSize: 34, fontWeight: 700 }}>
                0%
              </span>
              <span className="rm-m">{tx(W.sentLabel)}</span>
            </div>
          </div>
          <span className="serif" style={{ fontSize: 24, fontWeight: 600 }}>
            {tx(title)} {batch.familyCount} {tx(W.families)}
            {batch.status === "scheduled" && batch.scheduledFor ? ` · ${dayShort(batch.scheduledFor)}` : ""}
          </span>
          <span className="rm-m" style={{ fontSize: 14 }}>
            {batch.audienceLine ? `${batch.audienceLine} · ` : ""}
            {tx(W.about)} {rupees(batch.costEstimate)} · {tx(TEMPLATES[batch.template].label)}
          </span>
          <div
            className="g4"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 8,
              width: "100%",
            }}
          >
            {[
              [W.tQueued, cancelled ? 0 : batch.familyCount, "fg"],
              [W.tSent, 0, "fg"],
              [W.tDelivered, 0, "ok"],
              [W.tFailed, 0, "fg"],
            ].map(([k, v, c]) => (
              <div key={tx(k as Pair)} className="rm-tile" style={{ alignItems: "center" }}>
                <span
                  className="num"
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: V(c as string),
                  }}
                >
                  {v as number}
                </span>
                <span className="rm-m">{tx(k as Pair)}</span>
              </div>
            ))}
          </div>
          <span
            className="rm-f rm-m"
            style={{
              fontSize: 13,
              alignItems: "flex-start",
              textAlign: "left",
            }}
          >
            <span
              className="rm-d"
              style={{
                background: "var(--acc)",
                marginTop: 6,
                animation: "xPulse 1.6s ease infinite",
              }}
            />
            {tx(W.sendingNote)}
          </span>
          <div className="rm-f" style={{ flexWrap: "wrap", justifyContent: "center" }}>
            {!cancelled ? (
              <Btn variant="pri" icon="send" href="/messages?view=outbox">
                {tx(W.openToSend)}
              </Btn>
            ) : null}
            <Btn variant="sec" href="/reminders">
              {tx(W.backToList)}
            </Btn>
            {!cancelled && batch.status !== "prepared" && perms.queue ? (
              <Btn
                variant="ghost"
                icon="x"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    const res = await cancelBatchAction(batch.id);
                    toast.show({
                      text: res.ok ? tx(W.batchCancelled) : res.error,
                      tone: res.ok ? "info" : "bad",
                    });
                    router.refresh();
                  })
                }
              >
                {tx(W.cancelBatch)}
              </Btn>
            ) : null}
          </div>
        </div>
      </div>
    );
  } else if (view === "results" && result) {
    const r = result.run;
    const rates = funnelRates({
      sent: r.messaged,
      delivered: r.delivered,
      read: r.read,
      paid: r.familiesPaid,
    });
    const cost = messageCost(r.messaged);
    const unread = Math.max(0, r.delivered - r.read);
    const failN = result.notDelivered.length;
    const funnel: [Pair, number, string, string][] = [
      [W.tSent, r.messaged, "", "c4"],
      [W.tDelivered, r.delivered, `${rates.delivered}% ${tx(W.ofSent)}`, "c2"],
      [W.read, r.read, `${rates.read}% ${tx(W.ofDelivered)}`, "c1"],
      [W.paid7, r.familiesPaid, `${rates.paid}% ${tx(W.ofSent)} · ${rupeesShort(r.moneyCollected)}`, "ok"],
    ];
    const cols = "minmax(0, 1.3fr) repeat(2, minmax(0, .7fr))";
    const totalQuoted = result.byClass.reduce((s, c) => s + c.quoted, 0);
    const clsRows = [
      ...result.byClass.map((c) => ({
        k: c.classLabel,
        sent: c.messaged,
        amt: c.quoted,
        total: false,
      })),
      { k: tx(W.allClasses), sent: r.messaged, amt: totalQuoted, total: true },
    ];
    body = (
      <div className="pad rm-c" style={{ padding: "22px 28px 40px", gap: 16 }}>
        <div className="rm-f" style={{ flexWrap: "wrap", gap: "6px 10px" }}>
          <span
            className="pill"
            style={{
              height: 26,
              padding: "0 10px",
              fontSize: 12,
              background: "var(--s2)",
              color: "var(--mut)",
            }}
          >
            {dayShort(r.startedAt)}
          </span>
          <span className="rm-m" style={{ fontSize: 13 }}>
            {r.messaged} {tx(W.families)} · {tx(W.sentBy)} {tx(r.source === "cron" ? W.byRule : W.byHand)}
          </span>
        </div>
        <div
          className="stack"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div className="rm-c" style={{ gap: 16 }}>
            <div className="card rm-c" style={{ padding: 18, gap: 14 }}>
              <div className="rm-f" style={{ justifyContent: "space-between" }}>
                <span className="rm-v">{tx(W.whatHappened)}</span>
                <span className="num rm-m">
                  {tx(W.costLower)} {rupees(cost)}
                </span>
              </div>
              {funnel.map(([k, v, rate, c], i) => (
                <div key={k.en} className="rm-c" style={{ gap: 6 }}>
                  <div className="rm-f" style={{ justifyContent: "space-between" }}>
                    <span className="rm-b">{tx(k)}</span>
                    <span className="rm-f" style={{ gap: 10 }}>
                      <span className="rm-m">{rate}</span>
                      <span className="num rm-v" style={{ minWidth: 40, textAlign: "right" }}>
                        {v}
                      </span>
                    </span>
                  </div>
                  <div
                    style={{
                      height: 14,
                      borderRadius: 7,
                      background: "var(--s2)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: 14,
                        width: pc(v, r.messaged),
                        borderRadius: 7,
                        background: V(c),
                        transformOrigin: "left",
                        animation: "xGrowX .8s var(--ease) both",
                        animationDelay: `${i * 140}ms`,
                      }}
                    />
                  </div>
                </div>
              ))}
              <div
                className="g3"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 8,
                  marginTop: 4,
                }}
              >
                {[
                  [W.paidAfter, rupees(r.moneyCollected), "ok"],
                  [W.cost, rupees(cost), "fg"],
                  [W.perRupee, cost && r.moneyCollected ? rupees(Math.round(r.moneyCollected / cost)) : "—", "fg"],
                ].map(([k, v, c]) => (
                  <div key={(k as Pair).en} className="rm-tile">
                    <span className="rm-m">{tx(k as Pair)}</span>
                    <span className="num rm-v" style={{ color: V(c as string) }}>
                      {v as string}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {result.byClass.length ? (
              <div className="card" style={{ overflow: "hidden" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: cols,
                    gap: 8,
                    padding: "12px 18px",
                    background: "var(--s2)",
                  }}
                >
                  <span className="sech">{tx(W.cls)}</span>
                  <span className="sech" style={{ textAlign: "right" }}>
                    {tx(W.tSent)}
                  </span>
                  <span className="sech" style={{ textAlign: "right" }}>
                    {tx(W.quoted)}
                  </span>
                </div>
                {clsRows.map((c, i) => (
                  <div
                    key={`${c.k}-${i}`}
                    className="num"
                    style={{
                      display: "grid",
                      gridTemplateColumns: cols,
                      gap: 8,
                      padding: "10px 18px",
                      borderTop: c.total ? "2px solid var(--bd)" : "1px solid var(--bd)",
                      fontSize: 13,
                      fontWeight: c.total ? 700 : 500,
                    }}
                  >
                    <span className="rm-e">{c.k}</span>
                    <span style={{ textAlign: "right" }}>{c.sent}</span>
                    <span style={{ textAlign: "right" }}>{rupees(c.amt)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="rm-c" style={{ gap: 16 }}>
            {unread > 0 && perms.queue ? (
              <div
                className="card rm-c"
                style={{
                  padding: "16px 18px",
                  gap: 10,
                  background: "var(--accs)",
                  borderColor: "transparent",
                }}
              >
                <span className="rm-f" style={{ gap: 10, color: "var(--accfg)" }}>
                  <Ic n="eyeOff" />
                  <span className="rm-v">
                    {tx(W.remindUnread)} ({unread})
                  </span>
                </span>
                <span style={{ fontSize: 13, color: "var(--accfg)" }}>
                  {tx(W.unreadBody)} {unread} {tx(W.messages)} · {tx(W.about)} {rupees(messageCost(unread))}.
                </span>
                <Btn variant="pri" icon="send" href="/reminders?view=wizard" style={{ alignSelf: "flex-start" }}>
                  {tx(W.remind)} {unread} {tx(W.families)}
                </Btn>
              </div>
            ) : null}
            <div className="card" style={{ overflow: "hidden" }}>
              <div className="rm-c" style={{ padding: "14px 18px 8px" }}>
                <span className="rm-v">{failN ? `${failN} ${tx(W.notDelivered)}` : tx(W.notDeliveredTitle)}</span>
                <span className="rm-m">{tx(W.notDeliveredSub)}</span>
              </div>
              {result.notDelivered.map((n, i) => {
                const kind = failKind(n.error);
                return (
                  <div
                    key={`${n.studentId}-${i}`}
                    className="rm-c"
                    style={{
                      gap: 8,
                      padding: "12px 18px",
                      borderTop: "1px solid var(--bd)",
                      animation: "xIn .3s var(--ease) both",
                      animationDelay: delay(i),
                    }}
                  >
                    <div className="rm-f" style={{ gap: 10 }}>
                      <span className="rm-c" style={{ flex: 1 }}>
                        <span className="rm-e rm-b">{n.studentName}</span>
                        <span className="num rm-e rm-m">{[n.classLabel, kind.word === W.notDeliveredTitle ? n.error : null].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span
                        className="pill"
                        style={{
                          background: kind.bad ? "var(--bads)" : "var(--warns)",
                          color: kind.bad ? "var(--bad)" : "var(--warnfg)",
                        }}
                      >
                        {tx(kind.word)}
                      </span>
                    </div>
                    <Btn variant="sec" icon="edit" href={`/fees/students/${n.studentId}`} style={{ alignSelf: "flex-start" }}>
                      {tx(W.fixNumber)}
                    </Btn>
                  </div>
                );
              })}
              {failN === 0 ? (
                <div
                  className="rm-f rm-m"
                  style={{
                    padding: "14px 18px",
                    borderTop: "1px solid var(--bd)",
                  }}
                >
                  <Ic n="checkCircle" size={16} style={{ color: "var(--ok)" }} />
                  {tx(W.allReached)}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  } else if (view === "empty") {
    body = (
      <div
        className="pad"
        style={{
          padding: "40px 28px",
          display: "flex",
          justifyContent: "center",
          animation: "xFade .4s ease both",
        }}
      >
        <div
          className="card rm-c"
          style={{
            maxWidth: 520,
            width: "100%",
            padding: "36px 28px",
            alignItems: "center",
            gap: 12,
            textAlign: "center",
          }}
        >
          <span
            style={{
              width: 76,
              height: 76,
              borderRadius: 38,
              background: "var(--accs)",
              color: "var(--accfg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "xPopIn .5s var(--spring) both, xPulse 2s 1s ease infinite",
            }}
          >
            <Ic n="bell" size={34} />
          </span>
          <span className="serif" style={{ fontSize: 26, fontWeight: 600 }}>
            {tx(W.emptyTitle)}
          </span>
          <span className="rm-m" style={{ fontSize: 14, lineHeight: 1.6 }}>
            {tx(W.emptyBody1)}
            <br />
            {tx(W.emptyBody2)}
          </span>
          {perms.queue ? (
            <Btn variant="pri" icon="plus" href="/reminders?view=wizard" style={{ height: 48, padding: "0 22px", marginTop: 6 }}>
              {tx(W.newReminder)}
            </Btn>
          ) : null}
          <span className="rm-m">{tx(W.emptyFoot)}</span>
        </div>
      </div>
    );
  } else {
    const rows = [...batches.filter((b) => b.status !== "cancelled").map((b) => batchRow(b, tx)), ...runs.map((r) => runRow(r, tx))];
    const kpis: {
      label: string;
      value: string;
      sub: string;
      tone: string;
      ring?: number;
    }[] = [
      {
        label: tx(W.sent30),
        value: String(sent),
        sub: `${rupees(messageCost(sent))} ${tx(W.spent)}`,
        tone: V("fg"),
      },
      {
        label: tx(W.readRate),
        value: pc(read, sent),
        sub: `${read} ${tx(W.of)} ${sent} ${tx(W.opened)}`,
        tone: V("fg"),
        ring: sent ? read / sent : 0,
      },
      {
        label: tx(W.paid7),
        value: rupeesShort(collected),
        sub: `${paid} ${tx(W.familiesAfter)}`,
        tone: V("ok"),
      },
      {
        label: tx(W.balance),
        value: "—",
        sub: tx(W.balanceSub),
        tone: V("fg"),
      },
    ];
    body = (
      <div className="pad rm-c" style={{ padding: "22px 28px 40px", gap: 16 }}>
        <div
          className="g4"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          {kpis.map((k, i) => (
            <div
              key={k.label}
              className="card rise rm-f"
              style={{
                padding: "14px 16px",
                gap: 10,
                animationDelay: delay(i),
              }}
            >
              <div className="rm-c" style={{ flex: 1, gap: 2 }}>
                <span className="rm-m" style={{ fontWeight: 600 }}>
                  {k.label}
                </span>
                <span
                  className="num"
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    whiteSpace: "nowrap",
                    color: k.tone,
                  }}
                >
                  {k.value}
                </span>
                <span className="rm-m">{k.sub}</span>
              </div>
              {k.ring !== undefined ? (
                <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true" style={{ flex: "none" }}>
                  <circle
                    cx="23"
                    cy="23"
                    r="18"
                    style={{
                      fill: "none",
                      stroke: "var(--s3)",
                      strokeWidth: 6,
                    }}
                  />
                  <circle
                    cx="23"
                    cy="23"
                    r="18"
                    transform="rotate(-90 23 23)"
                    style={{
                      fill: "none",
                      stroke: "var(--c2)",
                      strokeWidth: 6,
                      strokeLinecap: "round",
                      strokeDasharray: `${(113.1 * k.ring).toFixed(1)} 113.1`,
                      ["--len" as string]: "113.1",
                      animation: "xDraw .9s .2s var(--ease) both",
                    }}
                  />
                </svg>
              ) : null}
            </div>
          ))}
        </div>

        <div
          className="stack"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.55fr) minmax(0, 1fr)",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div className="card" style={{ overflow: "hidden" }}>
            <div
              className="rm-f"
              style={{
                justifyContent: "space-between",
                padding: "14px 18px 12px",
              }}
            >
              <span className="rm-c">
                <span className="rm-v">{tx(W.remindersSent)}</span>
                <span className="rm-m">{tx(W.funnel)}</span>
              </span>
              <span className="rm-f rm-m" style={{ gap: 10 }}>
                <span className="rm-f" style={{ gap: 4 }}>
                  <span className="rm-d" style={{ background: "var(--c4)" }} />
                  {tx(W.lDelivered)}
                </span>
                <span className="rm-f" style={{ gap: 4 }}>
                  <span className="rm-d" style={{ background: "var(--c2)" }} />
                  {tx(W.lRead)}
                </span>
                <span className="rm-f" style={{ gap: 4 }}>
                  <span className="rm-d" style={{ background: "var(--ok)" }} />
                  {tx(W.lPaid)}
                </span>
              </span>
            </div>
            {rows.length === 0 ? (
              <div
                className="rm-m"
                style={{
                  padding: "14px 18px",
                  borderTop: "1px solid var(--bd)",
                }}
              >
                {tx(W.noRuns)}
              </div>
            ) : (
              rows.map((c, i) => (
                <Link key={c.key} href={c.href} className="tap row rm-cr" style={{ animationDelay: delay(i) }}>
                  <span className="rm-c rm-ga" style={{ gap: 2 }}>
                    <span className="rm-f" style={{ gap: 6 }}>
                      <span className="rm-e rm-b">{c.name}</span>
                      {c.auto ? (
                        <span
                          className="pill"
                          style={{
                            background: "var(--s2)",
                            color: "var(--mut)",
                          }}
                        >
                          {tx(W.automatic)}
                        </span>
                      ) : null}
                    </span>
                    <span className="rm-e rm-m">{c.line}</span>
                  </span>
                  <span className="rm-c rm-gb" style={{ gap: 5 }}>
                    <span className="rm-fb">
                      <span style={{ width: "100%", background: "var(--s3)" }} />
                      <span style={{ width: c.wd, background: "var(--c4)" }} />
                      <span
                        style={{
                          width: c.wr,
                          background: "var(--c2)",
                          animationDelay: ".15s",
                        }}
                      />
                      <span
                        style={{
                          width: c.wp,
                          background: "var(--ok)",
                          animationDelay: ".3s",
                        }}
                      />
                    </span>
                    <span className="num rm-m">{c.funnel}</span>
                  </span>
                  <span className="rm-c rm-gc" style={{ alignItems: "flex-end" }}>
                    <span className="num rm-v" style={{ color: c.amtTone }}>
                      {c.amt}
                    </span>
                    <span className="rm-m" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                      {c.status}
                    </span>
                  </span>
                  <Ic n="chevRight" className="rm-dx" style={{ color: "var(--sub)" }} />
                </Link>
              ))
            )}
            <Link
              href="/reminders?view=empty"
              className="tap row rm-f rm-m"
              style={{
                width: "100%",
                padding: "12px 18px",
                borderTop: "1px solid var(--bd)",
                background: "var(--s2)",
                fontWeight: 600,
                textDecoration: "none",
                lineHeight: "normal",
              }}
            >
              <Ic n="help" size={16} />
              {tx(W.newHere)}
            </Link>
          </div>

          <div className="card" style={{ overflow: "hidden" }}>
            <div className="rm-c" style={{ padding: "14px 18px 10px" }}>
              <span className="rm-v">{tx(W.auto)}</span>
              <span className="rm-m">{tx(W.autoSub)}</span>
            </div>
            {rules.map((rule, i) => {
              const on = ruleOn(rule);
              const line = `${timingWord(rule.ruleKey, rule.timingChoice, tx)} · ${TIME_WORD[rule.sendTime] ?? rule.sendTime} · ${tx(TEMPLATES[rule.template].label)}`;
              return (
                <div
                  key={rule.ruleKey}
                  className="rm-f"
                  style={{
                    gap: 0,
                    borderTop: "1px solid var(--bd)",
                    paddingRight: 14,
                    animation: "xIn .32s var(--ease) both",
                    animationDelay: delay(i),
                  }}
                >
                  <button type="button" className="tap row rm-nb rm-f" onClick={() => setRuleOpen(rule.ruleKey)} style={{ flex: 1, gap: 12, padding: "12px 8px 12px 18px" }}>
                    <span
                      style={{
                        flex: "none",
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: on ? V("accs") : V("s2"),
                        color: on ? V("accfg") : V("sub"),
                        transition: "background-color .3s ease, color .3s ease",
                      }}
                    >
                      <Ic n={rule.icon as IconName} />
                    </span>
                    <span className="rm-c">
                      <span className="rm-b">{rule.titleEn}</span>
                      <span className="rm-m">{on ? line : `${tx(W.off)} · ${line}`}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="tap"
                    role="switch"
                    aria-checked={on}
                    aria-label={rule.titleEn}
                    disabled={busy}
                    onClick={() => toggleRule(rule)}
                    style={{
                      border: 0,
                      background: "transparent",
                      padding: "8px 0 8px 6px",
                    }}
                  >
                    <SwitchKnob on={on} />
                  </button>
                </div>
              );
            })}
            <div
              className="rm-f rm-m"
              style={{
                padding: "12px 18px",
                borderTop: "1px solid var(--bd)",
                background: "var(--s2)",
              }}
            >
              <Ic n="moon" size={16} />
              {tx(W.quiet)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isList = view === "list";
  const crumb = isList || (view === "empty" && !intro) ? W.crumb : view === "results" ? W.crumbResults : W.crumbShort;
  const title = view === "sending" ? tx(W.sending) : view === "results" && result ? result.run.name : tx(W.title);
  const showBack = !isList && !(view === "empty" && !intro);
  const mSub = isList
    ? `${autoOn} ${tx(W.automaticOn)}`
    : view === "empty"
      ? tx(intro ? W.howItWorks : W.notSetUp)
      : view === "sending" && batch
        ? `${batch.familyCount} ${tx(W.families)}`
        : view === "results" && result
          ? dayShort(result.run.startedAt)
          : undefined;

  return (
    <VxPage className="rm-lh">
      <TopBar
        crumb={tx(crumb)}
        title={title}
        mSub={mSub}
        mBack={showBack ? "/reminders" : "/menu"}
        actions={
          isList ? (
            <>
              {perms.queue ? (
                <Btn variant="sec" icon="rupee" href="https://app.aisensy.com" target="_blank">
                  {tx(W.topUp)}
                </Btn>
              ) : null}
              {perms.queue ? (
                <Btn variant="pri" icon="plus" href="/reminders?view=wizard">
                  {tx(W.newReminder)}
                </Btn>
              ) : null}
            </>
          ) : showBack ? (
            <Btn variant="ghost" icon="chevLeft" href="/reminders">
              {tx(W.backToList)}
            </Btn>
          ) : null
        }
        mAction={
          isList && perms.queue ? (
            <Btn variant="soft" href="/reminders?view=wizard" style={{ height: 40, padding: "0 12px", fontSize: 13 }}>
              <Ic n="plus" size={16} />
              {tx(W.newShort)}
            </Btn>
          ) : null
        }
      />
      <main>{body}</main>
      {openRule ? <RuleSheet key={openRule.ruleKey} rule={openRule} canEdit={perms.rules} onClose={() => setRuleOpen(null)} /> : null}
    </VxPage>
  );
}
