"use client";

import { Fragment, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { queueReminderAction } from "@/app/(app)/reminders/actions";
import { addDays } from "@/modules/receipts/vx/domain/day-close";
import {
  BANDS,
  COST_PER_MESSAGE,
  DEFAULT_AUDIENCE,
  audienceLine,
  leftOutBy,
  messageCost,
  pickAudience,
  quotedAmount,
  SEND_TIMES,
  TEMPLATE_IDS,
  TEMPLATES,
  templateSegments,
  type AudienceFamily,
  type AudienceFilters,
  type ReminderLanguage,
  type SendTime,
  type TemplateField,
  type TemplateId,
  type TemplateValues,
} from "@/modules/whatsapp/vx/domain/reminders";
import { rupees } from "@/vx/format";
import { useVx, type Pair } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";

import { ChipBtn, dayShort, RadioRow, SegRow, SwitchKnob } from "./bits";
import type { RemindersProps } from "./types";
import { BAND_WORD, TIME_WORD, W } from "./words";

const V = (x: string) => `var(--${x})`;
const delay = (i: number) => `${Math.min(i, 12) * 40}ms`;

const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

type Highlight = TemplateField | "pay link" | "";
const FIELD_CHIPS: Highlight[] = ["parent", "student", "amount", "due date", "pay link"];

/**
 * The preview's "due date" is the family's own oldest overdue date, the one the
 * queued message carries (messages/domain/outbox.ts). It used to be today − 10
 * for everyone, so a family 200 days overdue read "pending since 27 Oct" (TEST
 * school day, 6 Nov 2026, accountant B9). The upcoming template names the next
 * due date, which the audience does not carry, so its preview leaves it blank
 * rather than invent one.
 */
function valuesFor(f: AudienceFamily | undefined, filters: AudienceFilters, today: string, template: TemplateId): { hi: TemplateValues; en: TemplateValues } {
  const amount = rupees(f ? quotedAmount(f, filters) : 0);
  const kids = (f?.kidsLine ?? "—").split(", ").map((k) => k.split(" · ")[0]);
  const days = f?.daysOverdue ?? 0;
  const parent = f?.fatherName ?? "—";
  if (template === "upcoming" || days <= 0) {
    return {
      hi: { parent, student: kids.join(" और "), amount, "due date": "—" },
      en: { parent, student: kids.join(" and "), amount, "due date": "—" },
    };
  }
  const [, m, d] = addDays(today, -days).split("-").map(Number);
  return {
    hi: { parent, student: kids.join(" और "), amount, "due date": `${d} ${MONTH_HI[m - 1]}` },
    en: { parent, student: kids.join(" and "), amount, "due date": `${d} ${MONTH_EN[m - 1]}` },
  };
}

function Bubble({ body, values, hl }: { body: string; values: TemplateValues; hl: Highlight }) {
  return (
    <p>
      {templateSegments(body, values).map((s, i) => (
        <span key={i} style={{ background: s.field ? (hl === s.field ? "rgba(var(--heat), .42)" : "rgba(var(--heat), .12)") : "transparent" }}>
          {s.text}
        </span>
      ))}
    </p>
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
  const [hl, setHl] = useState<Highlight>(initialStep === 2 ? "amount" : "");
  const [sampleIndex, setSampleIndex] = useState(0);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [day, setDay] = useState(addDays(today, 1));
  const [time, setTime] = useState<SendTime>("10");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const picked = useMemo(() => pickAudience(all, filters), [all, filters]);
  const count = picked.length;
  const money = picked.reduce((s, f) => s + quotedAmount(f, filters), 0);
  const cost = messageCost(count);
  const pi = count ? ((sampleIndex % count) + count) % count : 0;
  const sample = picked[pi];
  const values = valuesFor(sample, filters, today, template);
  const leftOut = {
    promised: leftOutBy(all, filters, "promised"),
    paid: leftOutBy(all, filters, "paid"),
    left: leftOutBy(all, filters, "left"),
  };
  const set = (patch: Partial<AudienceFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleBand = (b: number) => set({ bands: filters.bands.includes(b) ? filters.bands.filter((x) => x !== b) : [...filters.bands, b].sort() });
  const tpl = TEMPLATES[template];
  const langName = tx(language === "both" ? W.langBoth : language === "hi" ? W.langHiOnly : W.langEnOnly);
  const later = when === "later";
  const whenTxt = `${dayShort(day)}, ${TIME_WORD[time]}`;
  const audLine = audienceLine(filters);
  const steps: [Pair, Pair][] = [
    [W.stepWho, W.stepWhoSub],
    [W.stepMessage, W.stepMessageSub],
    [W.stepCheck, W.stepCheckSub],
  ];

  function queue() {
    setError(null);
    start(async () => {
      const res = await queueReminderAction({ audience: filters, template, language, scheduleDay: later ? day : null, scheduleTime: later ? time : null });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirm(false);
      toast.show({ text: `${tx(W.sending)} · ${count} ${tx(W.families)}`, tone: "info" });
      router.push(`/reminders?view=sending&batch=${res.id}`);
    });
  }

  function next() {
    if (!count) return;
    if (step < 3) setStep((step + 1) as 2 | 3);
    else setConfirm(true);
  }

  const leaveOut: { key: "excludePromised" | "excludePaidRecently" | "excludeLeft"; label: Pair; sub: Pair; n: number }[] = [
    { key: "excludePromised", label: W.lPromised, sub: W.lPromisedSub, n: leftOut.promised },
    { key: "excludePaidRecently", label: W.lPaidRecent, sub: W.lPaidSub, n: leftOut.paid },
    { key: "excludeLeft", label: W.lLeft, sub: W.lLeftSub, n: leftOut.left },
  ];
  const leftOutLine =
    [
      filters.excludePromised ? `${leftOut.promised} ${tx(W.promisedShort)}` : null,
      filters.excludePaidRecently ? `${leftOut.paid} ${tx(W.paidShort)}` : null,
      filters.excludeLeft ? `${leftOut.left} ${tx(W.leftShort)}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || tx(W.nobodyLeftOut);
  const review: { icon: IconName; k: Pair; v: string; go?: 1 | 2 }[] = [
    { icon: "users", k: W.who, v: `${count} ${tx(W.families)} · ${audLine}`, go: 1 },
    { icon: "filter", k: W.leftOut, v: leftOutLine, go: 1 },
    { icon: "message", k: W.message, v: `${tx(tpl.label)} · ${langName}`, go: 2 },
    { icon: "rupee", k: W.cost, v: `${count} × ₹${COST_PER_MESSAGE} = ${tx(W.about)} ${rupees(cost)}` },
    { icon: "database", k: W.balanceAfter, v: tx(W.notKnown) },
  ];
  const nextLabel = step === 3 ? `${tx(later ? W.scheduleFor : W.queueFor)} ${count} ${tx(W.families)}` : tx(W.next);
  const days = [0, 1, 2, 3].map((n) => addDays(today, n));

  let content: ReactNode = null;
  if (step === 1) {
    content = (
      <div className="stack fadein" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div className="rm-c" style={{ gap: 14 }}>
          <div className="card rm-c" style={{ padding: "16px 18px", gap: 10 }}>
            <span className="sech">{tx(W.whoGetsIt)}</span>
            <div className="rm-f" style={{ flexWrap: "wrap", gap: 6 }}>
              <ChipBtn on={filters.pendingToday} onClick={() => set({ pendingToday: !filters.pendingToday })}>
                {tx(W.pendingToday)}
              </ChipBtn>
              <ChipBtn on={filters.inst2} onClick={() => set({ inst2: !filters.inst2 })}>
                {tx(W.inst2)}
              </ChipBtn>
              <ChipBtn on={filters.big} onClick={() => set({ big: !filters.big })}>
                {tx(W.over10k)}
              </ChipBtn>
              <ChipBtn on={filters.bus} onClick={() => set({ bus: !filters.bus })}>
                {tx(W.hasBus)}
              </ChipBtn>
            </div>
            <span className="rm-m">{tx(W.pendingExplain)}</span>
            <span className="sech" style={{ marginTop: 6 }}>
              {tx(W.classes)}
            </span>
            <div className="rm-f" style={{ flexWrap: "wrap", gap: 6 }}>
              <ChipBtn on={filters.bands.length === 0} onClick={() => set({ bands: [] })}>
                {tx(W.allClasses)}
              </ChipBtn>
              {BANDS.map((_, i) => (
                <ChipBtn key={i} on={filters.bands.includes(i)} onClick={() => toggleBand(i)}>
                  {tx(BAND_WORD[i])}
                </ChipBtn>
              ))}
            </div>
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="rm-c" style={{ padding: "14px 18px 6px" }}>
              <span className="sech">{tx(W.leaveOut)}</span>
            </div>
            {leaveOut.map((x) => {
              const on = filters[x.key];
              return (
                <button
                  key={x.key}
                  type="button"
                  className="tap rm-sw row"
                  role="switch"
                  aria-checked={on}
                  onClick={() => set({ [x.key]: !on })}
                  style={{ borderTop: "1px solid var(--bd)", padding: "12px 18px" }}
                >
                  <span className="rm-c" style={{ flex: 1 }}>
                    <span className="rm-b">{tx(x.label)}</span>
                    <span className="rm-m">{tx(x.sub)}</span>
                  </span>
                  <span className="pill num" style={{ background: "var(--s2)", color: "var(--mut)" }}>
                    {on ? `−${x.n}` : tx(W.included)}
                  </span>
                  <SwitchKnob on={on} />
                </button>
              );
            })}
          </div>
        </div>
        <div className="card rm-c unstick" style={{ position: "sticky", top: 80, padding: 18, gap: 12 }}>
          <span className="sech">{tx(W.goesTo)}</span>
          <div className="rm-f" style={{ alignItems: "baseline", gap: 10, flexWrap: "wrap", minHeight: 46 }}>
            <span key={count} className="num" style={{ fontSize: 38, fontWeight: 700, letterSpacing: "-0.02em", animation: "xPopIn .45s var(--spring) both" }}>
              {count}
            </span>
            <span className="rm-v">{tx(W.families)}</span>
            <span className="num rm-m" style={{ fontSize: 14 }}>
              · {tx(W.about)} {rupees(cost)}
            </span>
          </div>
          <div className="rm-fb" style={{ height: 10 }}>
            <span style={{ width: `${all.length ? Math.round((count / all.length) * 100) : 0}%`, background: "var(--acc)", transition: "width .5s var(--ease)" }} />
          </div>
          <span className="rm-m">
            {count} {tx(W.of)} {all.length} {tx(W.onTheList)}
          </span>
          {count ? (
            <span className="sech" style={{ marginTop: 4 }}>
              {tx(W.fewOfThem)}
            </span>
          ) : null}
          {picked.slice(0, 4).map((f, i) => (
            <div key={f.key} className="rm-f" style={{ gap: 10, padding: "6px 0", borderTop: i ? "1px solid var(--bd)" : 0, animation: "xIn .3s var(--ease) both", animationDelay: delay(i) }}>
              <span className="rm-c" style={{ flex: 1 }}>
                <span className="rm-e rm-b">{f.fatherName}</span>
                <span className="rm-e rm-m">{f.kidsLine}</span>
              </span>
              <span className="num" style={{ fontWeight: 700 }}>
                {rupees(quotedAmount(f, filters))}
              </span>
            </div>
          ))}
          {count === 0 ? (
            <span className="rm-in" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>
              {tx(W.nobody)}
            </span>
          ) : null}
          {count ? <span className="rm-m">{rupees(money)}</span> : null}
        </div>
      </div>
    );
  } else if (step === 2) {
    content = (
      <div className="stack fadein" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div className="rm-c" style={{ gap: 14 }}>
          <div className="card rm-c" style={{ padding: "16px 18px", gap: 8 }} role="radiogroup" aria-label={tx(W.approvedTemplate)}>
            <span className="sech">{tx(W.approvedTemplate)}</span>
            {TEMPLATE_IDS.map((id) => (
              <RadioRow
                key={id}
                on={template === id}
                onPick={() => setTemplate(id)}
                label={tx(TEMPLATES[id].label)}
                sub={tx(TEMPLATES[id].sub)}
                trail={
                  <span className="pill" style={{ background: "var(--oks)", color: "var(--ok)" }}>
                    {tx(W.approved)}
                  </span>
                }
              />
            ))}
          </div>
          <div className="card rm-c" style={{ padding: "16px 18px", gap: 10 }}>
            <span className="sech">{tx(W.language)}</span>
            <SegRow<ReminderLanguage>
              label={tx(W.language)}
              value={language}
              onPick={setLanguage}
              options={[
                { value: "both", label: tx(W.langBoth) },
                { value: "hi", label: tx(W.langHi) },
                { value: "en", label: tx(W.langEn) },
              ]}
            />
            <span className="sech" style={{ marginTop: 6 }}>
              {tx(W.filledIn)}
            </span>
            <div className="rm-f" style={{ flexWrap: "wrap", gap: 6 }}>
              {FIELD_CHIPS.map((f) => (
                <ChipBtn key={f} on={hl === f} onClick={() => setHl(hl === f ? "" : f)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{`{${f}}`}</ChipBtn>
              ))}
            </div>
            <span className="rm-m">{tx(W.tapField)}</span>
          </div>
        </div>
        <div className="card rm-c unstick" style={{ position: "sticky", top: 80, padding: "16px 18px", gap: 10 }}>
          <div className="rm-f" style={{ justifyContent: "space-between" }}>
            <span className="sech">{tx(W.previewHi)}</span>
            <span className="rm-f" style={{ gap: 4 }}>
              <button type="button" className="tap btn ghost" aria-label={tx(W.prevFamily)} onClick={() => setSampleIndex((i) => i - 1)} style={{ width: 36, height: 36, padding: 0 }}>
                <Ic n="chevLeft" />
              </button>
              <span className="num rm-m" style={{ minWidth: 54, textAlign: "center" }}>
                {count ? pi + 1 : 0} {tx(W.of)} {count}
              </span>
              <button type="button" className="tap btn ghost" aria-label={tx(W.nextFamily)} onClick={() => setSampleIndex((i) => i + 1)} style={{ width: 36, height: 36, padding: 0 }}>
                <Ic n="chevRight" />
              </button>
            </span>
          </div>
          <span className="rm-m">
            {tx(W.previewAs)} <b style={{ color: "var(--fg)" }}>{sample?.fatherName ?? "—"}</b>
          </span>
          <div className="rm-wa">
            <div className="rm-wb" key={`${template}-${language}-${pi}`}>
              {language !== "en" ? <Bubble body={tpl.hi} values={values.hi} hl={hl} /> : null}
              {language === "both" ? <hr /> : null}
              {language !== "hi" ? <Bubble body={tpl.en} values={values.en} hl={hl} /> : null}
              <small>10:00 am</small>
            </div>
            <span
              className="rm-wb rm-f"
              style={{
                flexDirection: "row",
                justifyContent: "center",
                width: "94%",
                borderRadius: 10,
                padding: 9,
                color: "var(--info)",
                fontWeight: 600,
                background: hl === "pay link" ? "rgba(var(--heat), .42)" : "var(--wab)",
              }}
            >
              <Ic n="link" size={15} />
              फीस जमा करें · Pay fee
            </span>
          </div>
          <span className="rm-m">{tx(W.noLateFee)}</span>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="stack fadein" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="rm-c" style={{ padding: "14px 18px 8px" }}>
            <span className="sech">{tx(W.checkBefore)}</span>
          </div>
          {review.map((x, i) => {
            const inner = (
              <>
                <Ic n={x.icon} style={{ color: "var(--acc)" }} />
                <span className="rm-c">
                  <span className="rm-m">{tx(x.k)}</span>
                  <span className="rm-b">{x.v}</span>
                </span>
                <span className="rm-m">{x.go ? tx(W.change) : ""}</span>
              </>
            );
            const st: React.CSSProperties = {
              display: "grid",
              gridTemplateColumns: "30px minmax(0, 1fr) auto",
              gap: 12,
              alignItems: "center",
              width: "100%",
              padding: "12px 18px",
              borderTop: "1px solid var(--bd)",
              animation: "xIn .3s var(--ease) both",
              animationDelay: delay(i),
            };
            return x.go ? (
              <button key={x.k.en} type="button" className="tap row rm-nb" onClick={() => setStep(x.go!)} style={st}>
                {inner}
              </button>
            ) : (
              <div key={x.k.en} className="rm-nb" style={st}>
                {inner}
              </div>
            );
          })}
        </div>
        <div className="rm-c" style={{ gap: 14 }}>
          <div className="card rm-c" style={{ padding: "16px 18px", gap: 10 }}>
            <span className="sech">{tx(W.when)}</span>
            <SegRow<"now" | "later">
              label={tx(W.when)}
              value={when}
              onPick={setWhen}
              options={[
                { value: "now", label: tx(W.sendNow) },
                { value: "later", label: tx(W.schedule) },
              ]}
            />
            {later ? (
              <div className="rm-c fadein" style={{ gap: 8 }}>
                <div className="rm-f" style={{ flexWrap: "wrap", gap: 6 }}>
                  {days.map((d) => (
                    <ChipBtn key={d} on={day === d} onClick={() => setDay(d)}>
                      {dayShort(d)}
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
              </div>
            ) : null}
            <span className="rm-m">{later ? `${tx(W.laterLine)} ${whenTxt}. ${tx(W.laterTail)}` : tx(W.nowLine)}</span>
          </div>
          <div className="card rm-f" style={{ padding: "14px 18px", gap: 12 }}>
            <span className="rm-c" style={{ flex: 1 }}>
              <span className="rm-b">{tx(W.testFirst)}</span>
              <span className="rm-m">{tx(W.testNote)}</span>
            </span>
            <Btn variant="sec" href="/fees/reminders" style={{ padding: "0 12px", fontSize: 13 }}>
              <Ic n="phone" size={16} />
              {tx(W.sendTest)}
            </Btn>
          </div>
          {error ? <Banner tone="bad">{error}</Banner> : null}
        </div>
      </div>
    );
  }

  const cfName = `${tx(tpl.label)} · ${filters.pendingToday ? tx(W.pendingToday).toLowerCase() : audLine}`;

  return (
    <>
      <TopBar
        crumb={tx(W.crumbShort)}
        title={tx(W.newReminder)}
        mSub={`${tx(W.stepN(step))} · ${tx(steps[step - 1][0])}`}
        mBack="/reminders"
        actions={
          <Btn variant="ghost" icon="chevLeft" href="/reminders">
            {tx(W.cancel)}
          </Btn>
        }
      />
      <main>
        <div className="rm-wiz">
          <div className="pad rm-c" style={{ flex: 1, padding: "18px 28px 24px", gap: 16 }}>
            <div className="card rm-f" style={{ padding: "14px 18px", gap: 0 }}>
              {steps.map(([label, sub], i) => {
                const n = i + 1;
                const done = n < step;
                const cur = n === step;
                return (
                  <Fragment key={label.en}>
                    <button
                      type="button"
                      className="tap rm-nb rm-f"
                      onClick={() => (n < step ? setStep(n as 1 | 2) : undefined)}
                      style={{ gap: 10, flex: "none" }}
                      aria-current={cur ? "step" : undefined}
                    >
                      <span
                        className="rm-st"
                        style={{ background: done ? V("acc") : cur ? V("pri") : V("s3"), color: done || cur ? V("prifg") : V("mut"), boxShadow: cur ? "0 0 0 4px var(--accs)" : "none" }}
                      >
                        {done ? <Ic n="check" size={16} stroke={3} style={{ animation: "xPopIn .4s var(--spring) both" }} /> : n}
                      </span>
                      <span className={`rm-c${cur ? "" : " hide-m"}`}>
                        <span className="rm-b" style={{ color: cur || done ? V("fg") : V("mut") }}>
                          {tx(label)}
                        </span>
                        <span className="rm-m hide-m">{tx(sub)}</span>
                      </span>
                    </button>
                    {n < 3 ? (
                      <span style={{ flex: 1, minWidth: 12, height: 3, margin: "0 10px", borderRadius: 2, background: "var(--s3)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: 3, width: done ? "100%" : "0%", background: "var(--acc)", transition: "width .5s var(--ease)" }} />
                      </span>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
            {content}
          </div>
          <div className="glass pad rm-f rm-foot">
            {step === 1 ? (
              <Btn variant="sec" icon="chevLeft" href="/reminders">
                {tx(W.cancel)}
              </Btn>
            ) : (
              <Btn variant="sec" icon="chevLeft" onClick={() => setStep((step - 1) as 1 | 2)}>
                {tx(W.back)}
              </Btn>
            )}
            <span className="rm-m num hide-m" style={{ flex: 1, textAlign: "center" }}>
              {count} {tx(W.families)} · {tx(W.about)} {rupees(cost)} · {tx(tpl.label)}
            </span>
            <span className="only-m" style={{ flex: 1 }} />
            <button type="button" className="tap btn pri" onClick={next} disabled={!count || (step === 3 && !props.perms.queue)} style={{ opacity: count ? 1 : 0.5 }}>
              {nextLabel}
              <Ic n={step === 3 ? "send" : "chevRight"} />
            </button>
          </div>
        </div>
      </main>

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`${tx(later ? W.confirmSchedule : W.confirmQueue)} ${count} ${tx(W.waMessages)}`}
        sub={cfName}
        footer={
          <>
            <button type="button" className="tap btn sec" onClick={() => setConfirm(false)} style={{ flex: 1 }}>
              {tx(W.notYet)}
            </button>
            <button type="button" className="tap btn pri" disabled={busy} onClick={queue} style={{ flex: 1.6 }}>
              <Ic n="send" />
              {tx(later ? W.scheduleAbout : W.queueAbout)} {rupees(cost)}
            </button>
          </>
        }
      >
        <div className="rm-c rm-lh" style={{ gap: 10, paddingTop: 4 }}>
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {[
              [W.familiesTile, String(count)],
              [W.cost, `${tx(W.about)} ${rupees(cost)}`],
              [W.balanceTile, tx(W.notKnownShort)],
            ].map(([k, v], i) => (
              <div key={(k as Pair).en} className="rm-tile" style={{ animation: "xPopIn .4s var(--spring) both", animationDelay: `${i * 80}ms` }}>
                <span className="rm-m">{tx(k as Pair)}</span>
                <span className="num" style={{ fontSize: i === 2 ? 15 : 22, fontWeight: 700 }}>
                  {v as string}
                </span>
              </div>
            ))}
          </div>
          {[`${count} ${tx(W.families)} · ${audLine}`, tx(W.cfHindiFirst), tx(W.cfLeftOut)].map((t) => (
            <span key={t} className="rm-f" style={{ fontSize: 13, alignItems: "flex-start" }}>
              <Ic n="check" size={16} style={{ color: "var(--acc)", marginTop: 1 }} />
              {t}
            </span>
          ))}
          <div className="rm-in" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>
            <Ic n="info" style={{ marginTop: 2 }} />
            <span>
              {later ? `${tx(W.laterNote)} ${whenTxt}. ${tx(W.laterNoteTail)} ` : ""}
              {tx(W.confirmNote)}
            </span>
          </div>
          {error ? <Banner tone="bad">{error}</Banner> : null}
        </div>
      </Sheet>
    </>
  );
}
