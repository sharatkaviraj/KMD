"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { admitAction, checkDuplicateAction, searchFamiliesAction, type DuplicateHit } from "@/app/(app)/admissions/actions";
import { rupees, dateLabel, initials } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";
import { Chip, ChipRow, Field, Input, RadioCard, SearchBox, Seg, Switch, WizardSteps } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Avatar, Btn, Card, IconTile, Money, Pill, SecHead, Stat } from "@/vx/ui/primitives";

import type { DocKey } from "@/vx/screens/admissions/data";
import {
  ageFit,
  buildFeePlan,
  dobForInput,
  maskPhone,
  normalizeMobile,
  parseDob,
  type FamilyCard,
} from "@/vx/screens/admissions/logic";
import { ActionBar, KV, PeopleStyles } from "@/vx/screens/admissions/ui";

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
export type WizardPrefill = { enquiryId: string | null; fullName: string; classId: string; fatherName: string; phone: string };

type Gender = "" | "Male" | "Female";
type Kind = "new" | "existing";

const STEP_LABELS = [p("Student", "विद्यार्थी"), p("Family", "परिवार"), p("Fees", "फीस"), p("Review", "जाँचें")];
const DOCS: { key: DocKey; label: ReturnType<typeof p>; sub: ReturnType<typeof p> }[] = [
  { key: "birth", label: p("Birth certificate", "जन्म प्रमाण पत्र"), sub: p("Copy checked with the original", "मूल से मिलाकर") },
  { key: "tc", label: p("TC from the old school", "पुराने विद्यालय की टीसी"), sub: p("Needed for Class 1 and above", "कक्षा 1 और ऊपर के लिए") },
  { key: "photo", label: p("Passport photo", "पासपोर्ट फ़ोटो"), sub: p("Two copies", "दो प्रति") },
  { key: "aadhaar", label: p("Aadhaar card copy", "आधार कार्ड की कॉपी"), sub: p("Only the last 4 digits are kept", "केवल आख़िरी 4 अंक रखे जाते हैं") },
  { key: "address", label: p("Address proof", "पते का प्रमाण"), sub: p("Any utility bill or ration card", "बिजली बिल या राशन कार्ड") },
];

export function AdmissionWizard({ ctx, prefill, initialStep }: { ctx: WizardContext; prefill: WizardPrefill; initialStep: number }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState(Math.min(4, Math.max(1, initialStep)));
  const [tried, setTried] = useState<Record<number, boolean>>({});
  const [f, setF] = useState({ fullName: prefill.fullName, nameHi: "", dob: "", gender: "" as Gender, kind: "new" as Kind, classId: prefill.classId, previousSchool: "" });
  const [fam, setFam] = useState({ fatherName: prefill.fatherName, motherName: "", phone: prefill.phone, waSame: true, wa2: "", address: "", village: "", linked: null as FamilyCard | null });
  const [fee, setFee] = useState({ routeId: "", policyId: "" });
  const [docs, setDocs] = useState<Partial<Record<DocKey, boolean>>>({});
  const [sr, setSr] = useState(ctx.nextSr);
  const [sheet, setSheet] = useState<"duplicate" | "sibling" | null>(null);
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

  const hint =
    step === 1
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

  const err = (s: number, on: boolean, text: string) => (tried[s] && on ? text : undefined);

  return (
    <>
      <PeopleStyles />
      <div className="pp-wrap" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card style={{ padding: "16px 20px" }}>
          <WizardSteps steps={STEP_LABELS.map((s) => tx(s))} current={step - 1} />
        </Card>

        {step === 1 ? (
          <>
            <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label={tx(p("Child’s name (English)", "बच्चे का नाम (अंग्रेज़ी)"))} error={err(1, step1Errors.fullName, tx(p("Write the child's name", "बच्चे का नाम लिखें")))}>
                <Input value={f.fullName} invalid={Boolean(err(1, step1Errors.fullName, "x"))} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoComplete="off" />
              </Field>
              <Field label={tx(p("Name in Hindi", "नाम हिंदी में"))} hint={tx(p("Printed on the TC and report card", "टीसी और रिपोर्ट कार्ड पर छपता है"))}>
                <Input value={f.nameHi} lang="hi" onChange={(e) => setF({ ...f, nameHi: e.target.value })} />
              </Field>
              <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
                <Field label={tx(p("Date of birth", "जन्म तिथि"))} error={err(1, step1Errors.dob, tx(p("Write the date like 21-08-2019", "तारीख़ ऐसे लिखें: 21-08-2019")))}>
                  <Input value={f.dob} placeholder="DD-MM-YYYY" inputMode="numeric" invalid={Boolean(err(1, step1Errors.dob, "x"))} onChange={(e) => setF({ ...f, dob: e.target.value })} />
                  {dobIso && fit ? (
                    <span style={{ fontSize: 12, fontWeight: 600, color: fit.fit === "right" ? "var(--ok)" : fit.fit === "unknown" ? "var(--mut)" : "var(--warnfg)" }}>
                      {dateLabel(dobIso)} · {fit.years} {tx(p("yrs", "वर्ष"))} {fit.months} {tx(p("mo on 1 Jul", "माह, 1 जुलाई को"))}
                      {cls && fit.fit === "right" ? ` · ${tx(p("right age for", "सही उम्र"))} ${cls.label}` : ""}
                      {cls && fit.fit === "young" ? ` · ${tx(p("young for", "छोटा है"))} ${cls.label}` : ""}
                      {cls && fit.fit === "old" ? ` · ${tx(p("older than most in", "बड़ा है"))} ${cls.label}` : ""}
                    </span>
                  ) : null}
                </Field>
                <Field label={tx(p("Gender", "लिंग"))}>
                  <Seg<"Male" | "Female">
                    value={(f.gender || "Male") as "Male" | "Female"}
                    onChange={(g) => setF({ ...f, gender: g })}
                    options={[
                      { value: "Male", label: tx(p("Boy", "लड़का")) },
                      { value: "Female", label: tx(p("Girl", "लड़की")) },
                    ]}
                  />
                </Field>
                <Field label={tx(p("New or returning", "नया या पुराना"))}>
                  <Seg<Kind>
                    value={f.kind}
                    onChange={(k) => setF({ ...f, kind: k })}
                    options={[
                      { value: "new", label: tx(p("New to school", "नया")) },
                      { value: "existing", label: tx(p("Was here before", "पहले यहाँ था")) },
                    ]}
                  />
                </Field>
              </div>
            </Card>
            <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ fontSize: 16 }}>{tx(p("Class", "कक्षा"))}</strong>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Seats left this session", "इस सत्र में खाली सीटें"))}</span>
              </div>
              {tried[1] && step1Errors.classId ? <span role="alert" style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600 }}>{tx(p("Pick a class", "कक्षा चुनें"))}</span> : null}
              <div className="pp-tiles" role="radiogroup" aria-label={tx(p("Class", "कक्षा"))}>
                {ctx.classes.map((c) => {
                  const left = c.seats === null ? null : Math.max(0, c.seats - c.onRoll);
                  const full = left === 0;
                  const on = c.id === f.classId;
                  const fill = c.seats ? Math.min(1, c.onRoll / c.seats) : 0;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className="tap"
                      onClick={() => (full ? toast.show({ text: `${c.label} ${tx(p("is full. Pick another class or keep the enquiry open.", "भरी हुई है। दूसरी कक्षा चुनें।"))}`, tone: "bad" }) : setF({ ...f, classId: c.id }))}
                      style={{ textAlign: "left", padding: "10px 10px 8px", borderRadius: 12, border: `1.5px solid ${on ? "var(--acc)" : "var(--bd)"}`, background: on ? "var(--accs)" : "var(--card)", color: full ? "var(--sub)" : "var(--fg)", display: "flex", flexDirection: "column", gap: 4, minHeight: 60 }}
                    >
                      <strong style={{ fontSize: 13 }}>{c.label}</strong>
                      <span style={{ fontSize: 11, color: full ? "var(--bad)" : left !== null && left <= 2 ? "var(--warnfg)" : "var(--ok)" }}>
                        {left === null ? `${c.onRoll} ${tx(p("on roll", "नामांकित"))}` : full ? tx(p("Full", "भरी")) : `${left} ${tx(p("left", "खाली"))}`}
                      </span>
                      {c.seats ? <span style={{ height: 4, borderRadius: 2, background: "var(--s3)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${fill * 100}%`, background: fill > 0.95 ? "var(--bad)" : fill > 0.85 ? "var(--warn)" : "var(--ok)" }} /></span> : null}
                    </button>
                  );
                })}
              </div>
              <Field label={tx(p("Previous school (if any)", "पिछला विद्यालय (यदि कोई)"))}>
                <Input value={f.previousSchool} onChange={(e) => setF({ ...f, previousSchool: e.target.value })} />
              </Field>
            </Card>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <IconTile icon="users" tone="acc" />
                <span style={{ flex: 1 }}>
                  <strong style={{ display: "block" }}>{tx(p("Is a brother or sister already here?", "क्या भाई या बहन पहले से यहाँ पढ़ते हैं?"))}</strong>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Linking fills in the family. The 3rd-child rule then applies by itself.", "जोड़ने से परिवार भर जाता है। तीसरे बच्चे का नियम अपने-आप लगता है।"))}</span>
                </span>
              </div>
              {fam.linked ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, background: "var(--oks)" }}>
                  <Ic n="link" size={18} style={{ color: "var(--ok)" }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block" }}>{tx(p("Linked to", "जुड़ा"))} {fam.linked.father}{tx(p("’s family", " का परिवार"))}</strong>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{fam.linked.kids.map((k) => `${k.name} · ${k.classLabel}`).join(", ")}</span>
                  </span>
                  <Btn variant="ghost" onClick={() => setFam({ ...fam, linked: null })}>{tx(p("Unlink", "हटाएँ"))}</Btn>
                </div>
              ) : (
                <Btn variant="sec" icon="search" onClick={() => setSheet("sibling")}>{tx(p("Find a family", "परिवार खोजें"))}</Btn>
              )}
            </Card>
            <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <SecHead>{tx(p("Parents", "माता-पिता"))}</SecHead>
              <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
                <Field label={tx(p("Father’s name", "पिता का नाम"))} error={err(2, step2Errors.fatherName, tx(p("Father's name is needed", "पिता का नाम ज़रूरी है")))}>
                  <Input value={fam.fatherName} invalid={Boolean(err(2, step2Errors.fatherName, "x"))} onChange={(e) => setFam({ ...fam, fatherName: e.target.value })} />
                </Field>
                <Field label={tx(p("Mother’s name", "माता का नाम"))}>
                  <Input value={fam.motherName} onChange={(e) => setFam({ ...fam, motherName: e.target.value })} />
                </Field>
                <Field label={tx(p("Phone", "फ़ोन"))} error={err(2, step2Errors.phone, phoneDigits.length ? `${tx(p("Phone needs 10 digits — this one has", "फ़ोन में 10 अंक चाहिए — इसमें हैं"))} ${phoneDigits.length}` : tx(p("A phone number is needed", "फ़ोन नंबर ज़रूरी है")))}>
                  <Input value={fam.phone} inputMode="tel" invalid={Boolean(err(2, step2Errors.phone, "x"))} onChange={(e) => setFam({ ...fam, phone: e.target.value })} />
                </Field>
                <Field label="WhatsApp">
                  <span style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44 }}>
                    <Switch on={fam.waSame} onChange={(v) => setFam({ ...fam, waSame: v })} label={tx(p("Same number has WhatsApp", "इसी नंबर पर WhatsApp है"))} />
                    <span style={{ fontSize: 13 }}>{tx(p("Same number has WhatsApp", "इसी नंबर पर WhatsApp है"))}</span>
                  </span>
                </Field>
                {!fam.waSame ? (
                  <Field label={tx(p("WhatsApp number", "WhatsApp नंबर"))} error={err(2, step2Errors.wa2, tx(p("10 digits", "10 अंक")))}>
                    <Input value={fam.wa2} inputMode="tel" onChange={(e) => setFam({ ...fam, wa2: e.target.value })} />
                  </Field>
                ) : null}
                <Field label={tx(p("Address", "पता"))}>
                  <Input value={fam.address} onChange={(e) => setFam({ ...fam, address: e.target.value })} />
                </Field>
                <Field label={tx(p("Village or town", "गाँव या शहर"))}>
                  <Input value={fam.village} onChange={(e) => setFam({ ...fam, village: e.target.value })} />
                </Field>
              </div>
            </Card>
          </>
        ) : null}

        {step === 3 && cls ? (
          <>
            <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <IconTile icon="rupee" tone="acc" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: 16 }}>{cls.label} · {tx(p("fee plan", "फीस योजना"))}</strong>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>
                    {tx(p("Tuition", "ट्यूशन"))} {rupees(plan.tuition)}
                    {plan.concession ? ` (${rupees(plan.concession)} ${tx(p("off", "छूट"))})` : ""} · {tx(p("academic fee", "शैक्षणिक शुल्क"))} {rupees(plan.academic)} · {plan.rows.length} {tx(p("installments", "किस्तें"))}
                  </span>
                </span>
                <Money value={plan.total} style={{ fontSize: 18, fontWeight: 700 }} />
              </div>
              <SecHead>{tx(p("School bus", "स्कूल बस"))}</SecHead>
              <ChipRow label={tx(p("School bus", "स्कूल बस"))}>
                <Chip on={!fee.routeId} onClick={() => setFee({ ...fee, routeId: "" })}>{tx(p("No bus", "बस नहीं"))}</Chip>
                {ctx.routes.map((r) => (
                  <Chip key={r.id} on={fee.routeId === r.id} onClick={() => setFee({ ...fee, routeId: r.id })}>
                    {r.label} · {rupees(r.annual)}/{tx(p("yr", "वर्ष"))}
                  </Chip>
                ))}
              </ChipRow>
            </Card>
            <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SecHead>{tx(p("Concession · one per child", "छूट · एक बच्चे पर एक"))}</SecHead>
              <RadioCard checked={!fee.policyId} onSelect={() => setFee({ ...fee, policyId: "" })} title={tx(p("No concession", "कोई छूट नहीं"))} sub={tx(p("The class fee as set in Fee setup", "फीस सेटअप में तय कक्षा शुल्क"))} />
              {ctx.policies
                .filter((x) => x.code !== "third_child")
                .map((x) => (
                  <RadioCard
                    key={x.id}
                    checked={fee.policyId === x.id}
                    onSelect={() => setFee({ ...fee, policyId: x.id })}
                    title={x.label}
                    sub={x.calculationType === "tuition_zero" ? tx(p("Free seat — tuition is zero", "मुफ़्त सीट — ट्यूशन शून्य")) : x.calculationType === "tuition_percentage" ? `${x.percentage ?? 0}% ${tx(p("of tuition", "ट्यूशन का"))}` : `${tx(p("Tuition becomes", "ट्यूशन होगा"))} ${rupees(x.fixedTuitionAmount ?? 0)}`}
                  />
                ))}
              {ctx.policies.some((x) => x.code === "third_child") ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", borderRadius: 14, background: "var(--s2)" }}>
                  <Pill tone="acc">{tx(p("Auto", "अपने-आप"))}</Pill>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>
                    {fam.linked
                      ? tx(p("Family linked: the 3rd-child rule is applied by the fee engine when you save.", "परिवार जुड़ा है: सहेजने पर तीसरे बच्चे का नियम अपने-आप लगेगा।"))
                      : tx(p("3rd-child rule: link the family in step 2 to use it.", "तीसरे बच्चे का नियम: चरण 2 में परिवार जोड़ें।"))}
                  </span>
                </div>
              ) : null}
            </Card>
            <Card pad={false} style={{ overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 18px" }}>
                <strong>{tx(p("Installments", "किस्तें"))}</strong>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Updates as you choose", "चुनते ही बदलता है"))}</span>
              </div>
              {plan.rows.map((r) => (
                <div key={r.label + r.dueDate} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--bd)" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block" }}>{r.label}{r.dueDate ? ` · ${dateLabel(r.dueDate)}` : ""}</strong>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <Money value={r.amount} style={{ fontWeight: 700 }} />
                    <Pill tone={r.due ? "warn" : "mut"}>{r.due ? tx(p("Pending today", "आज बकाया")) : tx(p("Not due yet", "अभी देय नहीं"))}</Pill>
                  </span>
                </div>
              ))}
              <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12, padding: "14px 18px", borderTop: "1px solid var(--bd)", background: "var(--s2)" }}>
                <Stat label={tx(p("Pending today if admitted now", "अभी प्रवेश पर आज बकाया"))} value={rupees(plan.pendingToday)} tone="var(--warnfg)" />
                <Stat label={tx(p("Not due yet", "अभी देय नहीं"))} value={rupees(plan.notDueYet)} sub={ctx.lateFee ? `${tx(p("Late fee", "विलंब शुल्क"))} ${rupees(ctx.lateFee)} ${tx(p("is always kept separate", "हमेशा अलग रहता है"))}` : undefined} />
              </div>
            </Card>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("An estimate from Fee setup. The fee engine prepares the real installments when you save.", "फीस सेटअप से अनुमान। सहेजने पर असली किस्तें बनती हैं।"))}</span>
          </>
        ) : null}

        {step === 4 && cls ? (
          <>
            <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar text={initials(f.fullName)} seed={f.fullName} size={52} />
              <span style={{ minWidth: 0 }}>
                {f.nameHi ? <span lang="hi" style={{ display: "block", fontSize: 13, color: "var(--mut)" }}>{f.nameHi}</span> : null}
                <strong className="serif" style={{ display: "block", fontSize: 20 }}>{f.fullName}</strong>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>
                  {cls.label} · {f.gender === "Female" ? tx(p("Girl", "लड़की")) : f.gender === "Male" ? tx(p("Boy", "लड़का")) : "—"} · {f.kind === "new" ? tx(p("New to school", "नया")) : tx(p("Was here before", "पहले यहाँ था"))}
                </span>
              </span>
            </Card>
            <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
              <Card>
                <SecHead action={<Btn variant="ghost" onClick={() => setStep(1)} icon="edit">{tx(p("Edit", "बदलें"))}</Btn>}>{tx(p("Student", "विद्यार्थी"))}</SecHead>
                <KV k={tx(p("Date of birth", "जन्म तिथि"))} v={dobIso ? dateLabel(dobIso) : "—"} />
                <KV k={tx(p("Class", "कक्षा"))} v={cls.label} />
                <KV k={tx(p("Previous school", "पिछला विद्यालय"))} v={f.previousSchool || "—"} />
              </Card>
              <Card>
                <SecHead action={<Btn variant="ghost" onClick={() => setStep(2)} icon="edit">{tx(p("Edit", "बदलें"))}</Btn>}>{tx(p("Family", "परिवार"))}</SecHead>
                <KV k={tx(p("Father", "पिता"))} v={fam.fatherName} />
                <KV k={tx(p("Mother", "माता"))} v={fam.motherName || "—"} />
                <KV k={tx(p("Phone", "फ़ोन"))} v={`${maskPhone(fam.phone)}${fam.waSame ? " · WhatsApp" : ""}`} />
                <KV k={tx(p("Village", "गाँव"))} v={fam.village || "—"} />
                {fam.linked ? <KV k={tx(p("Sibling", "भाई-बहन"))} v={fam.linked.kids.map((k) => k.name).join(", ")} /> : null}
              </Card>
              <Card>
                <SecHead action={<Btn variant="ghost" onClick={() => setStep(3)} icon="edit">{tx(p("Edit", "बदलें"))}</Btn>}>{tx(p("Fees", "फीस"))}</SecHead>
                <KV k={tx(p("Bus", "बस"))} v={route ? route.label : tx(p("No bus", "बस नहीं"))} />
                <KV k={tx(p("Concession", "छूट"))} v={policy ? policy.label : tx(p("None", "कोई नहीं"))} />
                <KV k={tx(p("Pending today", "आज बकाया"))} v={rupees(plan.pendingToday)} />
                <KV k={tx(p("Not due yet", "अभी देय नहीं"))} v={rupees(plan.notDueYet)} />
              </Card>
              <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Field label={tx(p("SR number to be given", "दिया जाने वाला SR नंबर"))} hint={tx(p("The next free number. Clear it to get a temporary one.", "अगला खाली नंबर। खाली छोड़ें तो अस्थायी नंबर मिलेगा।"))}>
                  <Input value={sr} inputMode="numeric" onChange={(e) => setSr(e.target.value)} />
                </Field>
              </Card>
            </div>
            <Card style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <SecHead>{tx(p("Documents received", "मिले हुए दस्तावेज़"))} · {Object.values(docs).filter(Boolean).length}/{DOCS.length}</SecHead>
              {DOCS.map((d) => (
                <label key={d.key} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48, cursor: "pointer" }}>
                  <input type="checkbox" checked={Boolean(docs[d.key])} onChange={(e) => setDocs({ ...docs, [d.key]: e.target.checked })} style={{ width: 20, height: 20, accentColor: "var(--acc)" }} />
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <strong style={{ fontSize: 14 }}>{tx(d.label)}</strong>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(d.sub)}</span>
                  </span>
                </label>
              ))}
            </Card>
            {saveError ? <Banner tone="bad">{saveError}</Banner> : null}
          </>
        ) : null}
      </div>

      <ActionBar hint={hint}>
        {step === 1 ? (
          <Btn variant="sec" href="/admissions" icon="chevLeft">{tx(p("Cancel", "रद्द करें"))}</Btn>
        ) : (
          <Btn variant="sec" icon="chevLeft" onClick={() => setStep(step - 1)}>{tx(p("Back", "पीछे"))}</Btn>
        )}
        <Btn variant="pri" onClick={() => void next()} disabled={saving}>
          {step === 4 ? tx(p("Save admission", "प्रवेश सहेजें")) : `${tx(p("Next", "आगे"))}: ${tx(STEP_LABELS[step])}`}
          <Ic n={step === 4 ? "check" : "arrowRight"} size={18} />
        </Btn>
      </ActionBar>

      <DuplicateSheet
        open={sheet === "duplicate"}
        hits={dupes}
        adding={{ name: f.fullName, father: fam.fatherName, dob: dobIso, cls: cls?.label ?? "", phone: fam.phone }}
        onClose={() => setSheet(null)}
        onDifferent={() => {
          setDupOk(true);
          setSheet(null);
          setStep(3);
        }}
        onOpen={(id) => router.push(`/admissions/${id}`)}
      />
      <SiblingSheet
        open={sheet === "sibling"}
        childName={f.fullName}
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
          toast.show({ text: `${tx(p("Linked to", "जुड़ा"))} ${family.father}` });
        }}
      />
    </>
  );
}

function DuplicateSheet({
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
      <div style={{ display: "grid", gridTemplateColumns: "minmax(70px,.6fr) minmax(0,1fr) minmax(0,1fr)", gap: 0, fontSize: 14 }}>
        <span />
        <span className="sech" style={{ padding: "8px 10px", background: "var(--accs)" }}>{tx(p("You are adding", "आप जोड़ रहे हैं"))}</span>
        <span className="sech" style={{ padding: "8px 10px", background: "var(--s2)" }}>{tx(p("Already in school", "पहले से विद्यालय में"))}</span>
        {rows.map(([k, a, b]) => {
          const same = a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();
          return (
            <div key={k} style={{ display: "contents" }}>
              <span style={{ padding: "10px 0", color: "var(--mut)", borderTop: "1px solid var(--bd)" }}>{k}</span>
              <span style={{ padding: "10px", fontWeight: 600, background: "var(--accs)", borderTop: "1px solid var(--bd)" }}>{a || "—"}</span>
              <span style={{ padding: "10px", fontWeight: 600, background: "var(--s2)", borderTop: "1px solid var(--bd)", display: "flex", justifyContent: "space-between", gap: 6 }}>
                {b || "—"}
                {same ? <Pill tone="warn">{tx(p("Same", "समान"))}</Pill> : null}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14 }}>
        <Banner tone="info">{tx(p("Two records mean double fees and reminders. If it is the same child, open the existing one.", "दो रिकॉर्ड का मतलब दोगुनी फीस और रिमाइंडर। एक ही बच्चा है तो पुराना रिकॉर्ड खोलें।"))}</Banner>
      </div>
      {hits.length > 1 ? <p style={{ fontSize: 13, color: "var(--mut)" }}>{hits.length - 1} {tx(p("more possible matches", "और संभावित मिलान"))}: {hits.slice(1).map((h) => `SR ${h.admissionNo}`).join(", ")}</p> : null}
    </Sheet>
  );
}

function SiblingSheet({ open, childName, onClose, onLink }: { open: boolean; childName: string; onClose: () => void; onLink: (f: FamilyCard) => void }) {
  const { tx } = useVx();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FamilyCard[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
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
  const first = childName.trim().split(/\s+/)[0] || tx(p("this child", "इस बच्चे"));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${tx(p("Link", "जोड़ें"))} ${first} ${tx(p("to a family", "को परिवार से"))}`}
      sub={tx(p("Pick the family where a brother or sister already studies", "वह परिवार चुनें जिसका भाई या बहन पहले से पढ़ता है"))}
      footer={
        <>
          <Btn variant="sec" style={{ flex: 1 }} onClick={onClose}>{tx(p("Cancel", "रद्द करें"))}</Btn>
          <Btn variant="pri" style={{ flex: 1 }} disabled={!chosen} onClick={() => chosen && onLink(chosen)}>{tx(p("Link family", "परिवार जोड़ें"))}</Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SearchBox value={q} onChange={(v) => void search(v)} placeholder={tx(p("Father, child or phone", "पिता, बच्चा या फ़ोन"))} autoFocus />
        {q.trim().length < 2 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Type at least 2 letters", "कम से कम 2 अक्षर लिखें"))}</span> : null}
        {busy ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Searching…", "खोज रहे हैं…"))}</span> : null}
        {hits && !busy ? <span className="sech">{hits.length} {hits.length === 1 ? tx(p("family found", "परिवार मिला")) : tx(p("families found", "परिवार मिले"))}</span> : null}
        {hits && hits.length === 0 && !busy ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("No match — try a phone number", "कुछ नहीं मिला — फ़ोन नंबर से खोजें"))}</span> : null}
        {hits?.map((h) => (
          <RadioCard
            key={h.key}
            checked={sel === h.key}
            onSelect={() => setSel(h.key)}
            title={`${h.father}${h.mother ? ` · ${h.mother}` : ""}`}
            sub={
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {h.kids.map((k) => (
                    <Pill key={k.id} tone="mut">{k.name} · {k.classLabel}</Pill>
                  ))}
                </span>
                <span>{maskPhone(h.phone)}{h.village ? ` · ${h.village}` : ""}</span>
              </span>
            }
          />
        ))}
        {chosen ? (
          <div style={{ padding: 12, borderRadius: 14, background: "var(--oks)", color: "var(--ok)", fontSize: 13 }}>
            <strong style={{ display: "block" }}>{tx(p("What linking does", "जोड़ने से क्या होगा"))}</strong>
            {chosen.kids.length >= 2
              ? tx(p("This will be the third child or later: the fee engine applies the 3rd-child policy to the youngest when you save.", "यह तीसरा बच्चा होगा: सहेजने पर सबसे छोटे पर तीसरे बच्चे की नीति लगेगी।"))
              : tx(p("Parents, phone and address are filled in for you. Receipts stay with each child.", "माता-पिता, फ़ोन और पता भर दिए जाएँगे। रसीदें हर बच्चे के साथ रहती हैं।"))}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
