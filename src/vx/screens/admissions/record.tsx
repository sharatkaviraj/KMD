"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";

import { editStudentAction, undoWithdrawAction, withdrawAction } from "@/app/(app)/admissions/actions";
import { clock, dateLabel, rupees, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Field, Input, Select } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";

import type { DocKey } from "@/vx/screens/admissions/data";
import {
  changedFields,
  firstName,
  lastDayChoices,
  maskPhone,
  normalizeMobile,
  parseDob,
  WITHDRAW_REASONS,
  withdrawReasonText,
  type WithdrawReason,
} from "@/vx/screens/admissions/logic";
import { ActionBar, Av, PeopleStyles, RadioTile, SwitchRow } from "@/vx/screens/admissions/ui";

export type RecordFields = {
  fullName: string;
  nameHi: string;
  dob: string;
  gender: string;
  fatherName: string;
  motherName: string;
  fatherPhone: string;
  motherPhone: string;
  address: string;
  villageCity: string;
  previousSchool: string;
  classId: string;
  transportRouteId: string;
};

export type RecordProps = {
  studentId: string;
  sessionLabel: string;
  sr: string;
  classLabel: string;
  status: string;
  leftOn: string | null;
  tcNumber: string | null;
  initial: RecordFields;
  docs: Partial<Record<DocKey, boolean>>;
  classes: { id: string; label: string }[];
  routes: { id: string; label: string }[];
  history: { at: string; action: string; changed: string[] }[];
  dues: { pendingToday: number; notDueYet: number; lateFeePending: number };
  today: string;
  schoolName: string;
  mode: "edit" | "withdraw";
  /** When the child was admitted, for the header line. */
  admittedOn?: string | null;
};

const DOC_LABELS: { key: DocKey; label: Pair }[] = [
  { key: "birth", label: p("Birth certificate", "जन्म प्रमाण पत्र") },
  { key: "tc", label: p("TC from the old school", "पुराने विद्यालय की टीसी") },
  { key: "photo", label: p("Passport photo", "पासपोर्ट फ़ोटो") },
  { key: "aadhaar", label: p("Aadhaar card copy", "आधार कार्ड की कॉपी") },
  { key: "address", label: p("Address proof", "पते का प्रमाण") },
];

const REASON_LABELS: Record<WithdrawReason, { label: Pair; sub: Pair }> = {
  town: { label: p("Moving to another town", "दूसरे शहर जा रहे हैं"), sub: p("The family is shifting", "परिवार जा रहा है") },
  school: { label: p("Going to another school", "दूसरे विद्यालय में जा रहे हैं"), sub: p("Nearby or elsewhere", "पास में या कहीं और") },
  fees: { label: p("Parent’s request", "अभिभावक का अनुरोध"), sub: p("Fees are still followed up kindly", "फीस का पीछा नरमी से जारी") },
  other: { label: p("Other reason", "अन्य कारण"), sub: p("Write a short note", "छोटा नोट लिखें") },
};

const FIELD_LABELS: Record<keyof RecordFields, Pair> = {
  fullName: p("Name", "नाम"),
  nameHi: p("Name in Hindi", "हिंदी नाम"),
  dob: p("Date of birth", "जन्म तिथि"),
  gender: p("Gender", "लिंग"),
  fatherName: p("Father", "पिता"),
  motherName: p("Mother", "माता"),
  fatherPhone: p("Phone", "फ़ोन"),
  motherPhone: p("Second phone", "दूसरा फ़ोन"),
  address: p("Address", "पता"),
  villageCity: p("Village", "गाँव"),
  previousSchool: p("Previous school", "पिछला विद्यालय"),
  classId: p("Class", "कक्षा"),
  transportRouteId: p("Bus", "बस"),
};

const NAME_HI = p("Name in Hindi", "नाम हिंदी में");

/** The TC's own lines: always Hindi first with the English under it, whatever the reader's language. */
const TC_LINES = {
  title: p("Transfer certificate", "स्थानांतरण प्रमाण पत्र"),
  name: p("Name", "नाम"),
  father: p("Father", "पिता का नाम"),
  cls: p("Class", "कक्षा"),
  dob: p("Date of birth", "जन्म तिथि"),
  admitted: p("SR number", "प्रवेश क्रमांक"),
  lastDay: p("Last day", "अंतिम दिन"),
  reason: p("Reason", "कारण"),
  teacher: p("Class teacher", "कक्षा अध्यापक"),
  principal: p("Principal", "प्रधानाचार्य"),
};

const card: CSSProperties = { padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 };
const mut12: CSSProperties = { fontSize: 12, color: "var(--mut)" };

/** Admissions states `edit` and `withdraw` for one student. */
export function StudentRecord(props: RecordProps) {
  const [mode, setMode] = useState<"edit" | "withdraw">(props.mode);
  const left = props.status !== "active";
  return (
    <>
      <PeopleStyles />
      {mode === "withdraw" && !left ? <WithdrawPanel {...props} onCancel={() => setMode("edit")} /> : <EditPanel {...props} left={left} onWithdraw={() => setMode("withdraw")} />}
    </>
  );
}

function EditPanel(props: RecordProps & { left: boolean; onWithdraw: () => void }) {
  const { tx, language } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState<RecordFields>(props.initial);
  const [docs, setDocs] = useState(props.docs);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [changeClass, setChangeClass] = useState(false);

  const changed = changedFields(props.initial, f);
  const docsChanged = DOC_LABELS.filter((d) => (props.docs[d.key] === true) !== (docs[d.key] === true)).length;
  const count = changed.length + (docsChanged > 0 ? 1 : 0);
  const set = (k: keyof RecordFields) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const isChanged = (k: keyof RecordFields) => changed.includes(k);

  const localErrors: Record<string, string> = {};
  if (!f.fullName.trim()) localErrors.fullName = tx(p("Write the name.", "नाम लिखें।"));
  if (f.dob.trim() && !parseDob(f.dob)) localErrors.dateOfBirth = tx(p("Write the date like 21-08-2019.", "तारीख़ ऐसे लिखें: 21-08-2019"));
  if (f.fatherPhone.trim() && normalizeMobile(f.fatherPhone).length !== 10) localErrors.fatherPhone = tx(p("A mobile number has 10 digits.", "मोबाइल नंबर 10 अंकों का होता है।"));
  const shown = { ...errors, ...localErrors };

  const clsNow = props.classes.find((c) => c.id === f.classId)?.label ?? props.classLabel;
  const clsWas = props.classes.find((c) => c.id === props.initial.classId)?.label ?? props.classLabel;
  const routeOf = (id: string) => props.routes.find((r) => r.id === id)?.label ?? tx(p("No bus", "बस नहीं"));

  async function save() {
    if (Object.keys(localErrors).length > 0) return;
    setSaving(true);
    const patch: Record<string, unknown> = {};
    for (const k of changed) {
      if (k === "dob") patch.dob = f.dob;
      else if (k === "nameHi") patch.nameHi = f.nameHi;
      else patch[k] = f[k].trim();
    }
    if (docsChanged > 0) patch.docs = docs;
    const res = await editStudentAction(props.studentId, props.sessionLabel, patch as Parameters<typeof editStudentAction>[2]);
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    setErrors({});
    setChangeClass(false);
    toast.show({ text: tx(p(`Saved ${count} change${count === 1 ? "" : "s"} for ${firstName(f.fullName)}`, `${firstName(f.fullName)} के ${count} बदलाव सहेजे`)), tone: "ok" });
    router.refresh();
  }

  const label = (k: keyof RecordFields, text: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {text}
      {isChanged(k) ? <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)", animation: "xPopIn .35s var(--spring) both" }}>{tx(p("Changed", "बदला"))}</span> : null}
    </span>
  );
  // The design labels the Hindi-name field in Hindi for every reader; English readers also get the English under it.
  const nameHiLabel = language === "hi" ? NAME_HI.hi ?? NAME_HI.en : `${NAME_HI.hi} · ${NAME_HI.en}`;

  const headLine = [props.classLabel, `SR ${props.sr}`, props.admittedOn ? `${tx(p("admitted", "प्रवेश"))} ${shortDay(props.admittedOn)}` : null, props.initial.transportRouteId ? routeOf(props.initial.transportRouteId) : tx(p("no bus", "बस नहीं"))].filter(Boolean).join(" · ");

  return (
    <>
      <TopBar
        crumb={`${tx(p("Admissions", "दाख़िले"))} · ${tx(p("Edit student", "विद्यार्थी का विवरण"))}`}
        title={props.initial.fullName}
        mSub={`${props.classLabel} · SR ${props.sr}`}
        mBack="/admissions"
        actions={<Btn variant="ghost" icon="chevLeft" href="/admissions">{tx(p("Back to admissions", "दाख़िलों पर लौटें"))}</Btn>}
      />
      <main>
        <div className="pp-page">
          <div className="pad pp-side" style={{ padding: "22px 28px 24px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px" }}>
                <Av name={props.initial.fullName} size={56} font={20} serif />
                <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                  <span className="serif clip" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>{props.initial.fullName}</span>
                  <span className="num" style={mut12}>{headLine}</span>
                </span>
              </div>

              {props.left ? (
                <Banner
                  tone="warn"
                  action={
                    <Btn
                      variant="sec"
                      icon="undo"
                      onClick={async () => {
                        const res = await undoWithdrawAction(props.studentId);
                        if (res.ok) router.refresh();
                      }}
                    >
                      {tx(p("Undo withdrawal", "वापसी करें"))}
                    </Btn>
                  }
                >
                  {tx(p(`Left on ${dateLabel(props.leftOn)}${props.tcNumber ? ` · ${props.tcNumber}` : ""}`, `${dateLabel(props.leftOn)} को विद्यालय छोड़ा${props.tcNumber ? ` · ${props.tcNumber}` : ""}`))}
                </Banner>
              ) : null}

              <div className="card" style={card}>
                <span className="sech">{tx(p("Student", "विद्यार्थी"))}</span>
                <div className="pp-g2">
                  <Field label={label("fullName", tx(p("Name (English)", "नाम (अंग्रेज़ी)")))} error={shown.fullName}>
                    <Input value={f.fullName} onChange={set("fullName")} invalid={!!shown.fullName} autoComplete="off" />
                  </Field>
                  <Field label={label("nameHi", nameHiLabel)}>
                    <Input value={f.nameHi} onChange={set("nameHi")} lang="hi" autoComplete="off" />
                  </Field>
                  <Field label={label("dob", tx(p("Date of birth (DD-MM-YYYY)", "जन्म तिथि (DD-MM-YYYY)")))} error={shown.dateOfBirth}>
                    <Input value={f.dob} onChange={set("dob")} inputMode="numeric" invalid={!!shown.dateOfBirth} />
                  </Field>
                  <Field label={label("gender", tx(p("Gender", "लिंग")))}>
                    <Select value={f.gender} onChange={set("gender")}>
                      <option value="">—</option>
                      <option value="Male">{tx(p("Boy", "लड़का"))}</option>
                      <option value="Female">{tx(p("Girl", "लड़की"))}</option>
                      <option value="Other">{tx(p("Other", "अन्य"))}</option>
                    </Select>
                  </Field>
                  <Field label={label("previousSchool", tx(p("Previous school", "पिछला विद्यालय")))}>
                    <Input value={f.previousSchool} onChange={set("previousSchool")} />
                  </Field>
                </div>
              </div>

              <div className="card" style={card}>
                <span className="sech">{tx(p("Family", "परिवार"))}</span>
                <div className="pp-g2">
                  <Field label={label("fatherName", tx(p("Father’s name", "पिता का नाम")))} error={shown.fatherName}>
                    <Input value={f.fatherName} onChange={set("fatherName")} />
                  </Field>
                  <Field label={label("motherName", tx(p("Mother’s name", "माता का नाम")))}>
                    <Input value={f.motherName} onChange={set("motherName")} />
                  </Field>
                  <Field label={label("fatherPhone", tx(p("Phone · also WhatsApp", "फ़ोन · WhatsApp भी")))} error={shown.fatherPhone}>
                    <Input value={f.fatherPhone} onChange={set("fatherPhone")} inputMode="tel" invalid={!!shown.fatherPhone} />
                  </Field>
                  <Field label={label("motherPhone", tx(p("Second phone", "दूसरा फ़ोन")))} error={shown.motherPhone}>
                    <Input value={f.motherPhone} onChange={set("motherPhone")} inputMode="tel" />
                  </Field>
                  <Field label={label("villageCity", tx(p("Village or town", "गाँव या शहर")))}>
                    <Input value={f.villageCity} onChange={set("villageCity")} />
                  </Field>
                  <Field label={label("address", tx(p("Address", "पता")))}>
                    <Input value={f.address} onChange={set("address")} />
                  </Field>
                </div>
              </div>

              <div className="card" style={card}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span className="sech">{tx(p("Class & fees", "कक्षा व फीस"))}</span>
                  <Btn variant="ghost" icon="swap" onClick={() => setChangeClass(!changeClass)} style={{ height: 34, fontSize: 13, color: "var(--acc)" }}>
                    {changeClass ? tx(p("Done", "हो गया")) : tx(p("Change class", "कक्षा बदलें"))}
                  </Btn>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span aria-hidden="true" style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Ic n="grad" />
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{clsNow}{isChanged("classId") ? ` (${tx(p("was", "पहले"))} ${clsWas})` : ""}</span>
                    <span style={mut12}>{tx(p("Changing the class changes the fee", "कक्षा बदलने से फीस बदलती है"))}</span>
                  </span>
                </div>
                {changeClass ? (
                  <div className="hs fadein" role="radiogroup" aria-label={tx(p("Class", "कक्षा"))} style={{ display: "flex", gap: 6, paddingBottom: 2 }}>
                    {props.classes.map((c) => (
                      <button key={c.id} type="button" role="radio" aria-checked={f.classId === c.id} className={`tap chip${f.classId === c.id ? " on" : ""}`} onClick={() => setF((x) => ({ ...x, classId: c.id }))}>{c.label}</button>
                    ))}
                  </div>
                ) : null}
                {isChanged("classId") ? (
                  <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
                      <Ic n="alert" />
                      {tx(p(`Fees change if ${firstName(f.fullName)} moves to ${clsNow}`, `${firstName(f.fullName)} के ${clsNow} में जाने पर फीस बदलेगी`))}
                    </span>
                    <span style={{ fontSize: 12, lineHeight: 1.5 }}>{tx(p("Receipts already given stay as they are. The fee engine works out the new installments when you save; money already paid moves forward.", "दी गई रसीदें वैसी ही रहेंगी। सहेजने पर नई किस्तें बनेंगी; जमा पैसा आगे गिना जाएगा।"))}</span>
                  </div>
                ) : (
                  <span className="num" style={mut12}>
                    {tx(p("Pending today", "आज बकाया"))} {rupees(props.dues.pendingToday)} · {tx(p("Not due yet", "अभी देय नहीं"))} {rupees(props.dues.notDueYet)}
                    {props.dues.lateFeePending ? ` · ${tx(p("Late fee", "विलंब शुल्क"))} ${rupees(props.dues.lateFeePending)}` : ""}
                  </span>
                )}
              </div>

              <div className="card" style={card}>
                <span className="sech">{tx(p("Transport", "परिवहन"))}</span>
                <div className="hs" role="radiogroup" aria-label={tx(p("Bus", "बस"))} style={{ display: "flex", gap: 6 }}>
                  <button type="button" role="radio" aria-checked={!f.transportRouteId} className={`tap chip${!f.transportRouteId ? " on" : ""}`} onClick={() => setF((x) => ({ ...x, transportRouteId: "" }))}>{tx(p("No bus", "बस नहीं"))}</button>
                  {props.routes.map((r) => (
                    <button key={r.id} type="button" role="radio" aria-checked={f.transportRouteId === r.id} className={`tap chip${f.transportRouteId === r.id ? " on" : ""}`} onClick={() => setF((x) => ({ ...x, transportRouteId: r.id }))}>{r.label}</button>
                  ))}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: isChanged("transportRouteId") ? "var(--warnfg)" : "var(--mut)" }}>
                  {isChanged("transportRouteId")
                    ? tx(p(`${routeOf(props.initial.transportRouteId)} → ${routeOf(f.transportRouteId)} · the bus fee is worked out again when you save`, `${routeOf(props.initial.transportRouteId)} → ${routeOf(f.transportRouteId)} · सहेजने पर बस फीस फिर से बनेगी`))
                    : f.transportRouteId
                      ? tx(p("Charged with each installment", "हर किस्त के साथ"))
                      : tx(p("No bus fee", "बस फीस नहीं"))}
                </span>
              </div>

              <div className="card" style={{ padding: "10px 18px 6px" }}>
                <span className="sech" style={{ display: "block", paddingTop: 4 }}>{tx(p("Documents received", "मिले हुए दस्तावेज़"))}</span>
                {DOC_LABELS.map((d, i) => (
                  <SwitchRow key={d.key} border={i > 0} label={tx(d.label)} on={docs[d.key] === true} onToggle={() => setDocs((x) => ({ ...x, [d.key]: !(x[d.key] === true) }))} />
                ))}
              </div>
            </div>

            <div className="pp-sticky" style={{ position: "sticky", top: 86, display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="card" style={{ padding: "14px 16px" }}>
                <span className="sech">{tx(p("Change history", "बदलाव का इतिहास"))}</span>
                <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
                  {props.history.length === 0 ? <span style={{ ...mut12, padding: "7px 0" }}>{tx(p("No changes recorded yet.", "अभी कोई बदलाव दर्ज नहीं।"))}</span> : null}
                  {props.history.map((h, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "14px minmax(0,1fr)", gap: 10, padding: "7px 0", animation: `xIn .3s var(--ease) ${Math.min(i, 14) * 30}ms both` }}>
                      <span style={{ width: 10, height: 10, marginTop: 4, borderRadius: 5, background: h.action === "insert" ? "var(--ok)" : "var(--c4)" }} />
                      <span style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: 13 }}>
                          {h.action === "insert"
                            ? tx(p(`Admitted · SR ${props.sr}`, `प्रवेश · SR ${props.sr}`))
                            : h.changed.length > 0
                              ? tx(p(`Changed: ${h.changed.join(", ")}`, `बदला: ${h.changed.join(", ")}`))
                              : tx(p("Record updated", "रिकॉर्ड बदला"))}
                        </span>
                        <span className="num" style={mut12}>{shortDay(h.at)} · {clock(h.at)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {props.left ? null : (
                <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{tx(p("Leaving the school?", "विद्यालय छोड़ रहे हैं?"))}</span>
                  <span style={mut12}>{tx(p("Withdraw and print the TC. Pending fees stay in Dues.", "नाम काटें और टीसी छापें। बकाया फीस बकाया सूची में रहती है।"))}</span>
                  <Btn variant="sec" icon="logout" onClick={props.onWithdraw} style={{ color: "var(--bad)" }}>{tx(p("Withdraw · TC", "नाम काटें · टीसी"))}</Btn>
                </div>
              )}
            </div>
          </div>

          {count > 0 ? (
            <ActionBar
              keepHint
              hint={
                <span style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--fg)" }}>
                  <span style={{ flex: "none", width: 9, height: 9, borderRadius: 5, background: "var(--warn)", animation: "xPulse 1.8s infinite" }} />
                  <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>
                    {count} {count === 1 ? tx(p("change", "बदलाव")) : tx(p("changes", "बदलाव"))} {tx(p("not saved", "सहेजे नहीं"))} · {[...changed.map((k) => tx(FIELD_LABELS[k])), ...(docsChanged ? [tx(p("Documents", "दस्तावेज़"))] : [])].join(", ")}
                  </span>
                </span>
              }
            >
              <Btn variant="ghost" disabled={saving} onClick={() => { setF(props.initial); setDocs(props.docs); setErrors({}); setChangeClass(false); toast.show({ text: tx(p("Changes discarded", "बदलाव हटाए")), tone: "info" }); }}>
                {tx(p("Discard", "हटाएँ"))}
              </Btn>
              <Btn variant="pri" icon="check" disabled={saving || Object.keys(localErrors).length > 0} onClick={save}>
                {saving ? tx(p("Saving…", "सहेज रहे हैं…")) : tx(p("Save changes", "बदलाव सहेजें"))}
              </Btn>
            </ActionBar>
          ) : null}
        </div>
      </main>
    </>
  );
}

function WithdrawPanel(props: RecordProps & { onCancel: () => void }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState<WithdrawReason>("town");
  const [note, setNote] = useState("");
  const choices = lastDayChoices(props.today);
  const [leftOn, setLeftOn] = useState(choices[0].value);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tc, setTc] = useState<string | null>(null);
  const name = firstName(props.initial.fullName);
  const reasonText = withdrawReasonText(reason, note);
  const ready = reason !== "other" || note.trim().length > 0;
  const done = Boolean(tc);
  const tcShown = tc ?? `TC/${props.sessionLabel}/…`;
  const owes = props.dues.pendingToday > 0;

  async function go() {
    setBusy(true);
    const res = await withdrawAction({ studentId: props.studentId, sessionLabel: props.sessionLabel, leftOn, reason: reasonText.en });
    setBusy(false);
    setConfirm(false);
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    setTc(res.tcNumber);
    toast.show({
      text: tx(p(`${props.initial.fullName} withdrawn · ${res.tcNumber} issued`, `${props.initial.fullName} का नाम कटा · ${res.tcNumber}`)),
      tone: "ok",
      undoLabel: tx(p("Undo", "वापस")),
      undo: async () => {
        const back = await undoWithdrawAction(props.studentId);
        if (back.ok) {
          setTc(null);
          router.refresh();
        }
      },
    });
    router.refresh();
  }

  const dayChip = (value: string, i: number) => (i === 0 ? `${tx(p("Today", "आज"))} · ${shortDay(value)}` : shortDay(value));
  const tcRows: { k: Pair; v: string }[] = [
    { k: TC_LINES.name, v: props.initial.fullName },
    { k: TC_LINES.father, v: props.initial.fatherName || "—" },
    { k: TC_LINES.cls, v: props.classLabel },
    { k: TC_LINES.dob, v: props.initial.dob ? dateLabel(parseDob(props.initial.dob)) : "—" },
    { k: TC_LINES.admitted, v: `SR ${props.sr}${props.admittedOn ? ` · ${dateLabel(props.admittedOn)}` : ""}` },
    { k: TC_LINES.lastDay, v: dateLabel(leftOn) },
    { k: TC_LINES.reason, v: reason === "other" && !note.trim() ? "—" : `${reasonText.hi} · ${reasonText.en}` },
  ];
  const impact: { icon: IconName; bg: string; fg: string; text: string }[] = [
    { icon: "users", bg: "var(--s3)", fg: "var(--fg)", text: tx(p(`${name} leaves the roll after ${shortDay(leftOn)}.`, `${name} ${shortDay(leftOn)} के बाद रोल से हटेंगे।`)) },
    owes
      ? { icon: "rupee", bg: "var(--warns)", fg: "var(--warnfg)", text: tx(p(`${rupees(props.dues.pendingToday)} stays in Dues as “Left owing”. Nothing is waived.`, `${rupees(props.dues.pendingToday)} बकाया सूची में “छोड़ा, बकाया” में रहेगा। कुछ माफ़ नहीं।`)) }
      : { icon: "rupee", bg: "var(--oks)", fg: "var(--ok)", text: tx(p("No fees pending today.", "आज कोई फीस बकाया नहीं।")) },
    { icon: "calendar", bg: "var(--s3)", fg: "var(--fg)", text: tx(p(`Installments not due yet (${rupees(props.dues.notDueYet)}) stop with the last day.`, `अभी देय नहीं किस्तें (${rupees(props.dues.notDueYet)}) आख़िरी दिन के साथ रुकेंगी।`)) },
    { icon: "file", bg: "var(--infos)", fg: "var(--info)", text: tx(p("A TC number is given, ready to print. You can undo this.", "टीसी नंबर बनेगा, छापने को तैयार। इसे वापस ले सकते हैं।")) },
  ];

  return (
    <>
      <TopBar
        crumb={`${tx(p("Admissions", "दाख़िले"))} · ${tx(p("Withdraw", "नाम काटें"))}`}
        title={tx(p("Withdraw · Transfer certificate", "नाम काटें · स्थानांतरण प्रमाण पत्र"))}
        mTitle={tx(p("Withdraw · TC", "नाम काटें · टीसी"))}
        mSub={`${props.initial.fullName} · ${props.classLabel}`}
        mBack="/admissions"
        actions={<Btn variant="ghost" icon="chevLeft" onClick={props.onCancel}>{tx(p("Back to student", "विद्यार्थी पर लौटें"))}</Btn>}
      />
      <main>
        <div className="pp-page">
          <div className="pad pp-half" style={{ padding: "22px 28px 24px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
                <Av name={props.initial.fullName} size={46} font={15} />
                <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span className="clip" style={{ fontSize: 16, fontWeight: 700 }}>{props.initial.fullName}</span>
                  <span className="num" style={mut12}>{[props.classLabel, `SR ${props.sr}`, props.initial.fatherName, props.initial.fatherPhone ? maskPhone(props.initial.fatherPhone) : null].filter(Boolean).join(" · ")}</span>
                </span>
              </div>
              {done ? (
                <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 14, background: "var(--oks)", color: "var(--ok)", fontSize: 13, lineHeight: 1.5 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p(`${props.initial.fullName} has left the roll`, `${props.initial.fullName} रोल से हटे`))}</span>
                  <span>{tx(p(`${tc} issued · last day ${shortDay(leftOn)}${owes ? ` · ${rupees(props.dues.pendingToday)} moved to Left owing in Dues` : ""}`, `${tc} जारी · आख़िरी दिन ${shortDay(leftOn)}`))}</span>
                </div>
              ) : (
                <>
                  <div className="card" style={card}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p(`Why is ${name} leaving?`, `${name} क्यों जा रहे हैं?`))}</span>
                    <div className="pp-g2" role="radiogroup" aria-label={tx(p("Reason", "कारण"))} style={{ gap: 8 }}>
                      {WITHDRAW_REASONS.map((r) => (
                        <RadioTile key={r} on={reason === r} onPick={() => setReason(r)} title={tx(REASON_LABELS[r].label)} sub={tx(REASON_LABELS[r].sub)} />
                      ))}
                    </div>
                    {reason === "other" ? (
                      <Field label={tx(p("Write the reason", "कारण लिखें"))}>
                        <Input value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder={tx(p("It is printed on the TC", "यह टीसी पर छपेगा"))} />
                      </Field>
                    ) : null}
                  </div>
                  <div className="card" style={card}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("Last day in school", "विद्यालय में आख़िरी दिन"))}</span>
                    <div className="hs" role="radiogroup" aria-label={tx(p("Last day in school", "विद्यालय में आख़िरी दिन"))} style={{ display: "flex", gap: 6 }}>
                      {choices.map((c, i) => (
                        <button key={c.value} type="button" role="radio" aria-checked={leftOn === c.value} className={`tap chip${leftOn === c.value ? " on" : ""}`} onClick={() => setLeftOn(c.value)}>{dayChip(c.value, i)}</button>
                      ))}
                      <label className={`chip${choices.some((c) => c.value === leftOn) ? "" : " on"}`} style={{ position: "relative" }}>
                        <Ic n="calendar" size={15} />
                        <span className="sr">{tx(p("Or pick a date", "या तारीख़ चुनें"))}</span>
                        <input type="date" value={leftOn} max={props.today} onChange={(e) => e.target.value && setLeftOn(e.target.value)} style={{ border: 0, background: "transparent", color: "inherit", fontSize: 13, fontWeight: 600, width: 118, outline: "none" }} />
                      </label>
                    </div>
                    <span style={mut12}>{tx(p(`Attendance stops after ${shortDay(leftOn)}. Installments not yet due (${rupees(props.dues.notDueYet)}) stop with it.`, `${shortDay(leftOn)} के बाद हाज़िरी बंद। अभी देय नहीं किस्तें (${rupees(props.dues.notDueYet)}) भी रुकेंगी।`))}</span>
                  </div>
                  {owes || props.dues.lateFeePending > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", fontSize: 13, lineHeight: 1.5 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
                        <Ic n="alert" />
                        {rupees(props.dues.pendingToday)} {tx(p("pending today", "आज बकाया"))}
                        {props.dues.lateFeePending ? <span style={{ fontWeight: 600 }}>· {tx(p("late fee", "विलंब शुल्क"))} {rupees(props.dues.lateFeePending)} {tx(p("kept separate", "अलग"))}</span> : null}
                      </span>
                      <span>{tx(p(`${name} moves to “Left owing” in Dues, so follow-up continues. The TC can still be issued — it is never held back for fees.`, `${name} बकाया सूची में “छोड़ा, बकाया” में जाएँगे, फ़ॉलो-अप जारी रहेगा। टीसी फीस के कारण नहीं रोकी जाती।`))}</span>
                      <a href="/dues?tab=left" className="tap" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: "var(--warnfg)", textDecoration: "underline" }}>
                        {tx(p("Open Left owing in Dues", "बकाया में “छोड़ा, बकाया” खोलें"))} <Ic n="arrowRight" size={15} />
                      </a>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--oks)", color: "var(--ok)", fontSize: 13, lineHeight: 1.5 }}>
                      <Ic n="checkCircle" style={{ marginTop: 2 }} />
                      <span>{tx(p("No fees pending today. Installments not yet due stop with the last day.", "आज कोई फीस बकाया नहीं। अभी देय नहीं किस्तें आख़िरी दिन के साथ रुकेंगी।"))}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <span className="sech">{tx(p("TC preview · Hindi first", "टीसी नमूना · पहले हिंदी"))}</span>
              <div className="card" style={{ position: "relative", padding: 20, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 12, borderBottom: "1.5px dashed var(--bds)" }}>
                  <span className="serif" style={{ flex: "none", width: 42, height: 42, borderRadius: 12, background: "#082F49", color: "#F7F6F3", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>VP</span>
                  <span className="serif" style={{ fontSize: 14, fontWeight: 600, minWidth: 0 }}>{props.schoolName}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span className="serif" lang="hi" style={{ fontSize: 19, fontWeight: 700 }}>{TC_LINES.title.hi}</span>
                  <span className="num" style={{ ...mut12, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>{TC_LINES.title.en} · {tcShown}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--bd)" }}>
                  {tcRows.map((r) => (
                    <div key={r.k.en} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--bd)", fontSize: 13 }}>
                      <span style={{ display: "flex", flexDirection: "column" }}>
                        <span lang="hi">{r.k.hi}</span>
                        <span style={{ fontSize: 11, color: "var(--mut)" }}>{r.k.en}</span>
                      </span>
                      <span style={{ fontWeight: 600 }}>{r.v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ ...mut12, display: "flex", justifyContent: "space-between", paddingTop: 18 }}>
                  <span>{TC_LINES.teacher.hi} · {TC_LINES.teacher.en}</span>
                  <span>{TC_LINES.principal.hi} · {TC_LINES.principal.en}</span>
                </div>
                {done ? (
                  <span aria-hidden="true" style={{ position: "absolute", top: "48%", left: "50%", padding: "6px 18px", border: "3px solid var(--bad)", borderRadius: 10, color: "var(--bad)", fontSize: 26, fontWeight: 800, letterSpacing: ".12em", transform: "translate(-50%,-50%) rotate(-12deg)", background: "var(--card)", opacity: 0.92, animation: "xPopIn .5s .2s var(--spring) both" }}>ISSUED</span>
                ) : null}
              </div>
            </div>
          </div>

          <ActionBar hint={done ? tx(p("Withdrawn · undo from the message below while it shows", "नाम कटा · नीचे के संदेश से वापस ले सकते हैं")) : tx(p("Nothing changes until you confirm. You can undo it afterwards.", "पुष्टि तक कुछ नहीं बदलता। बाद में वापस ले सकते हैं।"))}>
            {done ? (
              <>
                <Btn variant="sec" href="/dues?tab=left">{tx(p("Open in Dues", "बकाया में खोलें"))}</Btn>
                <Btn variant="pri" icon="printer" onClick={() => window.print()}>{tx(p("Print TC", "टीसी छापें"))}</Btn>
              </>
            ) : (
              <Btn variant="danger" icon="logout" disabled={!ready || busy} onClick={() => setConfirm(true)} style={{ minWidth: 220 }}>{tx(p("Withdraw and issue TC", "नाम काटें और टीसी दें"))}</Btn>
            )}
          </ActionBar>
        </div>
      </main>

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={tx(p(`Withdraw ${props.initial.fullName}?`, `${props.initial.fullName} का नाम काटें?`))}
        sub={tx(p("This is what will happen", "यह होगा"))}
        footer={
          <>
            <Btn variant="sec" style={{ flex: 1 }} onClick={() => setConfirm(false)}>{tx(p("Keep on the roll", "रोल पर रहने दें"))}</Btn>
            <Btn variant="danger" style={{ flex: 1.4 }} disabled={busy} onClick={go}>{tx(p("Withdraw and issue TC", "नाम काटें और टीसी दें"))}</Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
          {impact.map((r, i) => (
            <div key={r.icon} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 12px", borderRadius: 12, background: "var(--s2)", animation: `xIn .3s var(--ease) ${i * 30}ms both` }}>
              <span style={{ flex: "none", width: 28, height: 28, borderRadius: 9, background: r.bg, color: r.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n={r.icon} size={15} />
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.5, paddingTop: 4 }}>{r.text}</span>
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}
