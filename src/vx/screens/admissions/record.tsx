"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { editStudentAction, undoWithdrawAction, withdrawAction } from "@/app/(app)/admissions/actions";
import { ago, dateLabel } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { DateChips, Field, Input, RadioCard, Select, Seg, Textarea } from "@/vx/ui/controls";
import { Confirm, useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Avatar, Btn, Card, CardHead, Money, Pill, SecHead, Stat } from "@/vx/ui/primitives";

import type { DocKey } from "@/vx/screens/admissions/data";
import {
  changedFields,
  firstName,
  lastDayChoices,
  normalizeMobile,
  parseDob,
  WITHDRAW_REASONS,
  withdrawReasonText,
  type WithdrawReason,
} from "@/vx/screens/admissions/logic";
import { ActionBar, PeopleStyles } from "@/vx/screens/admissions/ui";

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
};

const DOC_LABELS: { key: DocKey; label: ReturnType<typeof p> }[] = [
  { key: "birth", label: p("Birth certificate", "जन्म प्रमाण पत्र") },
  { key: "tc", label: p("TC from the old school", "पुराने विद्यालय की टीसी") },
  { key: "photo", label: p("Passport photo", "पासपोर्ट फ़ोटो") },
  { key: "aadhaar", label: p("Aadhaar card copy", "आधार कार्ड की कॉपी") },
  { key: "address", label: p("Address proof", "पते का प्रमाण") },
];

const REASON_LABELS: Record<WithdrawReason, ReturnType<typeof p>> = {
  town: p("Moving to another town", "दूसरे शहर जा रहे हैं"),
  school: p("Joining another school", "दूसरे विद्यालय में जा रहे हैं"),
  fees: p("Parent's request", "अभिभावक का अनुरोध"),
  other: p("Something else", "कुछ और"),
};

/** Admissions states `edit` and `withdraw` for one student. */
export function StudentRecord(props: RecordProps) {
  const { tx } = useVx();
  const router = useRouter();
  const [mode, setMode] = useState<"edit" | "withdraw">(props.mode);
  const left = props.status !== "active";

  return (
    <div className="pp-wrap" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeopleStyles />
      <Card style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Avatar text={props.initial.fullName} seed={props.studentId} size={48} />
        <span style={{ flex: 1, minWidth: 160, display: "flex", flexDirection: "column" }}>
          <strong style={{ fontSize: 17 }}>{props.initial.fullName}</strong>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{props.classLabel} · SR {props.sr}</span>
        </span>
        {left ? <Pill tone="bad" icon="door">{tx(p("Left the school", "विद्यालय छोड़ा"))}</Pill> : <Pill tone="ok">{tx(p("On the roll", "नामांकित"))}</Pill>}
        <Btn variant="ghost" icon="rupee" href={`/payments?studentId=${props.studentId}`}>{tx(p("Fees", "फीस"))}</Btn>
      </Card>

      {left ? (
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
      ) : (
        <Seg
          label={tx(p("What to do", "क्या करना है"))}
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: "edit", label: tx(p("Edit details", "विवरण बदलें")) },
            { value: "withdraw", label: tx(p("Withdraw / TC", "नाम काटें / टीसी")) },
          ]}
        />
      )}

      {mode === "withdraw" && !left ? <WithdrawPanel {...props} onCancel={() => setMode("edit")} /> : <EditPanel {...props} />}
    </div>
  );
}

function EditPanel(props: RecordProps) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState<RecordFields>(props.initial);
  const [docs, setDocs] = useState(props.docs);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const changed = changedFields(props.initial, f);
  const docsChanged = DOC_LABELS.filter((d) => (props.docs[d.key] === true) !== (docs[d.key] === true)).length;
  const count = changed.length + (docsChanged > 0 ? 1 : 0);
  const set = (k: keyof RecordFields) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const localErrors: Record<string, string> = {};
  if (!f.fullName.trim()) localErrors.fullName = tx(p("Write the name.", "नाम लिखें।"));
  if (f.dob.trim() && !parseDob(f.dob)) localErrors.dateOfBirth = tx(p("Write the date like 21-08-2019.", "तारीख़ ऐसे लिखें: 21-08-2019"));
  if (f.fatherPhone.trim() && normalizeMobile(f.fatherPhone).length !== 10) localErrors.fatherPhone = tx(p("A mobile number has 10 digits.", "मोबाइल नंबर 10 अंकों का होता है।"));
  const shown = { ...errors, ...localErrors };

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
    toast.show({ text: tx(p(`Saved ${count} change${count === 1 ? "" : "s"}.`, `${count} बदलाव सहेजे।`)), tone: "ok" });
    router.refresh();
  }

  return (
    <>
      <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CardHead title={tx(p("Student", "विद्यार्थी"))} />
        <div className="pp-two" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          <Field label={tx(p("Full name", "पूरा नाम"))} error={shown.fullName}>
            <Input value={f.fullName} onChange={set("fullName")} invalid={!!shown.fullName} autoComplete="off" />
          </Field>
          <Field label={tx(p("Name in Hindi", "हिंदी में नाम"))}>
            <Input value={f.nameHi} onChange={set("nameHi")} lang="hi" autoComplete="off" />
          </Field>
          <Field label={tx(p("Date of birth", "जन्म तिथि"))} hint="DD-MM-YYYY" error={shown.dateOfBirth}>
            <Input value={f.dob} onChange={set("dob")} inputMode="numeric" invalid={!!shown.dateOfBirth} />
          </Field>
          <Field label={tx(p("Gender", "लिंग"))}>
            <Select value={f.gender} onChange={set("gender")}>
              <option value="">—</option>
              <option value="Male">{tx(p("Boy", "लड़का"))}</option>
              <option value="Female">{tx(p("Girl", "लड़की"))}</option>
              <option value="Other">{tx(p("Other", "अन्य"))}</option>
            </Select>
          </Field>
          <Field label={tx(p("Class", "कक्षा"))} hint={tx(p("Changing the class changes the fee", "कक्षा बदलने से फीस बदलती है"))} error={shown.classId}>
            <Select value={f.classId} onChange={set("classId")}>
              {props.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label={tx(p("Bus", "बस"))}>
            <Select value={f.transportRouteId} onChange={set("transportRouteId")}>
              <option value="">{tx(p("No bus", "बस नहीं"))}</option>
              {props.routes.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label={tx(p("Previous school", "पिछला विद्यालय"))}>
            <Input value={f.previousSchool} onChange={set("previousSchool")} />
          </Field>
        </div>
      </Card>

      <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CardHead title={tx(p("Family", "परिवार"))} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          <Field label={tx(p("Father's name", "पिता का नाम"))} error={shown.fatherName}>
            <Input value={f.fatherName} onChange={set("fatherName")} />
          </Field>
          <Field label={tx(p("Mother's name", "माता का नाम"))}>
            <Input value={f.motherName} onChange={set("motherName")} />
          </Field>
          <Field label={tx(p("Father's phone", "पिता का फ़ोन"))} error={shown.fatherPhone}>
            <Input value={f.fatherPhone} onChange={set("fatherPhone")} inputMode="tel" invalid={!!shown.fatherPhone} />
          </Field>
          <Field label={tx(p("Mother's phone", "माता का फ़ोन"))} error={shown.motherPhone}>
            <Input value={f.motherPhone} onChange={set("motherPhone")} inputMode="tel" />
          </Field>
          <Field label={tx(p("Village / town", "गाँव / शहर"))}>
            <Input value={f.villageCity} onChange={set("villageCity")} />
          </Field>
        </div>
        <Field label={tx(p("Address", "पता"))}>
          <Textarea value={f.address} onChange={set("address")} rows={2} />
        </Field>
      </Card>

      <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <CardHead title={tx(p("Documents received", "मिले हुए काग़ज़"))} />
        {DOC_LABELS.map((d) => (
          <label key={d.key} className="tap" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44 }}>
            <input type="checkbox" checked={docs[d.key] === true} onChange={(e) => setDocs((x) => ({ ...x, [d.key]: e.target.checked }))} style={{ width: 20, height: 20 }} />
            <span>{tx(d.label)}</span>
          </label>
        ))}
      </Card>

      <SecHead>{tx(p("History", "इतिहास"))}</SecHead>
      <Card>
        {props.history.length === 0 ? (
          <span style={{ color: "var(--mut)", fontSize: 13 }}>{tx(p("No changes recorded yet.", "अभी कोई बदलाव दर्ज नहीं।"))}</span>
        ) : (
          props.history.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--bd)" : undefined, fontSize: 13 }}>
              <span style={{ color: "var(--mut)", minWidth: 90 }}>{ago(h.at)}</span>
              <span>
                {h.action === "insert"
                  ? tx(p("Admitted", "दाख़िला हुआ"))
                  : h.changed.length > 0
                    ? tx(p(`Changed: ${h.changed.join(", ")}`, `बदला: ${h.changed.join(", ")}`))
                    : tx(p("Record updated", "रिकॉर्ड बदला"))}
              </span>
            </div>
          ))
        )}
      </Card>

      <ActionBar hint={count > 0 ? tx(p(`${count} change${count === 1 ? "" : "s"} not saved`, `${count} बदलाव सहेजे नहीं गए`)) : tx(p("No changes", "कोई बदलाव नहीं"))}>
        <Btn variant="ghost" disabled={count === 0 || saving} onClick={() => { setF(props.initial); setDocs(props.docs); setErrors({}); }}>
          {tx(p("Discard", "छोड़ें"))}
        </Btn>
        <Btn variant="pri" icon="check" disabled={count === 0 || saving || Object.keys(localErrors).length > 0} onClick={save}>
          {saving ? tx(p("Saving…", "सहेज रहे हैं…")) : tx(p("Save changes", "बदलाव सहेजें"))}
        </Btn>
      </ActionBar>
    </>
  );
}

function WithdrawPanel(props: RecordProps & { onCancel: () => void }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState<WithdrawReason | "">("");
  const [note, setNote] = useState("");
  const choices = lastDayChoices(props.today);
  const [leftOn, setLeftOn] = useState(choices[0].value);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tc, setTc] = useState<string | null>(null);
  const name = firstName(props.initial.fullName);
  const reasonText = reason ? withdrawReasonText(reason, note) : null;
  const ready = reason !== "" && (reason !== "other" || note.trim().length > 0);

  const kindLabel = { today: p("Today", "आज"), yesterday: p("Yesterday", "कल"), monthEnd: p("End of last month", "पिछले महीने का अंत") };

  async function go() {
    if (!reasonText) return;
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
      text: tx(p(`${name} withdrawn · ${res.tcNumber}`, `${name} का नाम काटा · ${res.tcNumber}`)),
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

  return (
    <>
      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <CardHead title={tx(p(`Why is ${name} leaving?`, `${name} क्यों जा रहा/रही है?`))} />
        {WITHDRAW_REASONS.map((r) => (
          <RadioCard key={r} name="reason" checked={reason === r} onSelect={() => setReason(r)} title={tx(REASON_LABELS[r])} />
        ))}
        {reason === "other" ? (
          <Field label={tx(p("Write the reason", "कारण लिखें"))}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </Field>
        ) : null}
      </Card>

      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <CardHead title={tx(p("Last day in school", "विद्यालय में आख़िरी दिन"))} sub={tx(p("Fees stop after this day", "इस दिन के बाद फीस नहीं लगेगी"))} />
        <DateChips days={choices.map((c) => ({ value: c.value, label: tx(kindLabel[c.kind]), sub: dateLabel(c.value) }))} value={leftOn} onChange={setLeftOn} />
        <Field label={tx(p("Or pick a date", "या तारीख़ चुनें"))}>
          <Input type="date" value={leftOn} max={props.today} onChange={(e) => e.target.value && setLeftOn(e.target.value)} />
        </Field>
      </Card>

      {props.dues.pendingToday > 0 || props.dues.lateFeePending > 0 ? (
        <Banner tone="warn" action={<Btn variant="sec" icon="rupee" href={`/payments?studentId=${props.studentId}`}>{tx(p("Collect first", "पहले फीस लें"))}</Btn>}>
          {tx(p("Fees are still pending. The TC can be issued, and the dues stay on the record.", "फीस अभी बाकी है। टीसी दी जा सकती है, बकाया रिकॉर्ड में रहेगा।"))}
        </Banner>
      ) : null}
      <Card style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
        <Stat label={tx(p("Pending today", "आज तक बाकी"))} value={<Money value={props.dues.pendingToday} />} tone={props.dues.pendingToday > 0 ? "var(--bad)" : undefined} />
        <Stat label={tx(p("Not due yet", "अभी देय नहीं"))} value={<Money value={props.dues.notDueYet} />} sub={tx(p("Stops after the last day", "आख़िरी दिन के बाद रुकेगी"))} />
        <Stat label={tx(p("Late fee", "विलंब शुल्क"))} value={<Money value={props.dues.lateFeePending} />} sub={tx(p("Kept separate", "अलग रखा"))} />
      </Card>

      <SecHead>{tx(p("TC preview", "टीसी का नमूना"))}</SecHead>
      <Card style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
        <strong lang="hi" style={{ fontSize: 16, textAlign: "center" }}>स्थानांतरण प्रमाण पत्र</strong>
        <span style={{ textAlign: "center", fontSize: 12, color: "var(--mut)" }}>Transfer Certificate · {props.schoolName}</span>
        <span>{tc ?? `TC/${props.sessionLabel}/…`}</span>
        <span lang="hi">नाम / Name: <strong>{props.initial.fullName}</strong></span>
        <span lang="hi">पिता / Father: {props.initial.fatherName || "—"}</span>
        <span lang="hi">कक्षा / Class: {props.classLabel} · SR {props.sr}</span>
        <span lang="hi">अंतिम दिन / Last day: {dateLabel(leftOn)}</span>
        <span lang="hi">कारण / Reason: {reasonText ? `${reasonText.hi} / ${reasonText.en}` : "—"}</span>
        {tc ? <Btn variant="sec" icon="printer" onClick={() => window.print()}>{tx(p("Print TC", "टीसी छापें"))}</Btn> : null}
      </Card>

      <ActionBar hint={ready ? tx(p("This takes the child off the roll", "इससे बच्चा रोल से हटेगा")) : tx(p("Pick a reason first", "पहले कारण चुनें"))}>
        <Btn variant="ghost" onClick={props.onCancel}>{tx(p("Cancel", "रद्द करें"))}</Btn>
        <Btn variant="danger" icon="door" disabled={!ready || busy} onClick={() => setConfirm(true)}>{tx(p("Withdraw and issue TC", "नाम काटें और टीसी दें"))}</Btn>
      </ActionBar>

      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={go}
        busy={busy}
        danger
        icon="door"
        title={tx(p(`Withdraw ${props.initial.fullName}?`, `${props.initial.fullName} का नाम काटें?`))}
        body={tx(p(`Last day ${dateLabel(leftOn)}. A TC number is given. Payments stay on the record. You can undo this.`, `आख़िरी दिन ${dateLabel(leftOn)}। टीसी नंबर दिया जाएगा। भुगतान रिकॉर्ड में रहेंगे। इसे वापस ले सकते हैं।`))}
        confirmLabel={tx(p("Withdraw", "नाम काटें"))}
      />
    </>
  );
}

