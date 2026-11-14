"use client";

import Link from "@/ui/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cue } from "@/ui/feedback/cue";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Chip, Input } from "@/vx/ui/controls";
import { Confirm, useToast } from "@/vx/ui/overlays";
import { Btn } from "@/vx/ui/primitives";
import { VxPage } from "@/vx/ui/page";
import { LangSeg, TchTop } from "@/vx/screens/teach/ui/shared";

import { countLine, dayWords, defaultTitle, OUT_OF_CHOICES, type ClassTestStatus, type CountTarget, type NewTestInput } from "./domain/class-tests";
import { subjectPair } from "./domain/groups";
import type { ActionResult } from "./save-types";

/*
 * Class tests on the teacher's Marks screen (D-609): a new test in three taps
 * (class, out of, start), the list of recent tests, and the "Count in" card
 * on a test's sheet.
 */

const classWords = (label: string) => p(label, label.replace(/^Class\b/, "कक्षा"));

export type TestOption = { classId: string; classLabel: string; subjectId: string; subjectCode: string };

export type TestCard = {
  id: string;
  title: Pair;
  classLabel: string;
  subjectCode: string;
  heldOn: string;
  maxMarks: number;
  status: ClassTestStatus;
  entered: number;
  total: number;
  countsIn: Pick<CountTarget, "en" | "hi"> | null;
};

/* --------------------------------------------------------- the list */

/** The strip on the Marks screen: a big "New test" and the last few tests. */
export function ClassTestsStrip({ tests, canCreate }: { tests: TestCard[]; canCreate: boolean }) {
  const { tx } = useVx();
  return (
    <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <span className="tc-ibx" style={{ background: "var(--oks)", color: "var(--ok)" }}><Ic n="flask" size={22} /></span>
        <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="tc-h2">{tx(p("Class tests", "कक्षा टेस्ट"))}</span>
          <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p("Any test you take, any day, out of any marks. It shows in each child's progress.", "आप जो भी टेस्ट लें, किसी भी दिन, कितने भी अंक का। हर बच्चे की प्रगति में दिखेगा।"))}</span>
        </span>
        {canCreate ? (
          <Btn variant="pri" big icon="plus" href="/teach/marks?view=newtest" className="tc-mw">{tx(p("New test", "नया टेस्ट"))}</Btn>
        ) : null}
      </div>
      {tests.length ? (
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          {tests.map((t) => {
            const subject = subjectPair(t.subjectCode);
            const done = t.status === "finished";
            const pct = t.total ? Math.round((t.entered / t.total) * 100) : 0;
            return (
              <Link key={t.id} href={`/teach/marks?test=${t.id}${done ? "&view=submitted" : ""}`} className="tap" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", borderRadius: 14, border: "1px solid var(--bd)", background: "var(--card)", color: "inherit", textDecoration: "none" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong className="clip" style={{ flex: 1, minWidth: 0 }}>{tx(t.title)}</strong>
                  <span className="pill" style={{ background: done ? "var(--oks)" : "var(--accs)", color: done ? "var(--ok)" : "var(--accfg)" }}>{done ? tx(p("Finished", "पूरा")) : tx(p("Open", "खुला"))}</span>
                </span>
                <span className="tc-ts" style={{ color: "var(--mut)" }}>
                  {tx(classWords(t.classLabel))} · {tx({ en: subject.en, hi: subject.hi ?? subject.en })} · {tx(p(`out of ${t.maxMarks}`, `पूर्णांक ${t.maxMarks}`))} · {tx(dayWords(t.heldOn))}
                </span>
                <span className="tc-mbar"><span style={{ width: `${pct}%`, background: done ? "var(--ok)" : "var(--acc)" }} /></span>
                <span className="tc-ts" style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
                  <span className="num">{tx(p(`${t.entered} of ${t.total} marked`, `${t.total} में से ${t.entered} भरे`))}</span>
                  <span style={{ color: t.countsIn ? "var(--accfg)" : "var(--mut)", fontWeight: t.countsIn ? 700 : 500 }}>{tx(countLine(t.countsIn))}</span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p("No class tests yet. Tap “New test” after you take one.", "अभी कोई कक्षा टेस्ट नहीं। टेस्ट लेने के बाद “नया टेस्ट” दबाएँ।"))}</span>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- new test */

/**
 * A new test in three taps: the class-subject (already picked when she
 * teaches one), how many marks it is out of, then Start. The name, the day
 * and "Count in" are there, filled in, for whoever wants them.
 */
export function NewClassTest({
  options,
  targets,
  today,
  crumb,
  create,
}: {
  options: TestOption[];
  /** "classId|subjectId" → the exams that class-subject's tests may count in. */
  targets: Record<string, CountTarget[]>;
  today: string;
  crumb: string;
  create: (input: NewTestInput) => Promise<ActionResult>;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState<string | null>(options.length === 1 ? key(options[0]) : null);
  const [outOf, setOutOf] = useState<number | null>(null);
  const [other, setOther] = useState("");
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(today);
  const [countsIn, setCountsIn] = useState<string | null>(null);
  const [problem, setProblem] = useState<Pair | null>(null);

  const chosen = options.find((o) => key(o) === pick) ?? null;
  const examChoices = pick ? (targets[pick] ?? []) : [];
  const typedOther = Number(other.replace(",", "."));
  const max = outOf ?? (other.trim() && Number.isFinite(typedOther) ? typedOther : null);
  const ready = Boolean(chosen && max && max > 0 && max <= 500);
  const yesterday = shiftDay(today, -1);

  // Classes in the school's order, then subjects: one row of chips per class.
  const byClass = new Map<string, TestOption[]>();
  for (const o of options) byClass.set(o.classLabel, [...(byClass.get(o.classLabel) ?? []), o]);

  function submit() {
    if (!chosen || !max) {
      setProblem(!chosen ? p("Pick the class and subject first.", "पहले कक्षा और विषय चुनें।") : p("Pick how many marks the test is out of.", "टेस्ट कितने अंक का है, चुनें।"));
      return;
    }
    setProblem(null);
    start(async () => {
      const r = await create({ classId: chosen.classId, subjectId: chosen.subjectId, maxMarks: max, title: title.trim() || null, heldOn: day, countsIn }).catch(() => null);
      if (r?.ok && typeof r.data?.id === "string") {
        cue("success");
        router.push(`/teach/marks?test=${r.data.id}`);
      } else {
        const message = r && !r.ok ? r.message : p("The test was not made. Try again.", "टेस्ट नहीं बना। फिर से कोशिश करें।");
        setProblem(message);
        toast.show({ text: tx(message), tone: "bad" });
      }
    });
  }

  const step = (n: number, label: Pair, done: boolean) => (
    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span aria-hidden="true" className="num" style={{ width: 30, height: 30, borderRadius: 15, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, background: done ? "var(--ok)" : "var(--accs)", color: done ? "#fff" : "var(--accfg)" }}>{done ? <Ic n="check" size={16} stroke={3} /> : n}</span>
      <span className="tc-h2">{tx(label)}</span>
    </span>
  );

  if (options.length === 0) {
    return (
      <VxPage className="tc">
        <TchTop crumb={crumb} title={tx(p("New test", "नया टेस्ट"))} mTitle={tx(p("New test", "नया टेस्ट"))} mBack="/teach/marks" actions={<LangSeg />} mAction={<LangSeg />} />
        <main>
          <div className="tc-scr" style={{ maxWidth: 720 }}>
            <div className="card" style={{ padding: "28px 20px", textAlign: "center", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
              <Ic n="clipboard" size={30} style={{ color: "var(--mut)" }} />
              <span className="tc-h2">{tx(p("No subjects are in your name yet", "आपके नाम पर अभी कोई विषय नहीं"))}</span>
              <span className="tc-ts" style={{ color: "var(--mut)" }}>{tx(p("The office adds you to the timetable; then your classes appear here.", "ऑफ़िस आपको समय-सारणी में जोड़ेगा; फिर आपकी कक्षाएँ यहाँ दिखेंगी।"))}</span>
            </div>
          </div>
        </main>
      </VxPage>
    );
  }

  return (
    <VxPage className="tc">
      <TchTop crumb={crumb} title={tx(p("New test", "नया टेस्ट"))} mTitle={tx(p("New test", "नया टेस्ट"))} mSub={tx(p("3 taps and you are entering marks", "3 बार दबाएँ और अंक भरना शुरू"))} mBack="/teach/marks" actions={<LangSeg />} mAction={<LangSeg />} />
      <main>
        <div className="tc-scr" style={{ maxWidth: 760, paddingBottom: 120 }}>
          <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            {step(1, p("Which class and subject?", "कौन-सी कक्षा और विषय?"), Boolean(chosen))}
            {[...byClass.entries()].map(([label, list]) => (
              <div key={label} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span className="tc-ts" style={{ width: 84, flex: "none", color: "var(--mut)", fontWeight: 700 }}>{tx(classWords(label))}</span>
                {list.map((o) => {
                  const s = subjectPair(o.subjectCode);
                  return (
                    <Chip key={key(o)} on={pick === key(o)} onClick={() => { setPick(key(o)); setCountsIn(null); cue("select"); }}>
                      {tx({ en: s.en, hi: s.hi ?? s.en })}
                    </Chip>
                  );
                })}
              </div>
            ))}
          </section>

          <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            {step(2, p("Out of how many marks?", "टेस्ट कितने अंक का था?"), Boolean(max))}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {OUT_OF_CHOICES.map((n) => (
                <button key={n} type="button" className={`tap chip${outOf === n ? " on" : ""}`} aria-pressed={outOf === n} onClick={() => { setOutOf(n); setOther(""); cue("select"); }} style={{ minWidth: 64, height: 48, justifyContent: "center", fontSize: 18, fontWeight: 800 }}>
                  {n}
                </button>
              ))}
              <Input
                inputMode="decimal"
                placeholder={tx(p("Other", "अन्य"))}
                aria-label={tx(p("Other number of marks", "अन्य पूर्णांक"))}
                value={other}
                onChange={(e) => { setOther(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 5)); setOutOf(null); }}
                style={{ width: 110, height: 48, textAlign: "center", fontWeight: 700 }}
              />
            </div>
          </section>

          <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            <span className="tc-h2" style={{ display: "flex", alignItems: "center", gap: 8 }}><Ic n="sliders" size={18} />{tx(p("Already filled in — change only if you want", "पहले से भरा है — चाहें तो ही बदलें"))}</span>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="tc-ts" style={{ fontWeight: 700 }}>{tx(p("Name of the test", "टेस्ट का नाम"))}</span>
              <Input value={title} maxLength={80} placeholder={defaultTitle(day)} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="tc-ts" style={{ fontWeight: 700 }}>{tx(p("Test day", "टेस्ट का दिन"))}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <Chip on={day === today} onClick={() => setDay(today)}>{tx(p("Today", "आज"))}</Chip>
                <Chip on={day === yesterday} onClick={() => setDay(yesterday)}>{tx(p("Yesterday", "कल"))}</Chip>
                <Input type="date" value={day} max={today} aria-label={tx(p("Another day", "कोई और दिन"))} onChange={(e) => e.target.value && setDay(e.target.value)} style={{ width: 170 }} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="tc-ts" style={{ fontWeight: 700 }}>{tx(p("Count it in a school exam?", "किसी स्कूल परीक्षा में जोड़ें?"))}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <Chip on={countsIn === null} onClick={() => setCountsIn(null)}>{tx(p("No — progress only", "नहीं — केवल प्रगति"))}</Chip>
                {examChoices.map((t) => (
                  <Chip key={t.id} on={countsIn === t.id} onClick={() => setCountsIn(t.id)}>{tx(p(`Count in ${t.en}`, `${t.hi || t.en} में जोड़ें`))}</Chip>
                ))}
              </div>
              <span className="tc-ts" style={{ color: "var(--mut)" }}>
                {examChoices.length
                  ? tx(p("When it counts, the exam's sheet can fill its marks from your tests. You check every mark before sending.", "जोड़ने पर परीक्षा की शीट आपके टेस्टों से अंक भर सकती है। भेजने से पहले हर अंक आप जाँचेंगे।"))
                  : tx(p("No school exam is open for this class and subject right now.", "इस कक्षा-विषय की कोई स्कूल परीक्षा अभी खुली नहीं है।"))}
              </span>
            </div>
          </section>

          {problem ? (
            <div role="alert" className="tc-note" style={{ background: "var(--bads)", color: "var(--bad)" }}>
              <Ic n="alert" />
              <span className="tc-tb" style={{ fontWeight: 700 }}>{tx(problem)}</span>
            </div>
          ) : null}
        </div>
        <div className="glass" style={{ position: "sticky", bottom: "var(--vx-bottom-h)", zIndex: 10, borderTop: "1px solid var(--bd)", padding: "12px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
          <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column" }}>
            <strong>{chosen ? `${tx(classWords(chosen.classLabel))} · ${tx((() => { const s = subjectPair(chosen.subjectCode); return { en: s.en, hi: s.hi ?? s.en }; })())}` : tx(p("Pick a class", "कक्षा चुनें"))}</strong>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{max ? tx(p(`Out of ${max}`, `पूर्णांक ${max}`)) : tx(p("Pick the marks", "पूर्णांक चुनें"))} · {tx(dayWords(day))}</span>
          </span>
          <Btn variant="pri" big icon="arrowRight" style={{ flex: "1 1 220px" }} disabled={pending || !ready} onClick={submit}>
            {pending ? tx(p("Making the test…", "टेस्ट बन रहा है…")) : tx(p("Start entering marks", "अंक भरना शुरू करें"))}
          </Btn>
        </div>
      </main>
    </VxPage>
  );
}

/* ----------------------------------------------------- count-in card */

/** On a test's sheet: which school exam it counts in, and taking it off the list. */
export function CountInCard({
  testId,
  countsIn,
  targets,
  canRemove,
  setCount,
  remove,
}: {
  testId: string;
  countsIn: string | null;
  targets: CountTarget[];
  canRemove: boolean;
  setCount: (input: { testId: string; countsIn: string | null }) => Promise<ActionResult>;
  remove: (testId: string) => Promise<ActionResult>;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState<string | null>(countsIn);
  const [askRemove, setAskRemove] = useState(false);
  const [pending, start] = useTransition();

  function choose(next: string | null) {
    if (next === value || pending) return;
    const before = value;
    setValue(next);
    start(async () => {
      const r = await setCount({ testId, countsIn: next }).catch(() => null);
      if (r?.ok) {
        cue("select");
        const t = targets.find((x) => x.id === next) ?? null;
        toast.show({ text: tx(countLine(t ? { en: t.en, hi: t.hi } : null)) });
        router.refresh();
      } else {
        setValue(before);
        toast.show({ text: tx(r && !r.ok ? r.message : p("Not saved. Try again.", "सहेजा नहीं गया। फिर से कोशिश करें।")), tone: "bad" });
      }
    });
  }

  function doRemove() {
    start(async () => {
      const r = await remove(testId).catch(() => null);
      if (r?.ok) {
        toast.show({ text: tx(p("Test taken off the list", "टेस्ट सूची से हटाया")) });
        router.push("/teach/marks");
      } else {
        setAskRemove(false);
        toast.show({ text: tx(r && !r.ok ? r.message : p("Not removed. Try again.", "हटाया नहीं गया। फिर से कोशिश करें।")), tone: "bad" });
      }
    });
  }

  return (
    <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
        <Ic n="layers" size={18} />
        {tx(p("Count this test in a school exam?", "इस टेस्ट को स्कूल परीक्षा में जोड़ें?"))}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Chip on={value === null} onClick={() => choose(null)}>{tx(p("No — progress only", "नहीं — केवल प्रगति"))}</Chip>
        {targets.map((t) => (
          <Chip key={t.id} on={value === t.id} onClick={() => choose(t.id)}>{tx(p(`Count in ${t.en}`, `${t.hi || t.en} में जोड़ें`))}</Chip>
        ))}
      </div>
      <span style={{ fontSize: 13, color: "var(--mut)" }}>
        {value
          ? tx(p("The exam's sheet can fill its marks from the tests that count. You check each mark there before sending.", "परीक्षा की शीट जुड़े टेस्टों से अंक भर सकती है। भेजने से पहले वहाँ हर अंक आप जाँचेंगे।"))
          : targets.length
            ? tx(p("It stays in each child's progress. It does not change any exam result.", "यह हर बच्चे की प्रगति में रहेगा। किसी परीक्षा का परिणाम नहीं बदलेगा।"))
            : tx(p("No school exam is open for this class and subject, so it stays in progress only.", "इस कक्षा-विषय की कोई स्कूल परीक्षा खुली नहीं, इसलिए यह केवल प्रगति में रहेगा।"))}
      </span>
      {canRemove ? (
        <div>
          <button type="button" className="tap btn ghost" onClick={() => setAskRemove(true)} style={{ color: "var(--mut)", paddingInline: 6 }}>
            <Ic n="trash" size={16} />
            {tx(p("Made by mistake? Take it off the list", "गलती से बना? सूची से हटाएँ"))}
          </button>
        </div>
      ) : null}
      <Confirm
        open={askRemove}
        onClose={() => setAskRemove(false)}
        onConfirm={doRemove}
        busy={pending}
        danger
        title={tx(p("Take this test off the list?", "यह टेस्ट सूची से हटाएँ?"))}
        body={tx(p("It will not show in lists or progress. The marks typed stay on the school's record.", "यह सूचियों और प्रगति में नहीं दिखेगा। भरे गए अंक स्कूल के रिकॉर्ड में रहेंगे।"))}
        confirmLabel={tx(p("Take off", "हटाएँ"))}
      />
    </div>
  );
}

function key(o: Pick<TestOption, "classId" | "subjectId">): string {
  return `${o.classId}|${o.subjectId}`;
}

function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}
