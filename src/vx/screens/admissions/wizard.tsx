"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { admitAction, checkDuplicateAction, searchFamiliesAction, type DuplicateHit } from "@/app/(app)/admissions/actions";
import { rupees, dateLabel, dayMonth } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Field, Input } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";

import type { DocKey } from "@/vx/screens/admissions/data";
import {
  ageFit,
  buildFeePlan,
  dobForInput,
  firstName,
  maskPhone,
  normalizeMobile,
  parseDob,
  type FamilyCard,
} from "@/vx/screens/admissions/logic";
import { ActionBar, Av, PeopleStyles, RadioTile, SwitchRow } from "@/vx/screens/admissions/ui";

export type WizardClass = { id: string; label: string; onRoll: number; seats: number | null; tuition: number };
export type WizardContext = {
  sessionLabel: string;
  classes: WizardClass[];
  routes: { id: string; label: string; annual: number }[];
  policies: { id: string; code: string; label: string; calculationType: "tuition_zero" | "tuition_percentage" | "tuition_fixed_amount"; percentage: number | null; fixedTuitionAmount: number | null }[];
  schedule: { label: string; dueDate: string }[];
  distribution: "first_only" | "equal";
  newAcademicFee: number;
  oldAcademicFee: number;
  lateFee: number;
  today: string;
  nextSr: string;
};

/**
 * What the wizard opens with. An enquiry fills the first four; the rest are
 * for a form re-opened at a later step (and for the design fixture, which
 * draws each step with the frame's sample child).
 */
export type WizardPrefill = {
  enquiryId: string | null;
  fullName: string;
  classId: string;
  fatherName: string;
  phone: string;
  nameHi?: string;
  dob?: string;
  gender?: "Male" | "Female";
  previousSchool?: string;
  motherName?: string;
  address?: string;
  village?: string;
  routeId?: string;
  linked?: FamilyCard | null;
  docs?: Partial<Record<DocKey, boolean>>;
};

type Gender = "" | "Male" | "Female";
type Kind = "new" | "existing";

const STEP_LABELS = [p("Student", "विद्यार्थी"), p("Family", "परिवार"), p("Fees", "फीस"), p("Review", "जाँचें")];
const DOCS: { key: DocKey; label: Pair; sub: Pair }[] = [
  { key: "birth", label: p("Birth certificate", "जन्म प्रमाण पत्र"), sub: p("Copy checked with the original", "मूल से मिलाकर") },
  { key: "tc", label: p("TC from the old school", "पुराने विद्यालय की टीसी"), sub: p("Needed for Class 1 and above", "कक्षा 1 और ऊपर के लिए") },
  { key: "photo", label: p("Passport photo", "पासपोर्ट फ़ोटो"), sub: p("Two copies", "दो प्रति") },
  { key: "aadhaar", label: p("Aadhaar card copy", "आधार कार्ड की कॉपी"), sub: p("Only the last 4 digits are kept", "केवल आख़िरी 4 अंक रखे जाते हैं") },
  { key: "address", label: p("Address proof", "पते का प्रमाण"), sub: p("Any utility bill or ration card", "बिजली बिल या राशन कार्ड") },
];
const NAME_HI = p("Name in Hindi", "नाम हिंदी में");

const card = { padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 } as const;
const mut12 = { fontSize: 12, color: "var(--mut)" } as const;

function Tile({ icon, tone = "acc" }: { icon: IconName; tone?: "acc" | "info" }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: tone === "info" ? "var(--infos)" : "var(--accs)", color: tone === "info" ? "var(--info)" : "var(--accfg)" }}>
      <Ic n={icon} />
    </span>
  );
}

/** The design's two-way segmented field (`.seg`, 38px buttons). */
function SegField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="field">
      <span>{label}</span>
      <div className="seg" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length},minmax(0,1fr))` }}>
        <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }} />
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={`tap${o.value === value ? " on" : ""}`} onClick={() => onChange(o.value)} style={{ height: 38 }}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The four steps across the top, a track between them; finished steps can be gone back to. */
function Steps({ step, onGo }: { step: number; onGo: (n: number) => void }) {
  const { tx } = useVx();
  return (
    <div className="card" style={{ padding: "14px 8px 12px" }}>
      <ol aria-label={tx(p("Steps", "चरण"))} style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", listStyle: "none", margin: 0, padding: 0 }}>
        <span aria-hidden="true" style={{ position: "absolute", top: 15, left: "12.5%", right: "12.5%", height: 3, borderRadius: 2, background: "var(--s3)" }} />
        <span aria-hidden="true" style={{ position: "absolute", top: 15, left: "12.5%", height: 3, borderRadius: 2, background: "var(--acc)", width: `${(step - 1) * 25}%`, transition: "width .5s var(--ease)" }} />
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const cur = n === step;
          return (
            <li key={label.en} style={{ display: "flex", justifyContent: "center" }}>
              <button type="button" className="tap" onClick={() => done && onGo(n)} aria-current={cur ? "step" : undefined} disabled={!done && !cur} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, border: 0, padding: 0, background: "transparent", color: "var(--fg)", cursor: done ? "pointer" : "default", opacity: 1 }}>
                <span className="num" style={{ width: 32, height: 32, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, background: done ? "var(--acc)" : cur ? "var(--card)" : "var(--s2)", color: done ? "var(--onsolid)" : cur ? "var(--acc)" : "var(--mut)", boxShadow: `0 0 0 4px var(--card), inset 0 0 0 2px ${done || cur ? "var(--acc)" : "var(--bd)"}`, transition: "background-color .3s ease" }}>
                  {done ? <Ic n="check" size={16} style={{ animation: "xPopIn .4s var(--spring) both" }} /> : n}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: cur ? "var(--fg)" : "var(--mut)" }}>{tx(label)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function AdmissionWizard({ ctx, prefill, initialStep }: { ctx: WizardContext; prefill: WizardPrefill; initialStep: number }) {
  const { tx, language } = useVx();
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState(Math.min(4, Math.max(1, initialStep)));
  const [tried, setTried] = useState<Record<number, boolean>>({});
  const [f, setF] = useState({ fullName: prefill.fullName, nameHi: prefill.nameHi ?? "", dob: prefill.dob ?? "", gender: (prefill.gender ?? "") as Gender, kind: "new" as Kind, classId: prefill.classId, previousSchool: prefill.previousSchool ?? "" });
  const [fam, setFam] = useState({ fatherName: prefill.fatherName, motherName: prefill.motherName ?? "", phone: prefill.phone, waSame: true, wa2: "", address: prefill.address ?? "", village: prefill.village ?? "", linked: prefill.linked ?? (null as FamilyCard | null) });
  const [fee, setFee] = useState({ routeId: prefill.routeId ?? "", policyId: "" });
  const [docs, setDocs] = useState<Partial<Record<DocKey, boolean>>>(prefill.docs ?? {});
  const [sr, setSr] = useState(ctx.nextSr);
  const [sheet, setSheet] = useState<"duplicate" | "sibling" | null>(null);
  const [sibling, setSibling] = useState<{ q: string; hits: FamilyCard[] | null; sel: string | null }>({ q: "", hits: null, sel: null });
  const [famQ, setFamQ] = useState("");
  const [famHits, setFamHits] = useState<FamilyCard[] | null>(null);
  const [dupes, setDupes] = useState<DuplicateHit[]>([]);
  const [dupOk, setDupOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const cls = ctx.classes.find((c) => c.id === f.classId) ?? null;
  const dobIso = parseDob(f.dob);
  const fit = cls ? ageFit(dobIso, cls.label, ctx.sessionLabel) : null;
  const route = ctx.routes.find((r) => r.id === fee.routeId) ?? null;
  const policy = ctx.policies.find((x) => x.id === fee.policyId) ?? null;
  const plan = buildFeePlan({
    classTuition: cls?.tuition ?? 0,
    transportAnnual: route?.annual ?? 0,
    academicFee: f.kind === "new" ? ctx.newAcademicFee : ctx.oldAcademicFee,
    policy,
    schedule: ctx.schedule,
    distribution: ctx.distribution,
    today: ctx.today,
  });

  const step1Errors = { fullName: !f.fullName.trim(), dob: !dobIso, classId: !cls };
  const phoneDigits = normalizeMobile(fam.phone);
  const step2Errors = { fatherName: !fam.fatherName.trim(), phone: phoneDigits.length !== 10, wa2: !fam.waSame && normalizeMobile(fam.wa2).length !== 10 };
  const stepOk = (s: number) => (s === 1 ? !Object.values(step1Errors).some(Boolean) : s === 2 ? !Object.values(step2Errors).some(Boolean) : true);
  const bad = tried[step] ? Object.values(step === 1 ? step1Errors : step === 2 ? step2Errors : {}).filter(Boolean).length : 0;

  const hint = bad
    ? tx(p(`${bad} ${bad === 1 ? "thing" : "things"} to fix above`, `ऊपर ${bad} चीज़ें ठीक करें`))
    : step === 1
      ? tx(p("Name, birth date and class are needed", "नाम, जन्म तिथि और कक्षा ज़रूरी हैं"))
      : step === 2
        ? tx(p("Father and phone are needed", "पिता और फ़ोन ज़रूरी हैं"))
        : step === 3
          ? tx(p("Check the bus and concession", "बस और छूट जाँचें"))
          : tx(p("Check once, then save", "एक बार जाँचें, फिर सहेजें"));

  async function next() {
    if (!stepOk(step)) {
      setTried((t) => ({ ...t, [step]: true }));
      return;
    }
    if (step === 2 && !dupOk) {
      const hits = await checkDuplicateAction({ fullName: f.fullName, fatherName: fam.fatherName, dob: f.dob, phone: fam.phone });
      if (hits.length > 0) {
        setDupes(hits);
        setSheet("duplicate");
        return;
      }
    }
    if (step < 4) {
      setStep(step + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    await save();
  }

  async function save() {
    if (!cls) return;
    setSaving(true);
    setSaveError(null);
    const res = await admitAction({
      sessionLabel: ctx.sessionLabel,
      fullName: f.fullName.trim(),
      nameHi: f.nameHi,
      classId: cls.id,
      dob: f.dob,
      gender: f.gender,
      studentType: f.kind,
      previousSchool: f.previousSchool.trim(),
      fatherName: fam.fatherName.trim(),
      motherName: fam.motherName.trim(),
      fatherPhone: phoneDigits,
      motherPhone: fam.waSame ? "" : normalizeMobile(fam.wa2),
      address: fam.address.trim(),
      villageCity: fam.village.trim(),
      transportRouteId: fee.routeId,
      conventionalPolicyId: fee.policyId,
      admissionNo: sr.trim(),
      siblingStudentIds: fam.linked ? fam.linked.kids.map((k) => k.id) : [],
      docs,
      enquiryId: prefill.enquiryId,
    });
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.message);
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    if (res.note) toast.show({ text: res.note, tone: "info" });
    router.push(`/admissions/new?done=${res.studentId}`);
  }

  async function findFamily(value: string) {
    setFamQ(value);
    if (value.trim().length < 2) {
      setFamHits(null);
      return;
    }
    setFamHits(await searchFamiliesAction(value));
  }

  const err = (s: number, on: boolean, text: string) => (tried[s] && on ? text : undefined);
  const nameHiLabel = language === "hi" ? NAME_HI.hi ?? NAME_HI.en : `${NAME_HI.hi} · ${NAME_HI.en}`;
  const title = prefill.enquiryId ? `${tx(p("Admit", "प्रवेश दें:"))} ${f.fullName || tx(p("student", "विद्यार्थी"))}` : tx(p("Add a student", "विद्यार्थी जोड़ें"));
  const mTitle = prefill.enquiryId ? `${tx(p("Admit", "प्रवेश दें:"))} ${firstName(f.fullName) || tx(p("student", "विद्यार्थी"))}` : tx(p("Add a student", "विद्यार्थी जोड़ें"));
  const stepWord = `${tx(p("Step", "चरण"))} ${step} ${tx(p("of", "/"))} 4`;
  const dueRows = plan.rows.filter((r) => r.due);
  const laterRows = plan.rows.filter((r) => !r.due);
  const missingDocs = DOCS.filter((d) => !docs[d.key]).length;
  const otherPolicies = ctx.policies.filter((x) => x.code !== "third_child");
  const genderText = f.gender === "Female" ? tx(p("Girl", "लड़की")) : f.gender === "Male" ? tx(p("Boy", "लड़का")) : null;
  const kindText = f.kind === "new" ? tx(p("New to school", "नया")) : tx(p("Was here before", "पहले यहाँ था"));

  const kv = (rows: [string, string][]) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "8px 16px" }}>
      {rows.map(([k, v]) => (
        <span key={k} style={{ display: "flex", flexDirection: "column", fontSize: 13, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: "var(--mut)" }}>{k}</span>
          <span className="clip" style={{ fontWeight: 600 }}>{v || "—"}</span>
        </span>
      ))}
    </div>
  );

  return (
    <>
      <PeopleStyles />
      <TopBar crumb={`${tx(p("Admissions", "दाख़िले"))} · ${stepWord}`} title={title} mTitle={mTitle} mSub={`${stepWord} · ${tx(STEP_LABELS[step - 1])}`} mBack="/admissions" />
      <main>
        <div className="pp-page">
          <div className="pad pp-wrap" style={{ padding: "20px 28px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            <Steps step={step} onGo={setStep} />

            {step === 1 ? (
              <div className="push" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="card" style={card}>
                  <Field label={tx(p("Child’s name (English)", "बच्चे का नाम (अंग्रेज़ी)"))} error={err(1, step1Errors.fullName, tx(p("Write the child’s name", "बच्चे का नाम लिखें")))}>
                    <Input value={f.fullName} invalid={Boolean(err(1, step1Errors.fullName, "x"))} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoComplete="off" placeholder={tx(p("For example: Ishaan Regar", "जैसे: Ishaan Regar"))} />
                  </Field>
                  <Field label={nameHiLabel} hint={tx(p("Printed on the TC and report card", "टीसी और रिपोर्ट कार्ड पर छपता है"))}>
                    <Input value={f.nameHi} lang="hi" onChange={(e) => setF({ ...f, nameHi: e.target.value })} />
                  </Field>
                  <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
                    <Field label={tx(p("Date of birth", "जन्म तिथि"))} error={err(1, step1Errors.dob, f.dob.trim() ? tx(p("Write the date like 21-08-2019", "तारीख़ ऐसे लिखें: 21-08-2019")) : tx(p("Date of birth is needed", "जन्म तिथि ज़रूरी है")))}>
                      <Input value={f.dob} placeholder="DD-MM-YYYY" inputMode="numeric" invalid={Boolean(err(1, step1Errors.dob, "x"))} onChange={(e) => setF({ ...f, dob: e.target.value })} />
                      {dobIso && fit ? (
                        <span style={{ fontSize: 12, fontWeight: 600, color: fit.fit === "right" ? "var(--ok)" : fit.fit === "unknown" ? "var(--mut)" : "var(--warnfg)" }}>
                          {dateLabel(dobIso)} · {fit.years} {tx(p("yrs", "वर्ष"))} {fit.months} {tx(p("mo on 1 Jul", "माह, 1 जुलाई को"))}
                          {cls && fit.fit === "right" ? ` · ${tx(p("right age for", "सही उम्र:"))} ${cls.label}` : ""}
                          {cls && fit.fit === "young" ? ` · ${tx(p("young for", "छोटा है:"))} ${cls.label}` : ""}
                          {cls && fit.fit === "old" ? ` · ${tx(p("older than most in", "बड़ा है:"))} ${cls.label}` : ""}
                        </span>
                      ) : null}
                    </Field>
                    <SegField<"Male" | "Female">
                      label={tx(p("Gender", "लिंग"))}
                      value={(f.gender || "Male") as "Male" | "Female"}
                      onChange={(g) => setF({ ...f, gender: g })}
                      options={[
                        { value: "Male", label: tx(p("Boy", "लड़का")) },
                        { value: "Female", label: tx(p("Girl", "लड़की")) },
                      ]}
                    />
                    <SegField<Kind>
                      label={tx(p("New or returning", "नया या पुराना"))}
                      value={f.kind}
                      onChange={(k) => setF({ ...f, kind: k })}
                      options={[
                        { value: "new", label: tx(p("New to school", "नया")) },
                        { value: "existing", label: tx(p("Was here before", "पहले यहाँ था")) },
                      ]}
                    />
                  </div>
                </div>
                <div className="card" style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("Class", "कक्षा"))}</span>
                    <span style={mut12}>{tx(p("Seats left this session", "इस सत्र में खाली सीटें"))}</span>
                  </div>
                  <div className="pp-tiles" role="radiogroup" aria-label={tx(p("Class", "कक्षा"))} style={{ animation: tried[1] && step1Errors.classId ? "xShake .4s ease" : undefined }}>
                    {ctx.classes.map((c) => {
                      const left = c.seats === null ? null : Math.max(0, c.seats - c.onRoll);
                      const full = left === 0;
                      const on = c.id === f.classId;
                      const fill = c.seats ? Math.min(1, c.onRoll / c.seats) : 0;
                      const lc = full ? "var(--bad)" : left !== null && left <= 2 ? "var(--warn)" : "var(--ok)";
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          className="tap"
                          onClick={() => (full ? toast.show({ text: `${c.label} ${tx(p("is full — the enquiry can wait for a seat", "भरी है — पूछताछ सीट का इंतज़ार कर सकती है"))}`, tone: "bad" }) : setF({ ...f, classId: c.id }))}
                          style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "9px 10px", borderRadius: 12, textAlign: "left", color: "var(--fg)", border: `1px solid ${on ? "var(--acc)" : "var(--bd)"}`, boxShadow: on ? "inset 0 0 0 1px var(--acc)" : "none", background: on ? "var(--accs)" : "var(--card)", opacity: full && !on ? 0.55 : 1 }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{c.label}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: lc }}>
                            {left === null ? `${c.onRoll} ${tx(p("on roll", "नामांकित"))}` : full ? tx(p("Full", "भरी")) : `${left} ${tx(p("left", "खाली"))}`}
                          </span>
                          {c.seats ? (
                            <span style={{ display: "flex", width: "100%", height: 4, borderRadius: 2, background: "var(--s3)", overflow: "hidden" }}>
                              <span style={{ height: 4, width: `${fill * 100}%`, background: lc }} />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {tried[1] && step1Errors.classId ? <span role="alert" style={{ color: "var(--bad)", fontSize: 12, fontWeight: 600 }}>{tx(p("Pick a class", "कक्षा चुनें"))}</span> : null}
                  <Field label={tx(p("Previous school (if any)", "पिछला विद्यालय (यदि कोई)"))}>
                    <Input value={f.previousSchool} onChange={(e) => setF({ ...f, previousSchool: e.target.value })} placeholder={tx(p("Name and town", "नाम और शहर"))} />
                  </Field>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="push" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="card" style={card}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <Tile icon="users" />
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("Is a brother or sister already here?", "क्या भाई या बहन पहले से यहाँ पढ़ते हैं?"))}</span>
                      <span style={mut12}>{tx(p("Linking fills in the family. The 3rd-child rule then applies by itself.", "जोड़ने से परिवार भर जाता है। तीसरे बच्चे का नियम अपने-आप लगता है।"))}</span>
                    </span>
                  </div>
                  {fam.linked ? (
                    <div className="fadein" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "12px 14px", borderRadius: 14, background: "var(--oks)", color: "var(--ok)" }}>
                      <span style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: "var(--card)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Ic n="link" />
                      </span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180, color: "var(--fg)" }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{tx(p(`Linked to ${fam.linked.father}’s family`, `${fam.linked.father} के परिवार से जुड़ा`))}</span>
                        <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {fam.linked.kids.map((k) => (
                            <span key={k.id} className="pill" style={{ background: "var(--card)" }}>{firstName(k.name)} · {k.classLabel}</span>
                          ))}
                          {fam.linked.kids.length >= 2 ? <span className="pill" style={{ background: "var(--ok)", color: "var(--onsolid)", animation: "xPopIn .5s .15s var(--spring) both" }}>{tx(p("3rd-child rule applies on save", "सहेजने पर तीसरे बच्चे का नियम"))}</span> : null}
                        </span>
                      </span>
                      <Btn variant="ghost" style={{ height: 36, fontSize: 13 }} onClick={() => setFam({ ...fam, linked: null })}>{tx(p("Unlink", "हटाएँ"))}</Btn>
                    </div>
                  ) : (
                    <>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, height: 46, padding: "0 14px", borderRadius: 14, border: "1px solid var(--bds)", background: "var(--card)", color: "var(--mut)" }}>
                        <Ic n="search" />
                        <span className="sr">{tx(p("Find a family", "परिवार खोजें"))}</span>
                        <input type="search" value={famQ} onChange={(e) => void findFamily(e.target.value)} placeholder={tx(p("Surname, father’s name or phone — e.g. Sharma", "उपनाम, पिता का नाम या फ़ोन — जैसे Sharma"))} style={{ flex: 1, minWidth: 0, height: 40, border: 0, outline: "none", background: "transparent", fontSize: 15, color: "var(--fg)" }} />
                      </label>
                      {(famHits ?? []).slice(0, 3).map((h, i) => (
                        <div key={h.key} className="fadein" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 14, background: "var(--s2)", animationDelay: `${i * 30}ms` }}>
                          <Av name={h.father} size={36} style={{ background: "var(--card)", color: "var(--fg)" }} />
                          <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
                            <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{h.father}{h.village ? ` · ${h.village}` : ""}</span>
                            <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {h.kids.map((k) => (
                                <span key={k.id} className="pill" style={{ background: "var(--card)" }}>{firstName(k.name)} · {k.classLabel}</span>
                              ))}
                            </span>
                          </span>
                          <Btn variant="soft" icon="link" style={{ height: 36, padding: "0 12px", fontSize: 13 }} onClick={() => { setSibling({ q: famQ, hits: famHits, sel: h.key }); setSheet("sibling"); }}>{tx(p("Link", "जोड़ें"))}</Btn>
                        </div>
                      ))}
                      {famHits && famHits.length === 0 ? <span style={mut12}>{tx(p("No family found. Fill in the details below — you can link later.", "कोई परिवार नहीं मिला। नीचे विवरण भरें — बाद में जोड़ सकते हैं।"))}</span> : null}
                    </>
                  )}
                </div>
                <div className="card" style={card}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("Parents", "माता-पिता"))}</span>
                  <div className="pp-g2">
                    <Field label={tx(p("Father’s name", "पिता का नाम"))} error={err(2, step2Errors.fatherName, tx(p("Father’s or guardian’s name is needed", "पिता या अभिभावक का नाम ज़रूरी है")))}>
                      <Input value={fam.fatherName} invalid={Boolean(err(2, step2Errors.fatherName, "x"))} onChange={(e) => setFam({ ...fam, fatherName: e.target.value })} placeholder={tx(p("Father or guardian", "पिता या अभिभावक"))} />
                    </Field>
                    <Field label={tx(p("Mother’s name", "माता का नाम"))}>
                      <Input value={fam.motherName} onChange={(e) => setFam({ ...fam, motherName: e.target.value })} placeholder={tx(p("Mother’s name", "माता का नाम"))} />
                    </Field>
                    <Field label={tx(p("Phone", "फ़ोन"))} error={err(2, step2Errors.phone, phoneDigits.length ? `${tx(p("Phone needs 10 digits — this one has", "फ़ोन में 10 अंक चाहिए — इसमें हैं"))} ${phoneDigits.length}` : tx(p("A phone number is needed", "फ़ोन नंबर ज़रूरी है")))}>
                      <Input value={fam.phone} inputMode="tel" invalid={Boolean(err(2, step2Errors.phone, "x"))} onChange={(e) => setFam({ ...fam, phone: e.target.value })} placeholder={tx(p("10 digits", "10 अंक"))} />
                    </Field>
                    <div className="field">
                      <span>WhatsApp</span>
                      <button type="button" role="switch" aria-checked={fam.waSame} onClick={() => setFam({ ...fam, waSame: !fam.waSame })} className="tap" style={{ display: "flex", alignItems: "center", gap: 12, height: 44, padding: "0 12px", borderRadius: 12, border: "1px solid var(--bd)", background: "var(--card)", color: "var(--fg)", textAlign: "left" }}>
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{tx(p("Same number has WhatsApp", "इसी नंबर पर WhatsApp है"))}</span>
                        <span className={`sw${fam.waSame ? " on" : ""}`}><span /></span>
                      </button>
                    </div>
                  </div>
                  {!fam.waSame ? (
                    <Field label={tx(p("WhatsApp number", "WhatsApp नंबर"))} error={err(2, step2Errors.wa2, tx(p("WhatsApp number needs 10 digits", "WhatsApp नंबर में 10 अंक चाहिए")))}>
                      <Input value={fam.wa2} inputMode="tel" onChange={(e) => setFam({ ...fam, wa2: e.target.value })} placeholder={tx(p("Receipts and notices go here", "रसीदें और सूचनाएँ यहाँ जाएँगी"))} />
                    </Field>
                  ) : null}
                  <Field label={tx(p("Address", "पता"))}>
                    <Input value={fam.address} onChange={(e) => setFam({ ...fam, address: e.target.value })} placeholder={tx(p("House, street or mohalla", "मकान, गली या मोहल्ला"))} />
                  </Field>
                  <Field label={tx(p("Village or town", "गाँव या शहर"))}>
                    <Input value={fam.village} onChange={(e) => setFam({ ...fam, village: e.target.value })} />
                  </Field>
                </div>
              </div>
            ) : null}

            {step === 3 && cls ? (
              <div className="push" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="card" style={card}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <Tile icon="rupee" />
                    <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{cls.label} · {tx(p("fee plan", "फीस योजना"))}</span>
                      <span style={mut12}>
                        {tx(p("Tuition", "ट्यूशन"))} {rupees(plan.tuition)}
                        {plan.concession ? ` (${rupees(plan.concession)} ${tx(p("off", "छूट"))})` : ""} · {tx(p("academic fee", "शैक्षणिक शुल्क"))} {rupees(plan.academic)} · {plan.rows.length} {tx(p("installments", "किस्तें"))}
                      </span>
                    </span>
                    <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{rupees(plan.total)}</span>
                  </div>
                  <span className="sech" style={{ marginTop: 4 }}>{tx(p("School bus", "स्कूल बस"))}</span>
                  <div role="radiogroup" aria-label={tx(p("School bus", "स्कूल बस"))} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <button type="button" role="radio" aria-checked={!fee.routeId} className={`tap chip${!fee.routeId ? " on" : ""}`} onClick={() => setFee({ ...fee, routeId: "" })}>{tx(p("No bus", "बस नहीं"))}</button>
                    {ctx.routes.map((r) => (
                      <button key={r.id} type="button" role="radio" aria-checked={fee.routeId === r.id} className={`tap chip${fee.routeId === r.id ? " on" : ""}`} onClick={() => setFee({ ...fee, routeId: r.id })}>
                        {r.label} · {rupees(r.annual)}/{tx(p("yr", "वर्ष"))}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="card" style={{ padding: "6px 18px" }}>
                  <span className="sech" style={{ display: "block", paddingTop: 10 }}>{tx(p("Concession · one per child", "छूट · एक बच्चे पर एक"))}</span>
                  {otherPolicies.map((x, i) => (
                    <SwitchRow
                      key={x.id}
                      border={i > 0}
                      label={x.label}
                      sub={x.calculationType === "tuition_zero" ? tx(p("Free seat — tuition is zero", "मुफ़्त सीट — ट्यूशन शून्य")) : x.calculationType === "tuition_percentage" ? `${x.percentage ?? 0}% ${tx(p("of tuition", "ट्यूशन का"))}` : `${tx(p("Tuition becomes", "ट्यूशन होगा"))} ${rupees(x.fixedTuitionAmount ?? 0)}`}
                      on={fee.policyId === x.id}
                      onToggle={() => setFee({ ...fee, policyId: fee.policyId === x.id ? "" : x.id })}
                    />
                  ))}
                  {ctx.policies.some((x) => x.code === "third_child") ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 54, padding: "10px 2px", borderTop: otherPolicies.length ? "1px solid var(--bd)" : 0 }}>
                      <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600 }}>
                          {ctx.policies.find((x) => x.code === "third_child")?.label}
                          <span className="pill" style={{ background: "var(--accs)", color: "var(--accfg)" }}>{tx(p("Auto", "अपने-आप"))}</span>
                        </span>
                        <span style={mut12}>
                          {fam.linked
                            ? tx(p("Family linked: the fee engine applies the 3rd-child rule when you save.", "परिवार जुड़ा है: सहेजने पर तीसरे बच्चे का नियम अपने-आप लगेगा।"))
                            : tx(p("Link the family in step 2 to use this", "इसके लिए चरण 2 में परिवार जोड़ें"))}
                        </span>
                      </span>
                    </div>
                  ) : null}
                  {otherPolicies.length === 0 && !ctx.policies.some((x) => x.code === "third_child") ? <span style={{ ...mut12, display: "block", padding: "10px 0 12px" }}>{tx(p("No concessions are set in Fee setup.", "फीस सेटअप में कोई छूट नहीं है।"))}</span> : null}
                </div>
                <div className="card" style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("Installments", "किस्तें"))}</span>
                    <span style={mut12}>{tx(p("Updates as you choose", "चुनते ही बदलता है"))}</span>
                  </div>
                  {plan.rows.map((r) => (
                    <div key={r.label + r.dueDate} style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
                      <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{r.label}{r.dueDate ? ` · ${dayMonth(r.dueDate)}` : ""}</span>
                        {r.dueDate ? <span style={mut12}>{tx(p("Due", "देय"))} {dateLabel(r.dueDate)}</span> : null}
                      </span>
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{rupees(r.amount)}</span>
                        <span className="pill" style={{ background: r.due ? "var(--warns)" : "var(--s2)", color: r.due ? "var(--warnfg)" : "var(--mut)" }}>{r.due ? tx(p("Pending today", "आज बकाया")) : tx(p("Not due yet", "अभी देय नहीं"))}</span>
                      </span>
                    </div>
                  ))}
                  <div className="pp-g2" style={{ paddingTop: 4 }}>
                    <div style={{ display: "flex", flexDirection: "column", padding: "12px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)" }}>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{tx(p("Pending today if admitted now", "अभी प्रवेश पर आज बकाया"))}</span>
                      <span className="num" style={{ fontSize: 22, fontWeight: 700 }} aria-live="polite">{rupees(plan.pendingToday)}</span>
                      <span style={{ fontSize: 12 }}>{dueRows.length ? `${dueRows.map((r) => r.label).join(", ")} ${tx(p(dueRows.length === 1 ? "is already due" : "are already due", "पहले से देय"))}` : tx(p("Nothing is due yet", "अभी कुछ देय नहीं"))}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", padding: "12px 14px", borderRadius: 14, background: "var(--s2)", color: "var(--fg)" }}>
                      <span style={{ ...mut12, fontWeight: 700 }}>{tx(p("Not due yet", "अभी देय नहीं"))}</span>
                      <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{rupees(plan.notDueYet)}</span>
                      <span style={mut12}>{laterRows.filter((r) => r.dueDate).map((r) => dayMonth(r.dueDate)).join(", ") || "—"}</span>
                    </div>
                  </div>
                  <span style={mut12}>
                    {ctx.lateFee ? `${tx(p("Late fee", "विलंब शुल्क"))} ${rupees(ctx.lateFee)} ${tx(p("is always kept separate.", "हमेशा अलग रहता है।"))} ` : ""}
                    {tx(p("An estimate from Fee setup. The fee engine prepares the real installments when you save.", "फीस सेटअप से अनुमान। सहेजने पर असली किस्तें बनती हैं।"))}
                  </span>
                </div>
              </div>
            ) : null}

            {step === 4 && cls ? (
              <div className="push" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="card" style={card}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <Av name={f.fullName} size={60} font={22} serif />
                    <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                      <span className="serif clip" lang={f.nameHi ? "hi" : undefined} style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>{f.nameHi || f.fullName}</span>
                      {f.nameHi ? <span className="clip" style={{ fontSize: 15, fontWeight: 600 }}>{f.fullName}</span> : null}
                      <span style={mut12}>{[cls.label, genderText, kindText].filter(Boolean).join(" · ")}</span>
                    </span>
                  </div>
                  {[
                    { title: p("Student", "विद्यार्थी"), rows: [[tx(p("Date of birth", "जन्म तिथि")), dobIso ? dateLabel(dobIso) : ""], [tx(p("Class", "कक्षा")), cls.label], [tx(p("Previous school", "पिछला विद्यालय")), f.previousSchool]] as [string, string][] },
                    { title: p("Family", "परिवार"), rows: [[tx(p("Father", "पिता")), fam.fatherName], [tx(p("Mother", "माता")), fam.motherName], [tx(p("Phone", "फ़ोन")), `${maskPhone(fam.phone)}${fam.waSame ? " · WhatsApp" : ""}`], [tx(p("Village", "गाँव")), fam.village], ...(fam.linked ? [[tx(p("Sibling", "भाई-बहन")), fam.linked.kids.map((k) => k.name).join(", ")]] : [])] as [string, string][] },
                    { title: p("Fees", "फीस"), rows: [[tx(p("Bus", "बस")), route ? route.label : tx(p("No bus", "बस नहीं"))], [tx(p("Concession", "छूट")), policy ? policy.label : tx(p("None", "कोई नहीं"))], [tx(p("Pending today", "आज बकाया")), rupees(plan.pendingToday)], [tx(p("Not due yet", "अभी देय नहीं")), rupees(plan.notDueYet)]] as [string, string][] },
                  ].map((g) => (
                    <div key={g.title.en} style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid var(--bd)" }}>
                      <span className="sech">{tx(g.title)}</span>
                      {kv(g.rows)}
                    </div>
                  ))}
                </div>
                <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px" }}>
                  <Tile icon="hash" tone="info" />
                  <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(p("SR number to be given", "दिया जाने वाला SR नंबर"))}</span>
                    <span style={mut12}>{tx(p("The next free number, fixed when you save. Clear it to get a temporary one.", "अगला खाली नंबर, सहेजने पर तय। खाली छोड़ें तो अस्थायी नंबर मिलेगा।"))}</span>
                  </span>
                  <input aria-label={tx(p("SR number to be given", "दिया जाने वाला SR नंबर"))} className="num serif" value={sr} inputMode="numeric" onChange={(e) => setSr(e.target.value)} style={{ width: 110, textAlign: "right", fontSize: 28, fontWeight: 700, border: 0, borderBottom: "1.5px dashed var(--bds)", background: "transparent", color: "var(--fg)", outline: "none", padding: 0, animation: "xPopIn .5s var(--spring) both" }} />
                </div>
                <div className="card" style={{ padding: "10px 18px 6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("Documents received", "मिले हुए दस्तावेज़"))}</span>
                    <span className="pill" style={{ background: missingDocs ? "var(--warns)" : "var(--oks)", color: missingDocs ? "var(--warnfg)" : "var(--ok)" }}>
                      {missingDocs ? `${missingDocs} ${tx(p("to collect later", "बाद में लेने हैं"))}` : tx(p("All received", "सब मिल गए"))}
                    </span>
                  </div>
                  {DOCS.map((d, i) => (
                    <SwitchRow key={d.key} border={i > 0} label={tx(d.label)} sub={tx(d.sub)} on={Boolean(docs[d.key])} onToggle={() => setDocs({ ...docs, [d.key]: !docs[d.key] })} />
                  ))}
                </div>
                {saveError ? <Banner tone="bad">{saveError}</Banner> : null}
              </div>
            ) : null}
          </div>

          <ActionBar hint={hint} hintTone={bad ? "bad" : "mut"}>
            {step === 1 ? (
              <Btn variant="sec" href="/admissions" icon="chevLeft" style={{ minWidth: 110 }}>{tx(p("Cancel", "रद्द करें"))}</Btn>
            ) : (
              <Btn variant="sec" icon="chevLeft" onClick={() => setStep(step - 1)} style={{ minWidth: 110 }}>{tx(p("Back", "पीछे"))}</Btn>
            )}
            <Btn variant="pri" onClick={() => void next()} disabled={saving} style={{ minWidth: 170 }}>
              {step === 4 ? tx(p("Save admission", "प्रवेश सहेजें")) : `${tx(p("Next", "आगे"))}: ${tx(STEP_LABELS[step])}`}
              <Ic n={step === 4 ? "check" : "arrowRight"} />
            </Btn>
          </ActionBar>
        </div>
      </main>

      <DuplicateSheet
        open={sheet === "duplicate"}
        hits={dupes}
        adding={{ name: f.fullName, father: fam.fatherName, dob: dobIso, cls: cls?.label ?? "", phone: fam.phone }}
        onClose={() => setSheet(null)}
        onDifferent={() => {
          setDupOk(true);
          setSheet(null);
          setStep(3);
          toast.show({ text: tx(p("Noted · added as a different child", "दर्ज · अलग बच्चे के रूप में")) });
        }}
        onOpen={(id) => router.push(`/admissions/${id}`)}
      />
      <SiblingSheet
        key={`${sibling.q}|${sibling.sel ?? ""}`}
        open={sheet === "sibling"}
        childName={f.fullName}
        initialQuery={sibling.q}
        initialHits={sibling.hits}
        initialSel={sibling.sel}
        onClose={() => setSheet(null)}
        onLink={(family) => {
          setFam({
            ...fam,
            linked: family,
            fatherName: fam.fatherName || family.father,
            motherName: fam.motherName || family.mother || "",
            phone: fam.phone || family.phone || "",
            address: fam.address || family.address || "",
            village: fam.village || family.village || "",
          });
          setSheet(null);
          setFamQ("");
          setFamHits(null);
          toast.show({ text: tx(p(`Linked to ${family.father}’s family`, `${family.father} के परिवार से जुड़ा`)) });
        }}
      />
    </>
  );
}

export function DuplicateSheet({
  open,
  hits,
  adding,
  onClose,
  onDifferent,
  onOpen,
}: {
  open: boolean;
  hits: DuplicateHit[];
  adding: { name: string; father: string; dob: string | null; cls: string; phone: string };
  onClose: () => void;
  onDifferent: () => void;
  onOpen: (id: string) => void;
}) {
  const { tx } = useVx();
  const ex = hits[0];
  if (!ex) return null;
  const rows: [string, string, string][] = [
    [tx(p("Name", "नाम")), adding.name, ex.fullName],
    [tx(p("Father", "पिता")), adding.father, ex.fatherName ?? "—"],
    [tx(p("Born", "जन्म")), dobForInput(adding.dob), dobForInput(ex.dateOfBirth)],
    [tx(p("Class", "कक्षा")), adding.cls, ex.classLabel],
    [tx(p("Phone", "फ़ोन")), maskPhone(adding.phone), maskPhone(ex.phone)],
    [tx(p("Added", "जोड़ा गया")), tx(p("Now", "अभी")), dateLabel(ex.createdAt)],
  ];
  const cell = { padding: "9px 10px", borderTop: "1px solid var(--bd)", fontWeight: 600 } as const;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title={tx(p("This child may already be in school", "यह बच्चा शायद पहले से विद्यालय में है"))}
      sub={`${tx(p("Same name, father and date of birth as SR", "नाम, पिता और जन्म तिथि मिलती है: SR"))} ${ex.admissionNo} · ${ex.classLabel}`}
      footer={
        <>
          <Btn variant="sec" style={{ flex: 1 }} onClick={() => onOpen(ex.id)}>{tx(p("Open existing", "पुराना रिकॉर्ड खोलें"))}</Btn>
          <Btn variant="pri" style={{ flex: 1.4 }} onClick={onDifferent}>{tx(p("It’s a different child, continue", "यह अलग बच्चा है, आगे बढ़ें"))}</Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
        <div style={{ display: "grid", gridTemplateColumns: "84px minmax(0,1fr) minmax(0,1fr)", gap: "0 8px", fontSize: 13 }}>
          <span />
          <span className="sech" style={{ padding: "8px 10px", borderRadius: "10px 10px 0 0", background: "var(--accs)", color: "var(--accfg)" }}>{tx(p("You are adding", "आप जोड़ रहे हैं"))}</span>
          <span className="sech" style={{ padding: "8px 10px", borderRadius: "10px 10px 0 0", background: "var(--s2)", color: "var(--fg)" }}>{tx(p("Already in school", "पहले से विद्यालय में"))}</span>
          {rows.map(([k, a, b]) => {
            const same = a.trim() !== "" && a.trim().toLowerCase() === b.trim().toLowerCase();
            return (
              <div key={k} style={{ display: "contents" }}>
                <span style={{ padding: "9px 0", borderTop: "1px solid var(--bd)", color: "var(--mut)" }}>{k}</span>
                <span className="clip" style={{ ...cell, background: "var(--accs)" }}>{a || "—"}</span>
                <span style={{ ...cell, background: "var(--s2)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="clip" style={{ flex: 1, minWidth: 0 }}>{b || "—"}</span>
                  {same ? <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>{tx(p("Same", "समान"))}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 6, padding: "12px 14px", borderRadius: 14, background: "var(--s2)", fontSize: 13, lineHeight: 1.5 }}>
          <Ic n="info" style={{ marginTop: 2 }} />
          <span>{tx(p("Two records mean double fees and reminders. If it is the same child, open the existing one.", "दो रिकॉर्ड का मतलब दोगुनी फीस और रिमाइंडर। एक ही बच्चा है तो पुराना रिकॉर्ड खोलें।"))}</span>
        </div>
        {hits.length > 1 ? <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{hits.length - 1} {tx(p("more possible matches", "और संभावित मिलान"))}: {hits.slice(1).map((h) => `SR ${h.admissionNo}`).join(", ")}</p> : null}
      </div>
    </Sheet>
  );
}

export function SiblingSheet({
  open,
  childName,
  onClose,
  onLink,
  initialQuery = "",
  initialHits = null,
  initialSel = null,
}: {
  open: boolean;
  childName: string;
  onClose: () => void;
  onLink: (f: FamilyCard) => void;
  initialQuery?: string;
  initialHits?: FamilyCard[] | null;
  initialSel?: string | null;
}) {
  const { tx } = useVx();
  const [q, setQ] = useState(initialQuery);
  const [hits, setHits] = useState<FamilyCard[] | null>(initialHits);
  const [sel, setSel] = useState<string | null>(initialSel);
  const [busy, setBusy] = useState(false);

  async function search(value: string) {
    setQ(value);
    if (value.trim().length < 2) {
      setHits(null);
      return;
    }
    setBusy(true);
    try {
      setHits(await searchFamiliesAction(value));
    } finally {
      setBusy(false);
    }
  }

  const chosen = hits?.find((h) => h.key === sel) ?? null;
  const first = firstName(childName) || tx(p("this child", "इस बच्चे"));
  let count: ReactNode = null;
  if (busy) count = tx(p("Searching…", "खोज रहे हैं…"));
  else if (hits && hits.length) count = `${hits.length} ${hits.length === 1 ? tx(p("family found", "परिवार मिला")) : tx(p("families found", "परिवार मिले"))}`;
  else if (hits) count = tx(p("No match — try a phone number", "कुछ नहीं मिला — फ़ोन नंबर से खोजें"));
  else count = tx(p("Type at least 2 letters", "कम से कम 2 अक्षर लिखें"));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(p(`Link ${first} to a family`, `${first} को परिवार से जोड़ें`))}
      sub={tx(p("Pick the family where a brother or sister already studies", "वह परिवार चुनें जिसका भाई या बहन पहले से पढ़ता है"))}
      footer={
        <>
          <Btn variant="sec" style={{ flex: 1 }} onClick={onClose}>{tx(p("Cancel", "रद्द करें"))}</Btn>
          <Btn variant="pri" style={{ flex: 1.4, opacity: chosen ? 1 : 0.5 }} disabled={!chosen} onClick={() => chosen && onLink(chosen)}>{tx(p("Link family", "परिवार जोड़ें"))}</Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 14px", borderRadius: 14, border: "1px solid var(--bds)", background: "var(--card)", color: "var(--mut)" }}>
          <Ic n="search" />
          <span className="sr">{tx(p("Search families", "परिवार खोजें"))}</span>
          <input type="search" value={q} onChange={(e) => void search(e.target.value)} placeholder={tx(p("Surname, father or phone", "उपनाम, पिता या फ़ोन"))} style={{ flex: 1, minWidth: 0, height: 40, border: 0, outline: "none", background: "transparent", fontSize: 15, color: "var(--fg)" }} />
        </label>
        <span className="sech" style={{ marginTop: 4 }}>{count}</span>
        <div role="radiogroup" aria-label={tx(p("Families", "परिवार"))} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {hits?.map((h, i) => (
            <RadioTile key={h.key} on={sel === h.key} onPick={() => setSel(h.key)} style={{ animation: `xIn .3s var(--ease) ${i * 30}ms both` }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
                <span className="clip" style={{ fontSize: 14, fontWeight: 700 }}>
                  {h.father}
                  {h.mother ? <span style={{ color: "var(--mut)", fontWeight: 500 }}> · {h.mother}</span> : null}
                </span>
                <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {h.kids.map((k) => (
                    <span key={k.id} className="pill" style={{ background: "var(--s2)", color: "var(--fg)" }}>{firstName(k.name)} · {k.classLabel}</span>
                  ))}
                </span>
                <span className="num" style={mut12}>{maskPhone(h.phone)}{h.village ? ` · ${h.village}` : ""}</span>
              </span>
            </RadioTile>
          ))}
        </div>
        {chosen ? (
          <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 14, background: chosen.kids.length >= 2 ? "var(--oks)" : "var(--s2)", color: chosen.kids.length >= 2 ? "var(--ok)" : "var(--fg)", fontSize: 13, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 700 }}>{chosen.kids.length >= 2 ? tx(p(`Third child for ${first}`, `${first} तीसरा बच्चा`)) : tx(p("What linking does", "जोड़ने से क्या होगा"))}</span>
            <span>
              {chosen.kids.length >= 2
                ? tx(p("This will be the third child or later: the fee engine applies the 3rd-child policy to the youngest when you save. Parents, phone and address are filled in for you.", "यह तीसरा बच्चा होगा: सहेजने पर सबसे छोटे पर तीसरे बच्चे की नीति लगेगी। माता-पिता, फ़ोन और पता भर दिए जाएँगे।"))
                : tx(p("Parents, phone and address are filled in for you. Receipts stay with each child.", "माता-पिता, फ़ोन और पता भर दिए जाएँगे। रसीदें हर बच्चे के साथ रहती हैं।"))}
            </span>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
