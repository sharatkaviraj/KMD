"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { queueReminderAction } from "@/app/(app)/reminders/actions";
import { addDays } from "@/modules/receipts/vx/domain/day-close";
import {
  BANDS,
  DEFAULT_AUDIENCE,
  leftOutBy,
  messageCost,
  pickAudience,
  quotedAmount,
  SEND_TIMES,
  TEMPLATE_FIELDS,
  TEMPLATE_IDS,
  TEMPLATES,
  templateSegments,
  type AudienceFamily,
  type AudienceFilters,
  type ReminderLanguage,
  type SendTime,
  type TemplateId,
  type TemplateValues,
} from "@/modules/whatsapp/vx/domain/reminders";
import { dateLabel, dayMonth, rupees } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Chip, ChipRow, RadioCard, Seg, SwitchRow, WizardSteps } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Btn, Card, SecHead } from "@/vx/ui/primitives";

import type { RemindersProps } from "./types";
import { BAND_WORD, TIME_WORD, W } from "./words";

function valuesFor(f: AudienceFamily | undefined, filters: AudienceFilters, today: string): { hi: TemplateValues; en: TemplateValues } {
  const amount = rupees(f ? quotedAmount(f, filters) : 0);
  const student = f?.kidsLine.split(" · ")[0] ?? "—";
  const due = dateLabel(addDays(today, -10));
  const parent = f?.fatherName ?? "—";
  return { hi: { parent, student, amount, "due date": due }, en: { parent, student, amount, "due date": due } };
}

function Bubble({ body, values }: { body: string; values: TemplateValues }) {
  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      {templateSegments(body, values).map((s, i) =>
        s.field ? (
          <mark key={i} style={{ background: "var(--accs)", color: "inherit", borderRadius: 4, padding: "0 2px" }}>{s.text}</mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </div>
  );
}

function Preview({ template, language, values }: { template: TemplateId; language: ReminderLanguage; values: { hi: TemplateValues; en: TemplateValues } }) {
  const t = TEMPLATES[template];
  return (
    <div style={{ background: "var(--wabg)", borderRadius: 16, padding: 14 }}>
      <div style={{ maxWidth: "94%", background: "var(--wab)", color: "var(--wafg)", borderRadius: "4px 14px 14px 14px", padding: "9px 12px", fontSize: 14, lineHeight: 1.45, display: "flex", flexDirection: "column", gap: 8 }}>
        {language !== "en" ? <Bubble body={t.hi} values={values.hi} /> : null}
        {language !== "hi" ? <Bubble body={t.en} values={values.en} /> : null}
        <div style={{ fontSize: 12, opacity: 0.7 }}>फीस जमा करें · Pay fee</div>
      </div>
    </div>
  );
}

export function ReminderWizard(props: RemindersProps) {
  const { audience: all, today, step: initialStep } = props;
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(initialStep);
  const [filters, setFilters] = useState<AudienceFilters>(DEFAULT_AUDIENCE);
  const [template, setTemplate] = useState<TemplateId>("gentle");
  const [language, setLanguage] = useState<ReminderLanguage>("both");
  const [sampleIndex, setSampleIndex] = useState(0);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [day, setDay] = useState(addDays(today, 1));
  const [time, setTime] = useState<SendTime>("10");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const picked = useMemo(() => pickAudience(all, filters), [all, filters]);
  const money = picked.reduce((s, f) => s + quotedAmount(f, filters), 0);
  const cost = messageCost(picked.length);
  const sample = picked[sampleIndex % Math.max(1, picked.length)];
  const values = valuesFor(sample, filters, today);
  const leftOut = {
    promised: leftOutBy(all, filters, "promised"),
    paid: leftOutBy(all, filters, "paid"),
    left: leftOutBy(all, filters, "left"),
  };
  const set = (patch: Partial<AudienceFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleBand = (b: number) => set({ bands: filters.bands.includes(b) ? filters.bands.filter((x) => x !== b) : [...filters.bands, b].sort() });

  function queue() {
    setError(null);
    start(async () => {
      const res = await queueReminderAction({ audience: filters, template, language, scheduleDay: when === "later" ? day : null, scheduleTime: when === "later" ? time : null });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirm(false);
      toast.show({ text: tx(W.sendingTitle), tone: "info" });
      router.push(`/reminders?view=sending&batch=${res.id}`);
    });
  }

  const countCard = (
    <Card style={{ display: "flex", flexDirection: "column", gap: 6, background: "var(--accs)" }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{tx(W.goesTo)}</span>
      <strong className="num" style={{ fontSize: 24 }}>
        {picked.length} {tx(W.families)} · {tx(W.about)} {rupees(cost)}
      </strong>
      <span style={{ fontSize: 13, color: "var(--mut)" }}>{rupees(money)} · {filters.pendingToday ? tx(W.pendingToday).toLowerCase() : ""}</span>
      {sample ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.sample)}: {sample.fatherName} · {sample.kidsLine}</span> : <span style={{ fontSize: 13 }}>{tx(W.nobody)}</span>}
    </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <WizardSteps steps={[tx(W.stepWho), tx(W.stepMessage), tx(W.stepCheck)]} current={step - 1} />

      {step === 1 ? (
        <>
          <ChipRow label={tx(W.stepWho)}>
            <Chip on={filters.pendingToday} onClick={() => set({ pendingToday: !filters.pendingToday })}>{tx(W.pendingToday)}</Chip>
            <Chip on={filters.inst2} onClick={() => set({ inst2: !filters.inst2 })}>{tx(W.inst2)}</Chip>
            <Chip on={filters.big} onClick={() => set({ big: !filters.big })}>{tx(W.over10k)}</Chip>
            <Chip on={filters.bus} icon="bus" onClick={() => set({ bus: !filters.bus })}>{tx(W.hasBus)}</Chip>
          </ChipRow>
          <SecHead>{tx(W.classes)}</SecHead>
          <ChipRow label={tx(W.classes)}>
            <Chip on={filters.bands.length === 0} onClick={() => set({ bands: [] })}>{tx(W.allClasses)}</Chip>
            {BANDS.map((_, i) => (
              <Chip key={i} on={filters.bands.includes(i)} onClick={() => toggleBand(i)}>{tx(BAND_WORD[i])}</Chip>
            ))}
          </ChipRow>
          <SecHead>{tx(W.leaveOut)}</SecHead>
          <Card pad={false}>
            <SwitchRow title={tx(W.lPromised)} sub={`${leftOut.promised} ${tx(W.families)}`} on={filters.excludePromised} onChange={(v) => set({ excludePromised: v })} />
            <SwitchRow title={tx(W.lPaid)} sub={`${leftOut.paid} ${tx(W.families)}`} on={filters.excludePaidRecently} onChange={(v) => set({ excludePaidRecently: v })} />
            <SwitchRow title={tx(W.lLeft)} sub={`${leftOut.left} ${tx(W.families)}`} on={filters.excludeLeft} onChange={(v) => set({ excludeLeft: v })} />
          </Card>
          {countCard}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn variant="sec" href="/reminders">{tx(W.close)}</Btn>
            <Btn variant="pri" icon="arrowRight" disabled={picked.length === 0} onClick={() => setStep(2)}>{tx(W.next)}</Btn>
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <SecHead>{tx(W.template)}</SecHead>
          {TEMPLATE_IDS.map((id) => (
            <RadioCard key={id} name="template" checked={template === id} onSelect={() => setTemplate(id)} title={<Bi {...TEMPLATES[id].label} />} sub={tx(TEMPLATES[id].sub)} />
          ))}
          <SecHead>{tx(W.language)}</SecHead>
          <Seg<ReminderLanguage>
            label={tx(W.language)}
            value={language}
            onChange={setLanguage}
            options={[
              { value: "both", label: tx(W.langBoth) },
              { value: "hi", label: tx(W.langHi) },
              { value: "en", label: tx(W.langEn) },
            ]}
          />
          <span style={{ fontSize: 13, color: "var(--mut)" }}>
            {tx(W.filledIn)}: {TEMPLATE_FIELDS.map((f) => `{${f}}`).join(" ")}
          </span>
          <SecHead
            action={
              picked.length > 1 ? (
                <Btn variant="ghost" icon="refresh" onClick={() => setSampleIndex((i) => i + 1)}>{tx(W.previewAs)} · {picked[(sampleIndex + 1) % picked.length]?.fatherName}</Btn>
              ) : undefined
            }
          >
            {tx(W.previewHi)}
          </SecHead>
          <Preview template={template} language={language} values={values} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn variant="sec" icon="chevLeft" onClick={() => setStep(1)}>{tx(W.back)}</Btn>
            <Btn variant="pri" icon="arrowRight" onClick={() => setStep(3)}>{tx(W.next)}</Btn>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <Card style={{ display: "flex", flexDirection: "column" }}>
            {[
              [tx(W.who), `${picked.length} ${tx(W.families)} · ${rupees(money)}`],
              [tx(W.leftOut), `${tx(W.lPromised)} ${leftOut.promised} · ${tx(W.lPaid)} ${leftOut.paid} · ${tx(W.lLeft)} ${leftOut.left}`],
              [tx(W.message), `${tx(TEMPLATES[template].label)} · ${language === "both" ? tx(W.langBoth) : language === "hi" ? tx(W.langHi) : tx(W.langEn)}`],
              [tx(W.cost), `${picked.length} ${tx(W.messages)} · ${tx(W.about)} ${rupees(cost)}`],
            ].map(([k, v], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <span style={{ color: "var(--mut)" }}>{k}</span>
                <span style={{ textAlign: "right", fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </Card>
          <SecHead>{tx(W.when)}</SecHead>
          <Seg<"now" | "later"> label={tx(W.when)} value={when} onChange={setWhen} options={[{ value: "now", label: tx(W.sendNow) }, { value: "later", label: tx(W.schedule) }]} />
          {when === "later" ? (
            <>
              <ChipRow label={tx(W.when)}>
                {[1, 2, 3, 7].map((n) => {
                  const d = addDays(today, n);
                  return <Chip key={d} on={day === d} onClick={() => setDay(d)}>{dayMonth(d)}</Chip>;
                })}
              </ChipRow>
              <ChipRow label={tx(W.ruleTime)}>
                {SEND_TIMES.map((t) => (
                  <Chip key={t} on={time === t} onClick={() => setTime(t)}>{TIME_WORD[t]}</Chip>
                ))}
              </ChipRow>
            </>
          ) : null}
          <Card pad={false}>
            <SwitchRow title={tx(W.testFirst)} sub={tx(W.testNote)} on={false} onChange={() => router.push("/fees/reminders")} icon="phone" />
          </Card>
          {countCard}
          {error ? <Banner tone="bad">{error}</Banner> : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn variant="sec" icon="chevLeft" onClick={() => setStep(2)}>{tx(W.back)}</Btn>
            <Btn variant="pri" icon="send" disabled={!props.perms.queue || picked.length === 0} onClick={() => setConfirm(true)}>{tx(W.queue)}</Btn>
          </div>
        </>
      ) : null}

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        icon="send"
        title={tx(W.confirmTitle)}
        footer={
          <>
            <Btn variant="sec" full onClick={() => setConfirm(false)}>{tx(W.back)}</Btn>
            <Btn variant="pri" full disabled={busy} onClick={queue}>{tx(W.queue)}</Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
            {[
              [tx(W.families).replace(/^./, (c) => c.toUpperCase()), String(picked.length)],
              [tx(W.cost), rupees(cost)],
              [tx(W.balanceAfter), tx(W.notKnown)],
            ].map(([k, v]) => (
              <Card key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{k}</span>
                <strong className="num">{v}</strong>
              </Card>
            ))}
          </div>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.confirmNote)}</span>
          {error ? <Banner tone="bad">{error}</Banner> : null}
        </div>
      </Sheet>
    </div>
  );
}
