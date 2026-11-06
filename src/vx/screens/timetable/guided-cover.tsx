"use client";

import Link from "@/ui/link";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";

import {
  checkGuidedCoverAction,
  confirmGuidedCoverAction,
  previewGuidedCoverAction,
  type GuidedConfirmResult,
  type GuidedPreviewResult,
  type GuidedSaved,
} from "@/app/(app)/substitutions/guided-actions";
import type { GuidedLesson, GuidedPreview, GuidedSetup } from "@/modules/substitutions/data/guided";
import { receiptSentence } from "@/modules/substitutions/domain/cover-state";
import {
  absencePeriods,
  isWholeDay,
  withChoice,
  type AbsenceSpanChoice,
  type GuidedChoice,
} from "@/modules/substitutions/domain/guided";
import {
  canConfirm,
  commandIdFor,
  guidedSave,
  initialSave,
  isBusy,
  type SaveEvent,
  type SaveState,
} from "@/modules/substitutions/domain/guided-flow";
import { tierLabels, warningLabels } from "@/modules/substitutions/domain/labels";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { Chip, ChipRow, Field, Input, RadioCard, Seg, Select, WizardSteps } from "@/vx/ui/controls";
import { Banner, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState, Pill } from "@/vx/ui/primitives";

import { addDay, bellTime, dayShort, spanPeriods } from "./domain/timetable";
import { G } from "./guided-text";

/*
 * Arrange cover, step by step (review C01), for the people who hold
 * substitutions:manage:
 *
 *   1. who is away, which day, all day or which periods;
 *   2. the lessons that leaves — in those periods only — each with everybody
 *      who could take it, why the rest cannot, and the covers they already
 *      carry; the coordinator can change any choice and the server works the
 *      day out again;
 *   3. a review of every assignment, everything else it moves, and who will
 *      get a WhatsApp message — then an explicit Confirm, the only write;
 *   4. the result as the server confirmed it, read back from the database.
 *
 * The save is the cover command, so a retry is the same command id and can
 * never commit twice, and a day that moved since the review is refused, said
 * plainly and read again (`guided-flow.ts`).
 */

export type GuidedInitial = {
  staffProfileId: string | null;
  periods: number[] | null;
  choices: GuidedChoice[];
  /** Open straight at the lessons step: a link or a draft named both who and when. */
  autoPreview: boolean;
  fromDraft: boolean;
  draftMissing: boolean;
};

type Subjects = Record<string, Pair>;
type ConfirmPayload = {
  commandId: string;
  day: string;
  dayRevision: number;
  staffProfileId: string;
  periods: number[];
  choices: GuidedChoice[];
  fingerprint: string;
};

const reduce = (state: SaveState<GuidedSaved>, event: SaveEvent<GuidedSaved>) => guidedSave(state, event);

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

const MUTED: CSSProperties = { fontSize: 13, color: "var(--mut)" };
const ROW: CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 };
const pn = (period: number) => `P${periodNumber(period)}`;
const FIRST_OPTIONS = 3;

function previewProblem(reason: Extract<GuidedPreviewResult, { ok: false }>["reason"]): Pair {
  if (reason === "no_timetable") return G.noTimetable;
  if (reason === "no_timetable_day") return G.noTimetableDay;
  if (reason === "no_session") return G.noSession;
  return G.loadFailed;
}

export function GuidedCoverScreen({
  setup,
  today,
  subjects,
  initial,
  previewing,
}: {
  setup: GuidedSetup | null;
  today: string;
  subjects: Subjects;
  initial: GuidedInitial;
  previewing: boolean;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const day = setup?.day ?? today;
  const teachers = setup?.teachers ?? [];
  const startTeacher = teachers.find((t) => t.id === initial.staffProfileId) ?? null;
  const startPeriods = initial.periods ?? startTeacher?.away ?? null;

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [staffId, setStaffId] = useState(startTeacher?.id ?? "");
  const [span, setSpan] = useState<AbsenceSpanChoice>(startPeriods && !isWholeDay(startPeriods) ? "periods" : "whole");
  const [picked, setPicked] = useState<number[]>(startPeriods ?? []);
  const [choices, setChoices] = useState<GuidedChoice[]>(initial.choices);
  const [preview, setPreview] = useState<GuidedPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<Pair | null>(null);
  const [formError, setFormError] = useState<Pair | null>(null);
  const [save, dispatch] = useReducer(reduce, undefined, () => initialSave<GuidedSaved>());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const seq = useRef(0);
  const inFlight = useRef(false);
  const lastPayload = useRef<ConfirmPayload | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const teacher = teachers.find((t) => t.id === staffId) ?? null;
  const periods = absencePeriods(span, picked);
  const busy = isBusy(save);
  const subjectName = (code: string) => tx(subjects[code] ?? { en: code });
  const bell = (period: number) => setup?.bells.find((b) => b.index === period);
  const spanPair = (list: readonly number[]): Pair => (isWholeDay(list) ? G.spanWhole : G.spanPeriods(list));
  const coverHref = `/timetable?view=subs&day=${day}`;

  // A new step is announced by moving focus to its heading (not on first load).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const loadPreview = async (nextChoices: GuidedChoice[], who = staffId, which = periods): Promise<boolean> => {
    if (!setup || !who || which.length === 0) return false;
    const mine = ++seq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await previewGuidedCoverAction({ day, staffProfileId: who, periods: which, choices: nextChoices });
      if (mine !== seq.current) return false;
      if (!result.ok) {
        setLoadError(previewProblem(result.reason));
        return false;
      }
      setPreview(result.preview);
      setChoices(result.preview.choices);
      return true;
    } catch {
      if (mine === seq.current) setLoadError(G.loadFailed);
      return false;
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };

  // A link or a draft that names who and when opens at the lessons step.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !initial.autoPreview || !startTeacher || !setup || setup.blocked) return;
    autoStarted.current = true;
    void loadPreview(initial.choices).then((ok) => {
      if (ok) setStep(1);
    });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickTeacher = (id: string) => {
    const next = teachers.find((t) => t.id === id) ?? null;
    setStaffId(id);
    setPicked(next?.away ?? []);
    setSpan(next?.away && !isWholeDay(next.away) ? "periods" : "whole");
    setChoices([]);
    setPreview(null);
    setFormError(null);
    dispatch({ type: "edited" });
  };

  const changeDay = (next: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next === day) return;
    router.push(`/substitutions/arrange?day=${next}${staffId ? `&staff=${staffId}` : ""}`);
  };

  const showLessons = async () => {
    if (!staffId) return setFormError(G.needTeacher);
    if (periods.length === 0) return setFormError(G.needPeriods);
    setFormError(null);
    dispatch({ type: "edited" });
    if (await loadPreview(choices)) setStep(1);
  };

  const choose = (needKey: string, value: string | null) => {
    if (busy || save.status === "saved") return;
    const next = withChoice(choices, needKey, value);
    setChoices(next);
    dispatch({ type: "edited" });
    void loadPreview(next);
  };

  const check = async (payload: ConfirmPayload) => {
    try {
      const result = await checkGuidedCoverAction({
        commandId: payload.commandId,
        day: payload.day,
        staffProfileId: payload.staffProfileId,
        periods: payload.periods,
      });
      if (result.status === "saved") {
        dispatch({ type: "check_saved", receipt: { receipt: result.receipt, committed: result.committed } });
        setStep(3);
      } else {
        dispatch({ type: "check_missing" });
      }
    } catch {
      dispatch({ type: "check_failed" });
    }
  };

  const send = async (payload: ConfirmPayload) => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastPayload.current = payload;
    dispatch({ type: "confirm", commandId: payload.commandId });
    try {
      let result: GuidedConfirmResult;
      try {
        result = await confirmGuidedCoverAction(payload);
      } catch {
        result = { status: "unknown" };
      }
      if (result.status === "saved") {
        dispatch({ type: "server_saved", receipt: { receipt: result.receipt, committed: result.committed } });
        setStep(3);
        router.refresh();
      } else if (result.status === "stale" || result.status === "plan_changed") {
        dispatch({ type: "server_moved", why: result.status });
        setPreview(null);
        await loadPreview(payload.choices, payload.staffProfileId, payload.periods);
        dispatch({ type: "proposal_loaded" });
      } else if (result.status === "refused") {
        dispatch({ type: "server_refused", reason: result.reason });
        if (result.reason === "refused_override" || result.reason === "invalid") {
          await loadPreview(payload.choices, payload.staffProfileId, payload.periods);
        }
      } else {
        dispatch({ type: "server_unknown" });
        await check(payload);
      }
    } finally {
      inFlight.current = false;
    }
  };

  const confirm = () => {
    if (!preview || loading || previewing || !canConfirm(save)) return;
    const retry = (save.status === "not_saved" || save.status === "unknown") && lastPayload.current;
    void send(
      retry
        ? lastPayload.current!
        : {
            commandId: commandIdFor(save, uuid),
            day,
            dayRevision: preview.dayRevision,
            staffProfileId: preview.staffProfileId,
            periods: preview.periods,
            choices: preview.choices,
            fingerprint: preview.fingerprint,
          },
    );
  };

  const checkAgain = () => {
    if (!lastPayload.current || inFlight.current) return;
    dispatch({ type: "check_start" });
    inFlight.current = true;
    void check(lastPayload.current).finally(() => {
      inFlight.current = false;
    });
  };

  const startAgain = () => {
    dispatch({ type: "reset" });
    setStep(0);
    setStaffId("");
    setPicked([]);
    setSpan("whole");
    setChoices([]);
    setPreview(null);
    setExpanded({});
    lastPayload.current = null;
    router.replace(`/substitutions/arrange?day=${day}`);
  };

  /* ------------------------------------------------------------ frame */

  const stepLabels = G.steps.map((label) => tx(label));
  const subLine = `${tx(G.stepOf(step + 1, 4))} · ${stepLabels[step]}`;

  const footer = (
    <p style={{ ...MUTED, margin: 0, lineHeight: 1.5 }}>
      {tx(G.whichPage)}{" "}
      <Link href={coverHref} className="vx-lnk">{tx(G.openCoverTab)}</Link>
      {" · "}
      <Link href={`/substitutions?day=${day}`} className="vx-lnk">{tx(G.openClassic)}</Link>
    </p>
  );

  const stepHeading = (label: Pair, sub?: ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <h2 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 18, fontWeight: 700, outline: "none" }}>{tx(label)}</h2>
      {sub ? <span style={MUTED}>{sub}</span> : null}
    </div>
  );

  let body: ReactNode;

  if (!setup) {
    body = <EmptyState icon="calendar" title={tx(G.noSession)} />;
  } else if (step === 0) {
    /* ---------------------------------------------------- who and when */
    const tomorrow = addDay(today, 1);
    const days = [today, tomorrow, ...(day !== today && day !== tomorrow ? [day] : [])];
    body = (
      <>
        {stepHeading(G.steps[0])}
        {setup.blocked ? <Banner tone="warn">{tx(setup.blocked === "no_timetable" ? G.noTimetable : G.noTimetableDay)}</Banner> : null}
        <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{tx(G.day)}</span>
            <ChipRow label={tx(G.day)}>
              {days.map((d) => (
                <Chip key={d} on={d === day} onClick={() => changeDay(d)}>
                  {d === today || d === tomorrow ? (
                    <>
                      {tx(d === today ? G.today : G.tomorrow)}
                      <span style={{ fontWeight: 500, opacity: 0.75 }}>{dayShort(d)}</span>
                    </>
                  ) : (
                    dayShort(d)
                  )}
                </Chip>
              ))}
            </ChipRow>
            <Field label={tx(G.anotherDay)}>
              <Input type="date" value={day} min={today} onChange={(event) => changeDay(event.target.value)} />
            </Field>
          </div>
          <Field label={tx(G.teacher)}>
            <Select value={staffId} onChange={(event) => pickTeacher(event.target.value)} invalid={formError === G.needTeacher}>
              <option value="">{tx(G.pickTeacher)}</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.away ? ` · ${tx(G.alreadyAwayTag(t.away))}` : ""}
                  {t.onLeave ? ` · ${tx(G.onLeaveTag)}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          {teachers.length === 0 ? <span style={MUTED}>{tx(G.noTeachers)}</span> : null}
          {teacher?.away ? <Banner tone="warn">{tx(G.alreadyAway(teacher.away))}</Banner> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{tx(G.howLong)}</span>
            <Seg<AbsenceSpanChoice>
              label={tx(G.howLong)}
              value={span}
              onChange={(value) => {
                setSpan(value);
                setFormError(null);
                dispatch({ type: "edited" });
              }}
              options={[
                { value: "whole", label: tx(G.wholeDay) },
                { value: "periods", label: tx(G.somePeriods) },
              ]}
            />
          </div>
          {span === "periods" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <ChipRow label={tx(G.whichPeriods)}>
                <Chip onClick={() => setPicked(spanPeriods("first_half"))}>{tx(G.firstHalf)} · P1–P4</Chip>
                <Chip onClick={() => setPicked(spanPeriods("second_half"))}>{tx(G.secondHalf)} · P5–P8</Chip>
              </ChipRow>
              <div role="group" aria-label={tx(G.whichPeriods)} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))", gap: 8 }}>
                {setup.bells.map(({ index }) => {
                  const on = picked.includes(index);
                  const lessons = teacher?.lessons.filter((lesson) => lesson.period === index) ?? [];
                  const what = lessons.length ? lessons.map((l) => `${l.classLabels.join(", ")} · ${l.subjectCode}`).join(" / ") : tx(G.free);
                  return (
                    <button
                      key={index}
                      type="button"
                      className="tap"
                      aria-pressed={on}
                      aria-label={`${tx(G.periodLabel(index))}: ${what}`}
                      onClick={() => {
                        setPicked((current) => (current.includes(index) ? current.filter((p) => p !== index) : [...current, index].sort((a, b) => a - b)));
                        setFormError(null);
                      }}
                      style={{ minHeight: 56, padding: "8px 10px", borderRadius: 12, border: `1.5px solid ${on ? "var(--acc)" : "var(--bd)"}`, background: on ? "var(--accs)" : "var(--card)", color: "var(--fg)", textAlign: "left", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
                    >
                      <b className="num">{pn(index)} <span style={{ fontWeight: 500, color: "var(--mut)" }}>{bellTime(bell(index)?.starts)}</span></b>
                      <span className="clip" style={{ fontSize: 12, color: lessons.length ? "var(--fg)" : "var(--mut)" }}>{what}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {formError ? <span role="alert" style={{ fontSize: 13, fontWeight: 600, color: "var(--bad)" }}>{tx(formError)}</span> : null}
          {loadError ? <Banner tone="bad">{tx(loadError)}</Banner> : null}
          <Btn variant="pri" big full icon="arrowRight" disabled={Boolean(setup.blocked) || loading} onClick={() => void showLessons()}>
            {loading ? tx(G.updating) : tx(G.showLessons)}
          </Btn>
        </Card>
      </>
    );
  } else if (step === 1 || step === 2) {
    const name = teacher?.name ?? "—";
    const list = preview?.periods ?? periods;
    const summary = tx(G.summary(name, spanPair(list), dayShort(day)));
    const refusedBanners = preview?.refused.map((refusal) => (
      <Banner key={refusal.needKey} tone="warn">{tx(G.refused(refusal.name, refusal.period, G.conflicts[refusal.conflict]))}</Banner>
    ));
    const status = (
      <div role="status" aria-live="polite" style={{ minHeight: 0 }}>
        {loading ? <span style={MUTED}>{tx(G.updating)}</span> : null}
      </div>
    );

    if (step === 1) {
      body = (
        <>
          {stepHeading(G.steps[1], summary)}
          <div>
            <Btn variant="ghost" icon="chevLeft" disabled={busy} onClick={() => setStep(0)}>{tx(G.change)}</Btn>
          </div>
          {status}
          {loadError ? (
            <Banner tone="bad" action={<Btn variant="sec" disabled={loading} onClick={() => void loadPreview(choices)}>{tx(G.tryAgain)}</Btn>}>{tx(loadError)}</Banner>
          ) : null}
          {preview?.begun.length ? <Banner tone="warn">{tx(G.begun(preview.begun.map((b) => b.period)))}</Banner> : null}
          {refusedBanners}
          {preview && preview.lessons.length === 0 ? <EmptyState icon="checkCircle" title={tx(G.noLessons)} body={tx(G.noLessonsBody)} /> : null}
          {preview?.lessons.map((lesson) => (
            <LessonCard
              key={lesson.needKey}
              lesson={lesson}
              choice={choices.find((c) => c.needKey === lesson.needKey)}
              time={bellTime(bell(lesson.period)?.starts)}
              subjectName={subjectName}
              expanded={Boolean(expanded[lesson.needKey])}
              onExpand={() => setExpanded((current) => ({ ...current, [lesson.needKey]: !current[lesson.needKey] }))}
              onChoose={(value) => choose(lesson.needKey, value)}
              disabled={busy}
            />
          ))}
          <div style={{ ...ROW, justifyContent: "flex-end" }}>
            <Btn variant="sec" icon="chevLeft" disabled={busy} onClick={() => setStep(0)}>{tx(G.back)}</Btn>
            <Btn variant="pri" icon="arrowRight" disabled={!preview || loading || Boolean(loadError)} onClick={() => setStep(2)}>{tx(G.toReview)}</Btn>
          </div>
        </>
      );
    } else {
      /* ------------------------------------------------------ review */
      const messageCount = preview?.messages.reduce((n, m) => n + m.lessons.length, 0) ?? 0;
      const retrying = save.status === "not_saved" || save.status === "unknown";
      body = (
        <>
          {stepHeading(G.reviewTitle, tx(G.reviewLead))}
          <SaveNotice state={save} onRetry={confirm} onCheck={checkAgain} />
          {status}
          {loadError ? (
            <Banner tone="bad" action={<Btn variant="sec" disabled={loading} onClick={() => void loadPreview(choices)}>{tx(G.tryAgain)}</Btn>}>{tx(loadError)}</Banner>
          ) : null}
          {refusedBanners}
          {preview ? (
            <>
              <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <b>{tx(G.absenceLine(name, spanPair(preview.periods), dayShort(day)))}</b>
                {preview.lessons.length ? (
                  <span style={MUTED}>{tx(G.tally(preview.tally.assigned, preview.tally.total, preview.tally.needsHelp))}</span>
                ) : (
                  <span style={MUTED}>{tx(G.noLessons)} · {tx(G.noLessonsBody)}</span>
                )}
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
                  {preview.lessons.map((lesson, i) => (
                    <li key={lesson.needKey} style={{ display: "grid", gridTemplateColumns: "48px minmax(0,1fr)", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                      <b className="num">{pn(lesson.period)}</b>
                      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span>{lesson.classLabels.join(", ")} · {subjectName(lesson.subjectCode)}</span>
                        <span style={ROW}>
                          {lesson.status === "assigned" ? (
                            <b>→ {lesson.options.find((o) => o.id === lesson.coveringStaffId)?.name ?? "—"}</b>
                          ) : (
                            <Pill tone="warn">{tx(G.needsPerson)}</Pill>
                          )}
                          {lesson.chosen ? <Pill tone="acc">{tx(G.byYou)}</Pill> : null}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
              {preview.others.length ? (
                <Card style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="sech">{tx(G.alsoChanges)}</span>
                  {preview.others.map((change) => (
                    <span key={change.needKey} style={{ fontSize: 14 }}>
                      <b className="num">{pn(change.period)}</b> · {change.classLabels.join(", ")} · {subjectName(change.subjectCode)}:{" "}
                      {tx(
                        change.kind === "moved"
                          ? G.other.moved(change.fromName ?? "—", change.toName ?? "—")
                          : change.kind === "released"
                            ? G.other.released(change.fromName)
                            : change.kind === "assigned"
                              ? G.other.assigned(change.toName ?? "—")
                              : G.other.cancelled,
                      )}
                    </span>
                  ))}
                </Card>
              ) : null}
              <Card style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-label={tx(G.whatsappTitle)}>
                <span className="sech" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Ic n="message" size={16} />
                  {tx(G.whatsappTitle)}
                </span>
                <span style={{ fontSize: 14 }}>{tx(G.whatsappLead(messageCount, preview.messages.length))}</span>
                {preview.messages.length ? (
                  <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                    {preview.messages.map((person) => (
                      <li key={person.staffId} style={{ fontSize: 14 }}>
                        <b>{person.name}</b> — {person.lessons.map((l) => `${pn(l.period)} ${l.classLabels.join(", ")}${l.kind === "updated" ? ` (${tx(G.updatedTag)})` : ""}`).join(", ")}
                        {!person.hasPhone ? <span style={{ display: "block", color: "var(--warnfg)", fontSize: 13 }}>{tx(G.noPhone)}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {preview.withdrawn.length ? (
                  <>
                    <span style={MUTED}>{tx(G.withdrawnLead)}</span>
                    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                      {preview.withdrawn.map((w) => (
                        <li key={`${w.name}-${w.period}`} style={{ fontSize: 14 }}>
                          <b>{w.name}</b> — {pn(w.period)} {w.classLabels.join(", ")}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </Card>
            </>
          ) : null}
          {previewing ? <Banner tone="info">{tx(G.previewing)}</Banner> : null}
          <div style={{ ...ROW, justifyContent: "flex-end" }}>
            <Btn variant="sec" icon="chevLeft" disabled={busy} onClick={() => setStep(1)}>{tx(G.back)}</Btn>
            <Btn variant="pri" big icon="check" disabled={!preview || loading || previewing || !canConfirm(save)} onClick={confirm}>
              {save.status === "saving" ? tx(G.saving) : retrying ? tx(G.tryAgain) : tx(G.confirm)}
            </Btn>
          </div>
        </>
      );
    }
  } else if (save.status === "saved") {
    /* ------------------------------------------------------------ done */
    const { receipt, committed } = save.receipt;
    const sentence = receiptSentence(receipt);
    body = (
      <>
        {stepHeading(receipt.replayed ? G.alreadySaved : G.saved)}
        <Banner tone={receipt.needsHelp > 0 ? "warn" : "ok"}>{tx({ en: sentence.en, hi: sentence.hi })}</Banner>
        <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="sech">{tx(G.savedLessons)}</span>
          {committed === null ? (
            <span style={MUTED}>{tx(G.noReadBack)}</span>
          ) : committed.length === 0 ? (
            <span style={MUTED}>{tx(G.noLessons)}</span>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {committed.map((lesson, i) => (
                <li key={`${lesson.period}-${i}`} style={{ display: "grid", gridTemplateColumns: "48px minmax(0,1fr)", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                  <b className="num">{pn(lesson.period)}</b>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span>{lesson.classLabels.join(", ")} · {subjectName(lesson.subjectCode)}</span>
                    {lesson.status === "assigned" ? <b>→ {lesson.coveringName ?? "—"}</b> : <span><Pill tone="warn">{tx(G.needsPerson)}</Pill></span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="sech" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Ic n="message" size={16} />
            {tx(G.whatsappTitle)}
          </span>
          <span style={{ fontSize: 14 }}>{tx(G.queued(receipt.noticesQueued, receipt.noticeRecipients))}</span>
          {receipt.recipientsWithoutPhone > 0 ? <span style={{ fontSize: 13, color: "var(--warnfg)" }}>{tx(G.noPhoneQueued(receipt.recipientsWithoutPhone))}</span> : null}
        </Card>
        <div style={{ ...ROW, justifyContent: "flex-end" }}>
          <Btn variant="sec" icon="plus" onClick={startAgain}>{tx(G.another)}</Btn>
          <Btn variant="pri" icon="swap" href={coverHref}>{tx(G.openCoverTab)}</Btn>
        </div>
      </>
    );
  }

  return (
    <VxPage>
      <TopBar crumb={tx(G.crumb)} title={tx(G.title)} mSub={subLine} mBack={coverHref} />
      <Section gap={14} style={{ width: "100%", maxWidth: 760, margin: "0 auto" }}>
        <WizardSteps steps={stepLabels} current={step} />
        {initial.draftMissing ? <Banner tone="info">{tx(G.draftMissing)}</Banner> : null}
        {initial.fromDraft && step < 3 ? <Banner tone="info">{tx(G.fromDraft)}</Banner> : null}
        {body}
        {footer}
      </Section>
    </VxPage>
  );
}

/** What the last Confirm came to, in words, with the next thing to do. */
function SaveNotice({ state, onRetry, onCheck }: { state: SaveState<GuidedSaved>; onRetry: () => void; onCheck: () => void }) {
  const { tx } = useVx();
  switch (state.status) {
    case "saving":
      return <Banner tone="info">{tx(G.saving)}</Banner>;
    case "checking":
      return <Banner tone="info">{tx(G.checking)}</Banner>;
    case "reloading":
      return <Banner tone="warn">{tx(state.why === "stale" ? G.stale : G.planChanged)} {tx(G.reloading)}</Banner>;
    case "editing":
      return state.notice ? <Banner tone="warn">{tx(state.notice === "stale" ? G.stale : G.planChanged)}</Banner> : null;
    case "refused":
      return <Banner tone="bad">{tx(G.refusedReason[state.reason] ?? G.refusedReason.bad_request)}</Banner>;
    case "not_saved":
      return (
        <div role="alert">
          <Banner tone="bad" action={<Btn variant="sec" onClick={onRetry}>{tx(G.tryAgain)}</Btn>}>{tx(G.notSaved)}</Banner>
        </div>
      );
    case "unknown":
      return (
        <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Banner tone="warn">{tx(G.unknown)}</Banner>
          <div style={ROW}>
            <Btn variant="sec" onClick={onRetry}>{tx(G.tryAgain)}</Btn>
            <Btn variant="ghost" onClick={onCheck}>{tx(G.checkAgain)}</Btn>
          </div>
        </div>
      );
    default:
      return null;
  }
}

/** One lesson the absence leaves, and who could take it. */
function LessonCard({
  lesson,
  choice,
  time,
  subjectName,
  expanded,
  onExpand,
  onChoose,
  disabled,
}: {
  lesson: GuidedLesson;
  choice: GuidedChoice | undefined;
  time: string;
  subjectName: (code: string) => string;
  expanded: boolean;
  onExpand: () => void;
  onChoose: (value: string | null) => void;
  disabled: boolean;
}) {
  const { tx } = useVx();
  const free = lesson.options.filter((option) => option.conflict === null);
  const busy = lesson.options.filter((option) => option.conflict !== null);
  const selected = choice ? choice.coveringStaffId : lesson.coveringStaffId;
  const shown = expanded ? free : free.filter((option, i) => i < FIRST_OPTIONS || option.id === selected);
  const nameOf = (id: string | null) => lesson.options.find((option) => option.id === id)?.name ?? "—";
  const headingId = `lesson-${lesson.needKey.replace(/[^a-z0-9]/gi, "").slice(-24)}`;
  const statusLine = lesson.chosen
    ? lesson.coveringStaffId
      ? G.yourChoice(nameOf(lesson.coveringStaffId))
      : G.nobodyChosen
    : lesson.status === "assigned"
      ? G.proposed(nameOf(lesson.coveringStaffId))
      : G.needsPerson;

  return (
    <Card as="section" pad={false} aria-labelledby={headingId} style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
        <span style={{ flex: "none", width: 54, height: 54, borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: lesson.status === "assigned" ? "var(--oks)" : "var(--warns)", color: lesson.status === "assigned" ? "var(--ok)" : "var(--warnfg)" }}>
          <b>{pn(lesson.period)}</b>
          <span className="num" style={{ fontSize: 11 }}>{time}</span>
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <h3 id={headingId} style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{lesson.classLabels.join(", ")} · {subjectName(lesson.subjectCode)}</h3>
          <span style={{ fontSize: 13, color: lesson.status === "assigned" ? "var(--ok)" : "var(--warnfg)", fontWeight: 600 }}>{tx(statusLine)}</span>
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 16px 14px", borderTop: "1px solid var(--bd)" }}>
        {!lesson.automatic ? <span style={{ fontSize: 13, color: "var(--warnfg)" }}>{tx(G.teamLesson)}</span> : null}
        <div role="radiogroup" aria-label={tx(G.whoCovers(lesson.period))} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map((option) => {
            const first = option.id === free[0]?.id;
            const warning = option.warnings[0] ? warningLabels[option.warnings[0]] : null;
            return (
              <RadioCard
                key={option.id}
                checked={selected === option.id}
                onSelect={() => (disabled || selected === option.id ? undefined : onChoose(option.id))}
                title={option.name}
                sub={`${tx(tierLabels[option.tier])} · ${tx(G.load(option.workload.today, option.workload.week))}${warning ? ` · ${tx(warning)}` : ""}`}
                trail={option.proposed && !lesson.chosen ? <Pill tone="ok">{tx(G.proposedTag)}</Pill> : first ? <Pill tone="info">{tx(G.bestMatch)}</Pill> : undefined}
              />
            );
          })}
          {free.length === 0 ? <span style={MUTED}>{tx(G.noneFree(lesson.period))}</span> : null}
          <RadioCard
            checked={selected === null}
            onSelect={() => (disabled || selected === null ? undefined : onChoose(null))}
            title={tx(G.nobodyYet)}
            sub={tx(G.nobodyYetSub)}
          />
        </div>
        {free.length > FIRST_OPTIONS ? (
          <div>
            <button type="button" className="tap btn ghost" aria-expanded={expanded} onClick={onExpand}>
              {expanded ? tx(G.showFewer) : tx(G.showAll(free.length))}
            </button>
          </div>
        ) : null}
        {busy.length ? (
          <details>
            <summary className="tap" style={{ minHeight: 44, display: "flex", alignItems: "center", fontSize: 13, fontWeight: 600, color: "var(--mut)", cursor: "pointer" }}>
              {tx(G.notAvailable(busy.length))}
            </summary>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {busy.map((option) => (
                <li key={option.id} style={{ display: "flex", flexDirection: "column", padding: "6px 0", borderTop: "1px solid var(--bd)" }}>
                  <span style={{ fontWeight: 600 }}>{option.name}</span>
                  <span style={MUTED}>
                    {tx(G.conflicts[option.conflict!])} · {tx(G.load(option.workload.today, option.workload.week))}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Card>
  );
}
