"use client";

import Link from "@/ui/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";

import {
  addPlanStepAction,
  closePlanAction,
  createPlanAction,
  removePlanStepAction,
  tellParentsAboutPlanAction,
  togglePlanStepAction,
} from "../actions";
import type { NotesPeople, SupportPlan } from "../data";
import { excerpt, followUpDate, isSensitiveNote, knownPair, parentPlanMessage, planProgress, planReaders, suggestedGoals, suggestedSteps, whenPair, type BoardNote } from "../domain/notes";
import { COST } from "./compose";
import { day, useBoth, WaBubble } from "./look";
import { mayEditPlan, type ClientViewer } from "./parts";

/*
 * A support plan (design Notes `plan`, TchNotes `plan`): steps with a person
 * and a date, ticked off as they are done; telling the parents is queued for
 * the office, Hindi first, with the cost shown first. A running plan changes
 * step by step through the plan actions; a new one is made in one go.
 */

const OWNER_ROLES = ["me", "class_teacher", "subject_teacher", "coordinator", "admin", "parents"] as const;
type OwnerRole = (typeof OWNER_ROLES)[number];
const OWNER_TEXT: Record<OwnerRole, Pair> = {
  me: p("Me", "मैं"),
  class_teacher: p("Class teacher", "कक्षा अध्यापक"),
  subject_teacher: p("Subject teacher", "विषय अध्यापक"),
  coordinator: p("Coordinator", "समन्वयक"),
  admin: p("Admin", "प्रशासक"),
  parents: p("Parents", "माता-पिता"),
};
/**
 * Who a new step can go to, as a list to choose from (smoke 20 Oct: the chip
 * changed person on each tap, and "Me" turned into "Class teacher" for the
 * class teacher herself). The class teacher is "Me (class teacher)", once.
 */
function ownerChoices(input: { holds: boolean; classTeacher: string | null; coordinator: string | null; sensitive?: boolean }, tx: (p: Pair) => string): { role: OwnerRole; label: string }[] {
  return [
    { role: "me" as const, label: input.holds ? tx(p("Me (class teacher)", "मैं (कक्षा अध्यापक)")) : tx(OWNER_TEXT.me) },
    ...(input.holds ? [] : [{ role: "class_teacher" as const, label: `${tx(OWNER_TEXT.class_teacher)}${input.classTeacher ? ` · ${input.classTeacher}` : ""}` }]),
    { role: "subject_teacher" as const, label: tx(OWNER_TEXT.subject_teacher) },
    // A health or family note is read by the admin and the class teacher
    // only, so its plan never hands a step to the coordinator (teacher day,
    // 6 Nov 2026, teachers 13 and 16).
    ...(input.sensitive ? [] : [{ role: "coordinator" as const, label: `${tx(OWNER_TEXT.coordinator)}${input.coordinator ? ` · ${input.coordinator}` : ""}` }]),
    { role: "parents" as const, label: tx(OWNER_TEXT.parents) },
  ];
}

/** When a step is done, as stored (English words, shown through whenPair). */
function whenLabels(today: string): string[] {
  return [`From ${day(followUpDate("tomorrow", today))}`, `By ${day(followUpDate("next_monday", today))}`, "Every Friday", "Every day", "This week"];
}

type Step = { id: string | null; body: string; owner: string; when: string | null; done: boolean; role: OwnerRole };

function stepsOf(plan: SupportPlan, viewer: ClientViewer, tx: (p: Pair) => string): Step[] {
  return plan.steps.map((s) => {
    const role = (OWNER_ROLES as readonly string[]).includes(s.ownerRole ?? "") ? (s.ownerRole as OwnerRole) : "me";
    const owner = s.ownerName ? (s.ownerStaffId === viewer.id ? tx(OWNER_TEXT.me) : s.ownerName) : tx(OWNER_TEXT[role]);
    // A suggested step reads in the reader's language, whoever added it (smoke 20 Oct).
    return { id: s.id, body: tx(knownPair(s.body)), owner, when: s.whenLabel, done: s.done, role };
  });
}

/**
 * Who will read the plan, said before it starts, and — for an Only me note —
 * the note's words kept out of the goal unless the author deliberately adds
 * them after seeing who reads them (R01). The note itself stays private.
 */
function PlanGoalSharing({ note, people, setGoal, shared, setShared }: { note: BoardNote; people: NotesPeople; setGoal: (goal: string) => void; shared: boolean; setShared: (v: boolean) => void }) {
  const { tx } = useVx();
  const [previewing, setPreviewing] = useState(false);
  const readers = tx(planReaders(note, { classTeacher: note.classId ? (people.classTeachers[note.classId] ?? null) : null, admin: people.admin }));
  const words = excerpt(note.body, 120);
  return (
    <div className="nx-c" style={{ gap: 8 }}>
      <span className="nx-m nx-f" style={{ gap: 6, alignItems: "flex-start" }}>
        <Ic n="users" size={16} style={{ flex: "none", marginTop: 2 }} />
        <span>{tx(p("Who will see this plan", "यह योजना कौन देखेगा"))}: {readers}</span>
      </span>
      {note.visibility === "private" && !shared ? (
        previewing ? (
          <div className="card nx-c" role="group" aria-label={tx(p("Use words from the note", "नोट के शब्द लें"))} style={{ padding: 12, gap: 8, background: "var(--s2)" }}>
            <span style={{ fontSize: 14 }}>“{words}”</span>
            <span className="nx-m">{tx(p(`Your note stays Only me. These words will go into the plan, and ${readers} will read them.`, `आपका नोट निजी ही रहेगा। ये शब्द योजना में जाएँगे, और ${readers} इन्हें पढ़ेंगे।`))}</span>
            <span className="nx-f" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="tap btn pri"
                onClick={() => {
                  setGoal(words);
                  setShared(true);
                  setPreviewing(false);
                }}
              >
                {tx(p("Add these words", "ये शब्द जोड़ें"))}
              </button>
              <button type="button" className="tap btn ghost" onClick={() => setPreviewing(false)}>
                {tx(p("Cancel", "रद्द करें"))}
              </button>
            </span>
          </div>
        ) : (
          <span className="nx-f" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="nx-m">{tx(p("Your note is Only me, so its words are not copied into the plan.", "आपका नोट निजी है, इसलिए उसके शब्द योजना में नहीं जाते।"))}</span>
            <button type="button" className="tap btn sec" onClick={() => setPreviewing(true)} style={{ height: 36 }}>
              {tx(p("Use words from the note", "नोट के शब्द लें"))}
            </button>
          </span>
        )
      ) : null}
    </div>
  );
}

/**
 * Short goals the note suggests, one tap each. The goal box starts empty:
 * it held the note's first 120 letters, cut mid-word, and that went into the
 * parents' message (smoke 20 Oct).
 */
function GoalChips({ note, setGoal }: { note: BoardNote; setGoal: (goal: string) => void }) {
  const { tx } = useVx();
  const goals = suggestedGoals(note.tags, note.body);
  return (
    <span className="nx-f" style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <span className="nx-m">{tx(p("For example", "जैसे"))}:</span>
      {goals.map((g) => (
        <button key={g.en} type="button" className="tap chip" onClick={() => setGoal(tx(g))}>
          {tx(g)}
        </button>
      ))}
    </span>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; error?: Pair }>, done?: Pair) => void;

function useRun(): [Run, boolean] {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run: Run = (fn, done) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (done) toast.show({ text: tx(done) });
        router.refresh();
      } else if (res.error) toast.show({ text: tx(res.error), tone: "bad" });
    });
  return [run, pending];
}

/** The plan's ring (design: r 30, the circle 188.5 long). */
function Ring({ done, total, stroke, label, teacher }: { done: number; total: number; stroke: number; label: string; teacher?: boolean }) {
  const pct = total ? done / total : 0;
  const dash = `${(188.5 * pct).toFixed(1)} 188.5`;
  return (
    <span style={{ position: "relative", flex: "none", width: 72, height: 72 }}>
      <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="36" cy="36" r="30" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: stroke }} />
        <circle cx="36" cy="36" r="30" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: stroke, strokeLinecap: "round", strokeDasharray: dash, transition: "stroke-dasharray .5s var(--ease)", ...(teacher ? null : { ["--len" as string]: 188.5, animation: "xDraw .9s .1s var(--ease) both" }) }} />
      </svg>
      <span className="nx-c num" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", fontSize: teacher ? 16 : 15, fontWeight: 700 }}>{label}</span>
    </span>
  );
}

/* ----------------------------------------------------------------- board */

/**
 * The board's plan (design Notes `plan`): the ring and goal, the steps, the
 * parents' message and the history. `draft` is a plan not made yet: the
 * steps the note's tags suggest, started with one button.
 */
export function BoardPlan({ plan, draftFor, viewer, people, today, school, base, sourceBody }: { plan: SupportPlan | null; draftFor: BoardNote | null; viewer: ClientViewer; people: NotesPeople; today: string; school: string; base: string; sourceBody?: string | null }) {
  const { tx } = useVx();
  const both = useBoth();
  const router = useRouter();
  const toast = useToast();
  const [run, pending] = useRun();
  const [creating, start] = useTransition();
  const draft = !plan && draftFor ? draftFor : null;
  const studentName = plan?.studentName ?? draft?.studentName ?? "";
  const classLabel = plan?.classLabel ?? draft?.classLabel ?? "";
  const classId = plan?.classId ?? draft?.classId ?? null;
  const ct = classId ? (people.classTeachers[classId] ?? null) : null;
  const first = studentName.split(" ")[0];
  const nextWeek = day(followUpDate("one_week", today));
  const privateSource = draft?.visibility === "private";
  const [goal, setGoal] = useState("");
  const [shared, setShared] = useState(false);
  // Steps that fit what the note says and the child's class, not the same three for everyone (smoke 20 Oct).
  const [draftSteps, setDraftSteps] = useState<Step[]>(() => (draft ? suggestedSteps(draft.tags, { text: draft.body, classLabel: draft.classLabel }).map((s) => ({ id: null, body: tx(s), owner: tx(OWNER_TEXT.class_teacher), when: nextWeek, done: false, role: "class_teacher" as OwnerRole })) : []));
  const [newStep, setNewStep] = useState("");
  const [tellDraft, setTellDraft] = useState(false);
  const steps = plan ? stepsOf(plan, viewer, tx) : draftSteps;
  const prog = plan ? planProgress(plan.steps) : { done: 0, total: draftSteps.length };
  const open = plan ? plan.status === "active" || plan.status === "draft" : true;
  const mayEdit = plan ? mayEditPlan(plan, viewer) : viewer.canWrite;
  const msg = parentPlanMessage({ childName: studentName, goal: plan?.goal ?? goal, steps: steps.map((s) => s.body), school, noteBody: draft?.body ?? sourceBody ?? null });
  const sent = plan?.tellParents ?? false;

  const add = () => {
    const text = newStep.trim();
    if (!text) {
      toast.show({ text: tx(p("Type the step first", "पहले कदम लिखें")) });
      return;
    }
    setNewStep("");
    if (plan) run(() => addPlanStepAction(plan.id, text, "class_teacher", nextWeek), p(`Step added for ${ct ?? "the class teacher"}`, "कदम जोड़ा गया"));
    else setDraftSteps((cur) => [...cur, { id: null, body: text, owner: tx(OWNER_TEXT.class_teacher), when: nextWeek, done: false, role: "class_teacher" }]);
  };

  const create = () =>
    start(async () => {
      if (!draft?.studentId) return;
      if (!goal.trim()) {
        toast.show({ text: tx(p("Write the goal first", "पहले लक्ष्य लिखें")), tone: "bad" });
        return;
      }
      const res = await createPlanAction({ studentId: draft.studentId, noteId: draft.id, goal, steps: draftSteps.map((s) => ({ body: s.body, ownerRole: s.role, whenLabel: s.when })), tellParents: tellDraft && !privateSource && viewer.parentPlans !== false, shareExcerpt: shared });
      if (res.ok && res.id) {
        toast.show({ text: tx(p("Support plan started", "सहायता योजना शुरू")) });
        router.replace(`${base}?plan=${res.id}`);
        router.refresh();
      } else if (!res.ok) toast.show({ text: tx(res.error), tone: "bad" });
    });

  const history: { text: Pair; when: string; dot: string }[] = plan
    ? [
        { text: p(`Plan started by ${plan.createdByName}`, `${plan.createdByName} ने योजना शुरू की`), when: day(plan.createdAt), dot: "var(--acc)" },
        ...plan.steps.filter((s) => s.done).map((s) => ({ text: p(`Done: ${s.body}`, `पूरा: ${s.body}`), when: s.ownerName ?? "", dot: "var(--ok)" })),
        ...(plan.tellParents ? [{ text: p("Plan queued for the parents on WhatsApp", "योजना माता-पिता के व्हाट्सऐप की कतार में"), when: "", dot: "var(--ok)" }] : []),
        ...(plan.status === "done" || plan.status === "closed" ? [{ text: p("Plan closed", "योजना बंद"), when: day(plan.updatedAt), dot: "var(--mut)" }] : []),
      ]
    : [];

  return (
    <div className="nx-c" style={{ gap: 16, animation: "xPush .36s var(--ease) both" }}>
      <div className="card nx-f" style={{ padding: "16px 18px", gap: 16, flexWrap: "wrap" }}>
        <Ring done={prog.done} total={prog.total} stroke={7} label={`${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%`} />
        <span className="nx-c" style={{ flex: 1, minWidth: 220, gap: 4 }}>
          <span className="nx-m" style={{ fontWeight: 700 }}>{tx(p("Support plan", "सहायता योजना"))} · {studentName} · {classLabel}</span>
          {plan ? (
            <span className="serif nx-t">{tx(knownPair(plan.goal))}</span>
          ) : (
            <>
              <label>
                <span className="sr">Goal</span>
                <input className="inp serif" value={goal} maxLength={300} onChange={(e) => setGoal(e.target.value)} placeholder={tx(p("The goal, in a few words: what should change for the child?", "लक्ष्य, कुछ शब्दों में: बच्चे के लिए क्या बदलना चाहिए?"))} style={{ fontSize: 20, fontWeight: 600 }} />
              </label>
              {draft ? <GoalChips note={draft} setGoal={setGoal} /> : null}
            </>
          )}
          {draft ? <PlanGoalSharing note={draft} people={people} setGoal={setGoal} shared={shared} setShared={setShared} /> : null}
          <span className="nx-m">
            {plan
              ? tx(p(`Started by ${plan.createdByName} · ${day(plan.createdAt)}${people.coordinator ? ` · coordinator ${people.coordinator}` : ""}`, `${plan.createdByName} ने शुरू की · ${day(plan.createdAt)}`))
              : tx(p(`Suggested steps for ${first}. Change any of them, then start the plan.`, `${first} के लिए सुझाए गए कदम। कोई भी बदलें, फिर योजना शुरू करें।`))}
          </span>
        </span>
        {plan?.noteId ?? draft ? (
          <Link href={`${base}?note=${plan?.noteId ?? draft!.id}`} scroll={false} className="tap btn sec">
            <Ic n="notePen" size={18} />
            {tx(p("See the note", "नोट देखें"))}
          </Link>
        ) : null}
      </div>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <div className="card nx-c" style={{ padding: "12px 16px 14px" }}>
          <div className="nx-f" style={{ justifyContent: "space-between", padding: "4px 0 8px" }}>
            <span className="nx-v">{tx(p("Steps", "कदम"))}</span>
            <span className="num nx-m" style={{ fontWeight: 700 }}>{tx(p(`${prog.done} of ${prog.total} done`, `${prog.total} में से ${prog.done} पूरे`))}</span>
          </div>
          {steps.map((s, i) => (
            <div key={s.id ?? `d${i}`} className="nx-f" style={{ gap: 8, padding: "6px 0", borderTop: "1px solid var(--bd)", alignItems: "center", animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 28}ms both` }}>
              {plan ? (
                <button type="button" className="tap nx-cb" role="checkbox" aria-checked={s.done} aria-label={`Step done: ${s.body}`} disabled={!mayEdit || !open || pending} onClick={() => run(() => togglePlanStepAction(plan.id, s.id!, !s.done), s.done ? p("Step opened again", "कदम फिर खोला") : p(`Step done · ${prog.done + 1} of ${prog.total}`, `कदम पूरा · ${prog.total} में से ${prog.done + 1}`))}>
                  <span style={{ background: s.done ? "var(--ok)" : "var(--card)", borderColor: s.done ? "var(--ok)" : "var(--bds)" }}>
                    <Ic n="check" size={14} stroke={3} style={{ opacity: s.done ? 1 : 0, animation: s.done ? "xTick .4s var(--spring) both" : "none" }} />
                  </span>
                </button>
              ) : (
                <span className="nx-cb" aria-hidden="true">
                  <span style={{ background: "var(--card)", borderColor: "var(--bds)" }} />
                </span>
              )}
              <span className="nx-c" style={{ flex: 1, gap: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 600, textDecoration: s.done ? "line-through" : "none", color: s.done ? "var(--mut)" : "var(--fg)" }}>{s.body}</span>
                <span className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
                  <span className="pill" style={{ background: "var(--s2)", color: "var(--fg)" }}><Ic n="user" size={12} />{s.owner}</span>
                  {s.when ? <span className="pill num" style={{ background: "var(--s2)", color: "var(--mut)" }}><Ic n="calendar" size={12} />{tx(whenPair(s.when))}</span> : null}
                </span>
              </span>
              {mayEdit && open ? (
                <button
                  type="button"
                  className="tap btn ghost"
                  aria-label={`Remove step: ${s.body}`}
                  disabled={pending}
                  onClick={() => (plan ? run(() => removePlanStepAction(plan.id, s.id!), p("Step removed", "कदम हटाया")) : setDraftSteps((cur) => cur.filter((_, j) => j !== i)))}
                  style={{ width: 36, height: 36, padding: 0, color: "var(--mut)" }}
                >
                  <Ic n="x" size={16} />
                </button>
              ) : null}
            </div>
          ))}
          {steps.length === 0 ? <span className="nx-m" style={{ padding: "10px 0", borderTop: "1px solid var(--bd)" }}>{tx(p("No steps yet. Add the first one below.", "अभी कोई कदम नहीं। नीचे पहला कदम जोड़ें।"))}</span> : null}
          {mayEdit && open ? (
            <>
              <div className="nx-f" style={{ gap: 8, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
                <label style={{ flex: 1 }}>
                  <span className="sr">New step</span>
                  <input className="inp" value={newStep} maxLength={160} onChange={(e) => setNewStep(e.target.value)} placeholder={tx(p("Add a step, e.g. Call parents on Friday", "कदम जोड़ें, जैसे शुक्रवार को माता-पिता को फ़ोन"))} style={{ height: 44 }} />
                </label>
                <button type="button" className="tap btn soft" disabled={pending || (draft ? draftSteps.length >= 12 : false)} onClick={add} style={{ height: 44 }}>
                  <Ic n="plus" size={18} />
                  {tx(p("Add", "जोड़ें"))}
                </button>
              </div>
              <span className="nx-m" style={{ marginTop: 8 }}>{tx(p(`New steps go to ${ct ?? "the class teacher"}, due ${nextWeek}.`, `नए कदम ${ct ?? "कक्षा अध्यापक"} को, ${nextWeek} तक।`))}</span>
            </>
          ) : null}
        </div>
        <div className="nx-c" style={{ gap: 14 }}>
          {viewer.parentPlans === false ? null : (
          <div className="card nx-c" style={{ padding: "14px 16px", gap: 10 }}>
            <div className="nx-f" style={{ justifyContent: "space-between" }}>
              <span className="nx-v">{tx(p("Tell parents", "अभिभावक को बताएँ"))}</span>
              {plan ? (
                <span className="pill" style={{ background: sent ? "var(--oks)" : "var(--s2)", color: sent ? "var(--ok)" : "var(--mut)" }}>{sent ? tx(p("Queued", "कतार में")) : tx(p("Not queued yet", "अभी कतार में नहीं"))}</span>
              ) : (
                <button type="button" className={`tap sw${tellDraft && !privateSource ? " on" : ""}`} role="switch" aria-checked={tellDraft && !privateSource} aria-label="Tell parents" disabled={privateSource} onClick={() => setTellDraft((v) => !v)} style={{ border: 0 }}>
                  <span />
                </button>
              )}
            </div>
            {privateSource ? <span className="nx-m">{tx(p("Only me note · its plan is not sent to parents", "निजी नोट · इसकी योजना माता-पिता को नहीं जाती"))}</span> : null}
            {plan || (tellDraft && !privateSource) ? <WaBubble hi={msg.hi} en={msg.en} foot={plan ? (sent ? tx(p("queued · the office sends it", "कतार में · कार्यालय भेजेगा")) : tx(p("preview", "झलक"))) : tx(p("queued when the plan starts", "योजना शुरू होने पर कतार में"))} /> : null}
            <span className="nx-m nx-f" style={{ gap: 6 }}>
              <Ic n="info" size={16} />
              {tx(p(`1 family · 1 WhatsApp message · about ${COST}`, `1 परिवार · 1 व्हाट्सऐप संदेश · लगभग ${COST}`))}
            </span>
            {plan && mayEdit && open ? (
              <button type="button" className="tap btn pri" disabled={pending} onClick={() => run(() => tellParentsAboutPlanAction(plan.id), p("Queued for the parents · Hindi first", "माता-पिता के लिए कतार में · पहले हिंदी"))} style={{ height: 48 }}>
                <Ic n="send" size={18} />
                {sent ? tx(p(`Queue again · ${COST}`, `फिर कतार में · ${COST}`)) : tx(p(`Queue for parents · ${COST}`, `माता-पिता के लिए कतार · ${COST}`))}
              </button>
            ) : null}
          </div>
          )}
          {plan ? (
            <div className="card nx-c" style={{ padding: "14px 16px" }}>
              <span className="sech" style={{ marginBottom: 6 }}>{tx(p("History", "इतिहास"))}</span>
              {history.map((l, i) => (
                <div key={i} className="nx-hr" style={{ animationDelay: `${i * 50}ms` }}>
                  <span className="nx-hd" style={{ background: l.dot }} />
                  <span className="nx-c">
                    <span style={{ fontSize: 13 }}>{tx(l.text)}</span>
                    {l.when ? <span className="num nx-m">{tx(l.when)}</span> : null}
                  </span>
                </div>
              ))}
              {mayEdit && open ? (
                <button type="button" className="tap btn ghost nx-s" disabled={pending} onClick={() => run(() => closePlanAction(plan.id), p("Plan closed", "योजना बंद"))} style={{ alignSelf: "flex-start", marginTop: 6, color: "var(--mut)" }}>
                  <Ic n="checkCircle" size={16} />
                  {tx(p("Close the plan", "योजना बंद करें"))}
                </button>
              ) : null}
            </div>
          ) : (
            <button type="button" className="tap btn pri" disabled={creating || !goal.trim() || draftSteps.length === 0} onClick={create} style={{ height: 52, fontSize: 16 }}>
              {creating ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="layers" size={18} />}
              {both(p("Start the plan", "योजना शुरू करें"))}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- teacher */

/**
 * The teacher's plan (design TchNotes `plan`): the ring, steps she can tick,
 * suggested steps, telling the parents, and a sticky "Save plan".
 */
export function TeachPlan({ plan, note, viewer, people, today, school, base }: { plan: SupportPlan | null; note: BoardNote | null; viewer: ClientViewer; people: NotesPeople; today: string; school: string; base: string }) {
  const { tx, sub } = useVx();
  const both = useBoth();
  const router = useRouter();
  const toast = useToast();
  const [run, pending] = useRun();
  const [saving, start] = useTransition();
  const whens = whenLabels(today);
  const [draft, setDraft] = useState<Step[]>([]);
  const [own, setOwn] = useState("");
  const [tell, setTell] = useState(false);
  const privateSource = !plan && note?.visibility === "private";
  // The goal starts empty, with short suggestions (smoke 20 Oct: the note's
  // opening words, cut mid-word, went to the parents). An Only me note lends
  // its words only when its author chooses to (R01).
  const [goal, setGoal] = useState("");
  const [picking, setPicking] = useState<number | null>(null);
  const [shared, setShared] = useState(false);
  const studentName = plan?.studentName ?? note?.studentName ?? "";
  const steps = plan ? stepsOf(plan, viewer, tx) : draft;
  const done = steps.filter((s) => s.done).length;
  const mayEdit = plan ? mayEditPlan(plan, viewer) : viewer.canWrite;
  const open = plan ? plan.status === "active" || plan.status === "draft" : true;
  const forText = note?.body ?? plan?.goal ?? "";
  const used = new Set(steps.map((s) => knownPair(s.body).en));
  const sugg = suggestedSteps(note?.tags ?? [], { text: note?.body ?? plan?.goal, classLabel: note?.classLabel ?? plan?.classLabel }).filter((s) => !used.has(s.en));
  const msg = parentPlanMessage({ childName: studentName, goal: plan?.goal ?? goal, steps: steps.map((s) => s.body), school, noteBody: note?.body ?? null });
  const classId = plan?.classId ?? note?.classId ?? null;
  const sensitive = note ? isSensitiveNote(note) : false;
  const owners = ownerChoices({ holds: classId !== null && viewer.heldClassIds.includes(classId), classTeacher: classId ? (people.classTeachers[classId] ?? null) : null, coordinator: people.coordinator, sensitive }, tx);
  const hint =
    steps.length < 3
      ? tx(p(`Add ${3 - steps.length} more step${3 - steps.length === 1 ? "" : "s"} · 3 to 5 work best`, `${3 - steps.length} और कदम जोड़ें · 3 से 5 ठीक रहते हैं`))
      : steps.length >= 5
        ? tx(p("That is enough steps — keep it simple", "इतने कदम काफ़ी हैं — सरल रखें"))
        : tx(p("Tap the box when a step is done", "कदम पूरा होने पर डिब्बा दबाएँ"));

  const addStep = (text: string) => {
    const t = text.trim();
    if (t.length < 3) {
      toast.show({ text: tx(p("Write the step first", "पहले कदम लिखें")) });
      return;
    }
    if (steps.length >= 12) {
      toast.show({ text: tx(p("12 steps is the most a plan can hold", "एक योजना में ज़्यादा से ज़्यादा 12 कदम")) });
      return;
    }
    if (plan) run(() => addPlanStepAction(plan.id, t, "me", whens[0]!), p("Step added", "कदम जोड़ा"));
    else setDraft((cur) => [...cur, { id: null, body: t, owner: owners[0]?.label ?? tx(OWNER_TEXT.me), when: whens[0]!, done: false, role: "me" }]);
  };

  // Who and when are picked from a list, not cycled by taps (smoke 20 Oct).
  const setOwner = (i: number, role: OwnerRole) =>
    setDraft((cur) => cur.map((s, j) => (j === i ? { ...s, role, owner: owners.find((o) => o.role === role)?.label ?? tx(OWNER_TEXT[role]) } : s)));
  const setWhen = (i: number, when: string) => setDraft((cur) => cur.map((s, j) => (j === i ? { ...s, when } : s)));

  const save = () =>
    start(async () => {
      if (plan) {
        if (tell && !plan.tellParents && mayEdit && viewer.parentPlans !== false) {
          const res = await tellParentsAboutPlanAction(plan.id);
          if (!res.ok) {
            toast.show({ text: tx(res.error), tone: "bad" });
            return;
          }
        }
        toast.show({ text: tx(tell ? p("Plan saved · WhatsApp queued for the office", "योजना सहेजी · व्हाट्सऐप कतार में") : p("Plan saved · the coordinator can see it", "योजना सहेजी · समन्वयक देख सकते हैं")) });
        router.push(plan.noteId ? `${base}?note=${plan.noteId}` : base, { scroll: false });
        router.refresh();
        return;
      }
      if (!note?.studentId) return;
      if (draft.length === 0) {
        toast.show({ text: tx(p("Add a step first", "पहले एक कदम जोड़ें")) });
        return;
      }
      if (!goal.trim()) {
        toast.show({ text: tx(p("Write the goal first", "पहले लक्ष्य लिखें")), tone: "bad" });
        return;
      }
      const res = await createPlanAction({ studentId: note.studentId, noteId: note.id, goal, steps: draft.map((s) => ({ body: s.body, ownerRole: s.role, whenLabel: s.when })), tellParents: tell && !privateSource && viewer.parentPlans !== false, shareExcerpt: shared });
      if (res.ok && res.id) {
        toast.show({ text: tx(tell ? p("Plan saved · WhatsApp queued for the office", "योजना सहेजी · व्हाट्सऐप कतार में") : p("Plan saved · the coordinator can see it", "योजना सहेजी · समन्वयक देख सकते हैं")) });
        router.push(`${base}?note=${note.id}`, { scroll: false });
        router.refresh();
      } else if (!res.ok) toast.show({ text: tx(res.error), tone: "bad" });
    });

  return (
    <div className="nx-c nt-full" style={{ animation: "xPush .36s var(--ease) both" }}>
      <div className="pad stack" style={{ flex: 1, padding: "18px 28px 24px", display: "grid", gridTemplateColumns: "minmax(0,1.25fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <div className="nx-c" style={{ gap: 16 }}>
          <div className="card rise nx-f" style={{ padding: "16px 18px", gap: 14 }}>
            <Ring done={done} total={steps.length} stroke={8} label={tx(p(`${done} of ${steps.length}`, `${steps.length} में से ${done}`))} teacher />
            <span className="nx-c" style={{ flex: 1 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p(`Support plan for ${studentName}`, `${studentName} के लिए सहायता योजना`))}</span>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("For", "के लिए"))}: “{excerpt(forText, 160)}”</span>
              <span className="nx-m" style={{ fontSize: 12 }}>{hint}</span>
            </span>
          </div>
          {!plan && note ? (
            <div className="card nx-c nt-cd" style={{ gap: 8 }}>
              <label className="nx-c" style={{ gap: 6 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p("Goal", "लक्ष्य"))}</span>
                <input className="inp" value={goal} maxLength={300} onChange={(e) => setGoal(e.target.value)} placeholder={tx(p("In a few words: what should change for the child?", "कुछ शब्दों में: बच्चे के लिए क्या बदलना चाहिए?"))} style={{ height: 48, fontSize: 15 }} />
              </label>
              {note.visibility !== "private" || shared ? <GoalChips note={note} setGoal={setGoal} /> : null}
              <PlanGoalSharing note={note} people={people} setGoal={setGoal} shared={shared} setShared={setShared} />
            </div>
          ) : null}
          <div className="card nx-c" style={{ padding: "8px 14px" }}>
            {steps.map((s, i) => (
              <div key={s.id ?? `d${i}`} className="nx-f nt-ani" style={{ gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <button
                  type="button"
                  className="tap"
                  role="checkbox"
                  aria-checked={s.done}
                  aria-label={`Mark step done: ${s.body}`}
                  disabled={!plan || !mayEdit || !open || pending}
                  onClick={() => plan && run(() => togglePlanStepAction(plan.id, s.id!, !s.done))}
                  style={{ width: 44, height: 44, borderRadius: 14, border: s.done ? "2px solid var(--ok)" : "2px solid var(--bds)", background: s.done ? "var(--ok)" : "transparent", color: "var(--onsolid)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
                >
                  {s.done ? <Ic n="check" size={22} stroke={3} style={{ animation: "xTick .45s var(--spring) both" }} /> : null}
                </button>
                <span className="nx-c" style={{ flex: 1, gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: s.done ? "var(--mut)" : "var(--fg)", textDecoration: s.done ? "line-through" : "none" }}>{s.body}</span>
                  <span className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
                    {plan ? (
                      <>
                        <span className="pill" style={{ background: "var(--s2)", color: "var(--fg)" }}><Ic n="user" size={13} />{s.owner}</span>
                        {s.when ? <span className="pill" style={{ background: "var(--s2)", color: "var(--fg)" }}><Ic n="calendar" size={13} />{tx(whenPair(s.when))}</span> : null}
                      </>
                    ) : (
                      <>
                        <label className="nx-f" style={{ gap: 4 }}>
                          <Ic n="user" size={14} />
                          <span className="sr">{tx(p("Who does this step", "यह कदम कौन करेगा"))}</span>
                          <select className="inp" value={s.role} onChange={(e) => setOwner(i, e.target.value as OwnerRole)} style={{ height: 44, fontSize: 13, padding: "0 8px", maxWidth: 220 }}>
                            {owners.map((o) => <option key={o.role} value={o.role}>{o.label}</option>)}
                          </select>
                        </label>
                        <label className="nx-f" style={{ gap: 4 }}>
                          <Ic n="calendar" size={14} />
                          <span className="sr">{tx(p("When", "कब"))}</span>
                          <select
                            className="inp"
                            value={picking === i ? "pick" : (s.when ?? "")}
                            onChange={(e) => {
                              if (e.target.value === "pick") setPicking(i);
                              else {
                                setPicking(null);
                                setWhen(i, e.target.value);
                              }
                            }}
                            style={{ height: 44, fontSize: 13, padding: "0 8px", maxWidth: 200 }}
                          >
                            {[...new Set([...whens, ...(s.when ? [s.when] : [])])].map((w) => <option key={w} value={w}>{tx(whenPair(w))}</option>)}
                            <option value="pick">{tx(p("Pick a date…", "तारीख़ चुनें…"))}</option>
                          </select>
                        </label>
                        {picking === i ? (
                          <input
                            className="inp"
                            type="date"
                            aria-label={tx(p("The date", "तारीख़"))}
                            min={followUpDate("tomorrow", today)}
                            onChange={(e) => {
                              if (!e.target.value) return;
                              setWhen(i, `By ${day(e.target.value)}`);
                              setPicking(null);
                            }}
                            style={{ height: 44, fontSize: 13, maxWidth: 180 }}
                          />
                        ) : null}
                      </>
                    )}
                  </span>
                </span>
                {mayEdit && open ? (
                  <button type="button" className="tap btn ghost" aria-label={`Remove step: ${s.body}`} disabled={pending} onClick={() => (plan ? run(() => removePlanStepAction(plan.id, s.id!), p("Step removed", "कदम हटाया")) : setDraft((cur) => cur.filter((_, j) => j !== i)))} style={{ width: 40, padding: 0, color: "var(--mut)" }}>
                    <Ic n="x" size={18} />
                  </button>
                ) : null}
              </div>
            ))}
            {steps.length === 0 ? (
              <div className="nx-c" style={{ padding: "24px 8px", alignItems: "center", gap: 6, textAlign: "center" }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("No steps yet", "अभी कोई कदम नहीं"))}</span>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Tap a suggestion below to start.", "शुरू करने के लिए नीचे कोई सुझाव दबाएँ।"))}</span>
              </div>
            ) : null}
          </div>
          {mayEdit && open ? (
            <div className="card nx-c nt-cd">
              <span style={{ fontSize: 16, fontWeight: 700 }}>
                {tx(p("Suggested steps", "सुझाए गए कदम"))} {sub(p("Suggested steps", "सुझाए गए कदम")) ? <span className="nt-hn">· {sub(p("Suggested steps", "सुझाए गए कदम"))}</span> : null}
              </span>
              {sugg.length ? (
                <div className="nx-f" style={{ flexWrap: "wrap", gap: 8 }}>
                  {sugg.map((s) => (
                    <button key={s.en} type="button" className="tap nt-qp" disabled={pending} onClick={() => addStep(tx(s))} style={{ opacity: steps.length >= 5 ? 0.45 : 1 }}>
                      <span className="nx-f" style={{ gap: 6 }}>
                        <Ic n="plus" size={14} />
                        {tx(s)}
                      </span>
                      {sub(s) ? <span className="nt-hn">{sub(s)}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="nx-f" style={{ gap: 8 }}>
                <label className="nt-srch" style={{ flex: 1, minWidth: 0, borderRadius: 14 }}>
                  <span className="sr">Write your own step</span>
                  <input type="text" value={own} maxLength={160} onChange={(e) => setOwn(e.target.value)} placeholder={tx(p("Write your own step", "अपना कदम लिखें"))} />
                </label>
                <button
                  type="button"
                  className="tap btn sec"
                  disabled={pending}
                  onClick={() => {
                    addStep(own);
                    if (own.trim().length >= 3) setOwn("");
                  }}
                  style={{ height: 48, flex: "none" }}
                >
                  <Ic n="plus" size={18} />
                  {tx(p("Add", "जोड़ें"))}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="nx-c" style={{ gap: 16 }}>
          {viewer.parentPlans === false && !plan?.tellParents ? null : (
          <div className="card nx-c nt-cd">
            {plan?.tellParents ? (
              <div className="nx-f" style={{ gap: 12 }}>
                <span className="nt-ic" style={{ background: "var(--oks)", color: "var(--ok)" }}><Ic n="message" size={18} /></span>
                <span className="nx-c" style={{ flex: 1 }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p("Tell parents", "माता-पिता को बताएँ"))}</span>
                  <span className="nt-hn">{tx(p("Queued for the office · Hindi first", "कार्यालय की कतार में · पहले हिंदी"))}</span>
                </span>
              </div>
            ) : (
              <button type="button" className="tap nx-f" role="switch" aria-checked={tell && !privateSource} disabled={privateSource} onClick={() => setTell((v) => !v)} style={{ gap: 12, width: "100%", padding: 0, border: 0, background: "transparent", color: "var(--fg)", textAlign: "left", font: "inherit" }}>
                <span className="nt-ic" style={{ background: "var(--oks)", color: "var(--ok)" }}><Ic n="message" size={18} /></span>
                <span className="nx-c" style={{ flex: 1 }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p("Tell parents", "माता-पिता को बताएँ"))}</span>
                  <span className="nt-hn">{privateSource ? tx(p("Only me note · its plan is not sent to parents", "निजी नोट · इसकी योजना माता-पिता को नहीं जाती")) : <>{sub(p("Tell parents", "माता-पिता को बताएँ")) ? `${sub(p("Tell parents", "माता-पिता को बताएँ"))} · ` : ""}{tx(p("Hindi first", "पहले हिंदी"))}</>}</span>
                </span>
                <span className={`sw${tell && !privateSource ? " on" : ""}`}><span /></span>
              </button>
            )}
            {((tell && !privateSource) || plan?.tellParents) && steps.length > 0 ? (
              <>
                <div className="nt-wa nt-ani">
                  <div>
                    <span lang="hi">{msg.hi}</span>
                    <span style={{ marginTop: 6, opacity: 0.8 }}>{msg.en}</span>
                    <span style={{ fontSize: 11, textAlign: "right", opacity: 0.6 }}>{plan?.tellParents ? tx(p("queued", "कतार में")) : tx(p("queued when you save", "सहेजने पर कतार में"))}</span>
                  </div>
                </div>
                <span className="nx-m" style={{ fontSize: 12 }}>{tx(p(`Queued for the office to send · 1 WhatsApp from the school’s number · about ${COST}`, `कार्यालय भेजेगा · स्कूल के नंबर से 1 व्हाट्सऐप · लगभग ${COST}`))}</span>
              </>
            ) : (
              <span className="nx-m" style={{ fontSize: 12 }}>{tx(p("Off · parents are not told. You can turn it on any time.", "बंद · माता-पिता को नहीं बताया जाएगा। कभी भी चालू कर सकते हैं।"))}</span>
            )}
          </div>
          )}
          <div className="nt-nt" style={{ background: "var(--infos)", color: "var(--info)" }}>
            <Ic n="info" size={18} style={{ marginTop: 1 }} />
            <span>{tx(sensitive ? p("Every step names a person and a date. The admin sees how the plan is going.", "हर कदम में एक व्यक्ति और तारीख़ है। प्रशासक देखते हैं कि योजना कैसी चल रही है।") : p(`Every step names a person and a date. ${people.coordinator ? `${people.coordinator} (coordinator)` : "The coordinator"} sees how the plan is going.`, `हर कदम में एक व्यक्ति और तारीख़ है। समन्वयक देखते हैं कि योजना कैसी चल रही है।`))}</span>
          </div>
        </div>
      </div>
      <div className="glass nt-sbar">
        <span className="nx-c nt-rt" style={{ flex: 1 }}>
          <span className="nt-f14" style={{ fontSize: 14, fontWeight: 700 }}>{tx(p(`${done} of ${steps.length} steps done`, `${steps.length} में से ${done} कदम पूरे`))}</span>
          <span className="nx-m" style={{ fontSize: 12 }}>{steps.length < 3 ? tx(p("3 to 5 steps work best", "3 से 5 कदम ठीक रहते हैं")) : sensitive ? tx(p("The admin and the class teacher will see this plan", "प्रशासक और कक्षा अध्यापक यह योजना देखेंगे")) : tx(p(`${people.coordinator ? `${people.coordinator} (coordinator)` : "The coordinator"} will see this plan`, "समन्वयक यह योजना देखेंगे"))}</span>
        </span>
        <button type="button" className="tap btn pri nt-big mfull" disabled={saving || (!plan && draft.length === 0)} onClick={save} style={{ opacity: steps.length >= 3 || plan ? 1 : 0.6 }}>
          {saving ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="check" size={18} />}
          {both(p("Save plan", "योजना सहेजें"))}
        </button>
      </div>
    </div>
  );
}
