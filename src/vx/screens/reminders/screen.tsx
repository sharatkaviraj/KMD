"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cancelBatchAction, saveRuleAction } from "@/app/(app)/reminders/actions";
import { addDays } from "@/modules/receipts/vx/domain/day-close";
import { funnelRates, messageCost, SEND_TIMES, TEMPLATE_IDS, TEMPLATES, type SendTime, type TemplateId } from "@/modules/whatsapp/vx/domain/reminders";
import { ago, dayMonth, pct, rupees, shortDay } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import type { IconName } from "@/vx/icons";
import { Chip, ChipRow, RadioCard, Switch, SwitchRow } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, DataList, Grid, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState, IconTile, Kpi, ListRow, Pill, Progress, Ring, SecHead, Stat } from "@/vx/ui/primitives";

import type { RemindersProps, RuleRow } from "./types";
import { ReminderWizard } from "./wizard";
import { TIME_WORD, W } from "./words";

function timingWord(ruleKey: string, option: string, tx: (p: { en: string; hi?: string }) => string): string {
  if (option === "mon") return tx(W.everyMon);
  if (option === "thu") return tx(W.everyThu);
  if (option === "0") return tx(W.onTheDay);
  return `${option} ${tx(ruleKey === "after_due" ? W.daysAfter : W.daysBefore)}`;
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

  function save() {
    setError(null);
    start(async () => {
      const res = await saveRuleAction({ ruleKey: rule.ruleKey, enabled, timingChoice: timing, sendTime: time, audience, template, quietHours: quiet });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.show({ text: tx(W.saved) });
      onClose();
      router.refresh();
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      icon={rule.icon as IconName}
      title={title}
      sub={`${enabled ? tx(W.on) : tx(W.off)} · ${timingWord(rule.ruleKey, timing, tx)} · ${TIME_WORD[time]}`}
      footer={
        <>
          <Btn variant="sec" full onClick={onClose}>{tx(W.close)}</Btn>
          <Btn variant="pri" full disabled={!canEdit || busy} onClick={save}>{tx(W.save)}</Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!canEdit ? <Banner tone="info">{tx(W.adminOnly)}</Banner> : null}
        <Card pad={false}>
          <SwitchRow title={title} sub={enabled ? tx(W.on) : tx(W.off)} on={enabled} onChange={setEnabled} icon={rule.icon as IconName} />
        </Card>
        <SecHead>{tx(W.ruleWhen)}</SecHead>
        <ChipRow label={tx(W.ruleWhen)}>
          {rule.timingOptions.map((o) => (
            <Chip key={o} on={timing === o} onClick={() => setTiming(o)}>{timingWord(rule.ruleKey, o, tx)}</Chip>
          ))}
        </ChipRow>
        <ChipRow label={tx(W.ruleTime)}>
          {SEND_TIMES.map((t) => (
            <Chip key={t} on={time === t} onClick={() => setTime(t)}>{TIME_WORD[t]}</Chip>
          ))}
        </ChipRow>
        <SecHead>{tx(W.ruleWho)}</SecHead>
        <RadioCard name="rule-who" checked={audience === "all"} onSelect={() => setAudience("all")} title={tx(W.everyoneApplies)} />
        <RadioCard name="rule-who" checked={audience === "skip_promised"} onSelect={() => setAudience("skip_promised")} title={tx(W.skipPromised)} />
        <SecHead>{tx(W.message)}</SecHead>
        <ChipRow label={tx(W.message)}>
          {TEMPLATE_IDS.map((id) => (
            <Chip key={id} on={template === id} onClick={() => setTemplate(id)}>{tx(TEMPLATES[id].label)}</Chip>
          ))}
        </ChipRow>
        <Card pad={false}>
          <SwitchRow title={tx(W.quietSwitch)} sub={tx(W.quiet)} on={quiet} onChange={setQuiet} icon="moon" />
        </Card>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.autoNote)}</span>
        {error ? <Banner tone="bad">{error}</Banner> : null}
      </div>
    </Sheet>
  );
}

export function RemindersScreen(props: RemindersProps) {
  const { view, runs, batches, rules, batch, result, perms } = props;
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [ruleOpen, setRuleOpen] = useState<string | null>(props.ruleOpen);

  const since = addDays(props.today, -30);
  const recent = runs.filter((r) => r.startedAt >= since);
  const sent = recent.reduce((s, r) => s + r.messaged, 0);
  const delivered = recent.reduce((s, r) => s + r.delivered, 0);
  const read = recent.reduce((s, r) => s + r.read, 0);
  const paid = recent.reduce((s, r) => s + r.familiesPaid, 0);
  const collected = recent.reduce((s, r) => s + r.moneyCollected, 0);
  const openRule = rules.find((r) => r.ruleKey === ruleOpen) ?? null;

  const newBtn = perms.queue ? <Btn variant="pri" icon="plus" href="/reminders?view=wizard">{tx(W.newReminder)}</Btn> : null;

  let body: React.ReactNode;
  if (view === "wizard") {
    body = <ReminderWizard {...props} />;
  } else if (view === "sending" && batch) {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Ring value={0} max={Math.max(1, batch.familyCount)} size={88} stroke={9}>
            <span className="num" style={{ fontWeight: 700 }}>0/{batch.familyCount}</span>
          </Ring>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <strong className="serif" style={{ fontSize: 20 }}>{batch.status === "cancelled" ? tx(W.cancelled) : batch.status === "scheduled" ? `${tx(W.scheduled)} · ${batch.scheduledFor ? `${shortDay(batch.scheduledFor)}` : ""}` : tx(W.sendingTitle)}</strong>
            <span style={{ color: "var(--mut)" }}>{batch.audienceLine} · {tx(TEMPLATES[batch.template].label)}</span>
          </span>
        </div>
        <Grid cols={4}>
          <Card><Stat label={tx(W.tQueued)} value={batch.status === "cancelled" ? 0 : batch.familyCount} /></Card>
          <Card><Stat label={tx(W.tSent)} value={0} /></Card>
          <Card><Stat label={tx(W.tDelivered)} value={0} /></Card>
          <Card><Stat label={tx(W.tFailed)} value={0} /></Card>
        </Grid>
        <Banner tone="info">{tx(W.sendingNote)}</Banner>
        <span style={{ color: "var(--mut)", fontSize: 13 }}>{rupees(batch.moneyQuoted)} · {tx(W.cost)} {tx(W.about)} {rupees(batch.costEstimate)}</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="sec" icon="chevLeft" href="/reminders">{tx(W.backToList)}</Btn>
          <Btn variant="sec" icon="send" href="/fees/reminders">{tx(W.openSender)}</Btn>
          {batch.status !== "cancelled" && perms.queue ? (
            <Btn
              variant="danger"
              icon="x"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const res = await cancelBatchAction(batch.id);
                  toast.show({ text: res.ok ? tx(W.batchCancelled) : res.error, tone: res.ok ? "info" : "bad" });
                  router.refresh();
                })
              }
            >
              {tx(W.cancelBatch)}
            </Btn>
          ) : null}
        </div>
      </div>
    );
  } else if (view === "results" && result) {
    const r = result.run;
    const rates = funnelRates({ sent: r.messaged, delivered: r.delivered, read: r.read, paid: r.familiesPaid });
    const cost = messageCost(r.messaged);
    const unread = Math.max(0, r.delivered - r.read);
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <SecHead>{r.name} · {shortDay(r.startedAt)}</SecHead>
        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            [tx(W.tSent), r.messaged, 100],
            [tx(W.tDelivered), r.delivered, rates.delivered],
            [tx(W.readRate), r.read, rates.read],
            [tx(W.paid7), r.familiesPaid, rates.paid],
          ].map(([k, n, rate]) => (
            <div key={String(k)} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{k}</span>
                <span className="num" style={{ fontWeight: 700 }}>{n} · {rate}%</span>
              </div>
              <Progress value={Number(n)} max={Math.max(1, r.messaged)} />
            </div>
          ))}
        </Card>
        <Grid cols={3}>
          <Card><Stat label={tx(W.paidAfter)} value={rupees(r.moneyCollected)} sub={`${r.familiesPaid} ${tx(W.families)}`} tone="var(--ok)" /></Card>
          <Card><Stat label={tx(W.cost)} value={rupees(cost)} sub={`${r.messaged} ${tx(W.messages)}`} /></Card>
          <Card><Stat label={tx(W.perRupee)} value={cost ? rupees(Math.round(r.moneyCollected / cost)) : "—"} /></Card>
        </Grid>
        {result.byClass.length ? (
          <>
            <SecHead>{tx(W.byClass)}</SecHead>
            <Card pad={false} style={{ overflow: "hidden" }}>
              <DataList
                rows={result.byClass}
                rowKey={(c) => c.classLabel}
                columns={[
                  { key: "c", label: tx(W.cls), cell: (c) => <strong>{c.classLabel}</strong> },
                  { key: "m", label: tx(W.tSent), align: "right", cell: (c) => <span className="num">{c.messaged}</span> },
                  { key: "q", label: tx(W.quoted), align: "right", cell: (c) => <span className="num">{rupees(c.quoted)}</span> },
                ]}
              />
            </Card>
          </>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {unread > 0 && perms.queue ? <Btn variant="pri" icon="refresh" href="/reminders?view=wizard">{tx(W.remindUnread)} ({unread})</Btn> : null}
          <Btn variant="sec" icon="chevLeft" href="/reminders">{tx(W.backToList)}</Btn>
        </div>
        {result.notDelivered.length ? (
          <>
            <SecHead>{result.notDelivered.length} {tx(W.notDelivered)}</SecHead>
            <Card pad={false} style={{ overflow: "hidden" }}>
              {result.notDelivered.map((n, i) => (
                <ListRow
                  key={`${n.studentId}-${i}`}
                  style={i === 0 ? { borderTop: 0 } : undefined}
                  title={n.studentName}
                  sub={n.error ?? undefined}
                  trail={<Btn variant="ghost" href={`/fees/students/${n.studentId}`}>{tx(W.fixNumber)}</Btn>}
                />
              ))}
            </Card>
          </>
        ) : null}
      </div>
    );
  } else if (view === "empty") {
    body = (
      <Card>
        <EmptyState icon="message" title={tx(W.emptyTitle)} body={tx(W.emptyBody)} action={newBtn} />
      </Card>
    );
  } else {
    body = (
      <>
        <Grid cols={4}>
          <Kpi label={tx(W.sent30)} value={sent} sub={`${recent.length} ${tx(W.remindersSent).toLowerCase()}`} icon="send" />
          <div className="card rise" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <Ring value={read} max={Math.max(1, delivered)} size={56} stroke={7}>
              <span className="num" style={{ fontWeight: 700, fontSize: 13 }}>{pct(read, delivered)}%</span>
            </Ring>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600 }}>{tx(W.readRate)}</span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{read}/{delivered}</span>
            </span>
          </div>
          <Kpi label={tx(W.paid7)} value={rupees(collected)} sub={`${paid} ${tx(W.families)}`} tone="var(--ok)" delay={80} />
          <Kpi label={tx(W.balance)} value="—" sub={tx(W.balanceSub)} delay={120} />
        </Grid>

        {batches.length ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SecHead>{tx(W.queued)} <span style={{ fontWeight: 500, color: "var(--mut)", textTransform: "none", letterSpacing: 0 }}>· {tx(W.queuedSub)}</span></SecHead>
            <Card pad={false} style={{ overflow: "hidden" }}>
              {batches.map((b, i) => (
                <ListRow
                  key={b.id}
                  style={i === 0 ? { borderTop: 0 } : undefined}
                  href={`/reminders?view=sending&batch=${b.id}`}
                  lead={<IconTile icon="inbox" tone={b.status === "cancelled" ? "mut" : "acc"} size={38} />}
                  title={b.name}
                  sub={`${b.familyCount} ${tx(W.families)} · ${rupees(b.costEstimate)} · ${b.createdByName ?? ""} · ${ago(b.createdAt)}`}
                  trail={<Pill tone={b.status === "cancelled" ? "mut" : b.status === "scheduled" ? "info" : "warn"}>{tx(b.status === "cancelled" ? W.cancelled : b.status === "scheduled" ? W.scheduled : W.tQueued)}</Pill>}
                />
              ))}
            </Card>
          </section>
        ) : null}

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SecHead>{tx(W.remindersSent)} <span style={{ fontWeight: 500, color: "var(--mut)", textTransform: "none", letterSpacing: 0 }}>· {tx(W.funnel)}</span></SecHead>
          {runs.length === 0 ? (
            <Card><EmptyState icon="send" title={tx(W.emptyTitle)} body={tx(W.emptyBody)} /></Card>
          ) : (
            <Card pad={false} style={{ overflow: "hidden" }}>
              {runs.map((r, i) => (
                <ListRow
                  key={r.runId}
                  style={i === 0 ? { borderTop: 0 } : undefined}
                  href={`/reminders?view=results&run=${r.runId}`}
                  lead={<IconTile icon="send" tone="pri" size={38} />}
                  title={r.name}
                  sub={`${dayMonth(r.startedAt)} · ${r.messaged} → ${r.delivered} → ${r.read} → ${r.familiesPaid}`}
                  trail={<span className="num" style={{ fontWeight: 700 }}>{rupees(r.moneyCollected)}</span>}
                />
              ))}
            </Card>
          )}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SecHead>{tx(W.auto)}</SecHead>
          <Card pad={false} style={{ overflow: "hidden" }}>
            {rules.map((rule, i) => (
              <div key={rule.ruleKey} className="row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <IconTile icon={rule.icon as IconName} tone={rule.enabled ? "acc" : "mut"} size={38} />
                <button type="button" className="tap" onClick={() => setRuleOpen(rule.ruleKey)} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: 0, padding: 0, color: "inherit" }}>
                  <Bi en={rule.titleEn} hi={rule.titleHi ?? undefined} />
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>
                    {timingWord(rule.ruleKey, rule.timingChoice, tx)} · {TIME_WORD[rule.sendTime] ?? rule.sendTime} · {tx(TEMPLATES[rule.template].label)}
                  </span>
                </button>
                <Switch on={rule.enabled} label={rule.titleEn} onChange={() => setRuleOpen(rule.ruleKey)} />
              </div>
            ))}
          </Card>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.quiet)} {tx(W.autoNote)}</span>
        </section>
      </>
    );
  }

  return (
    <VxPage>
      <TopBar
        crumb={<Bi {...W.crumb} block={false} />}
        title={tx(W.title)}
        mTitle={view === "wizard" ? tx(W.newReminder) : tx(W.title)}
        mBack={view === "list" || view === "empty" ? undefined : "/reminders"}
        actions={view === "list" ? newBtn : null}
        mAction={view === "list" && perms.queue ? <Btn variant="ghost" icon="plus" href="/reminders?view=wizard" ariaLabel={tx(W.newReminder)} /> : null}
      />
      <main>
        <Section gap={16}>{body}</Section>
      </main>
      {openRule ? <RuleSheet key={openRule.ruleKey} rule={openRule} canEdit={perms.rules} onClose={() => setRuleOpen(null)} /> : null}
    </VxPage>
  );
}
