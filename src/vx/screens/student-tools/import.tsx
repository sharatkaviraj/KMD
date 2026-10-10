"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { approveSafeRowsAction, checkImportAction, commitImportAction, uploadImportAction } from "@/app/(app)/student-tools/actions";
import { ago } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Seg, Select, WizardSteps } from "@/vx/ui/controls";
import { Confirm, useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Btn, Card, CardHead, EmptyState, Pill, Stat, SuccessTick } from "@/vx/ui/primitives";

import { ActionBar, PeopleStyles } from "@/vx/screens/admissions/ui";

export type ImportRowView = { id: string; rowIndex: number; name: string; classLabel: string; status: string; errors: string[]; warnings: string[] };
export type ImportProps = {
  stage: "import" | "mapping" | "validate" | "imported";
  sessionLabel: string;
  recent: { id: string; filename: string; status: string; createdAt: string; importedRows: number; totalRows: number }[];
  batch: {
    id: string;
    filename: string;
    status: string;
    headers: string[];
    mapping: Record<string, string>;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    importedRows: number;
    ready: number;
    pendingSafe: number;
    warningRows: number;
    rows: ImportRowView[];
  } | null;
  fields: { key: string; label: string; required: boolean; description: string }[];
};

const STEPS = [p("Upload", "फ़ाइल"), p("Columns", "कॉलम"), p("Check", "जाँच"), p("Done", "हो गया")];

/** Student tools states `import`, `mapping`, `validate`, `imported`. */
export function ImportFlow(props: ImportProps) {
  const { tx } = useVx();
  const stepIndex = { import: 0, mapping: 1, validate: 2, imported: 3 }[props.stage];
  return (
    <div className="pp-wrap" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeopleStyles />
      <WizardSteps steps={STEPS.map((s) => tx(s))} current={stepIndex} />
      {props.stage === "import" || !props.batch ? (
        <Upload {...props} />
      ) : props.stage === "mapping" ? (
        <Mapping {...props} batch={props.batch} />
      ) : props.stage === "validate" ? (
        <Validate {...props} batch={props.batch} />
      ) : (
        <Imported batch={props.batch} />
      )}
    </div>
  );
}

function Upload({ sessionLabel, recent }: ImportProps) {
  const { tx } = useVx();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("sessionLabel", sessionLabel);
    const res = await uploadImportAction(fd);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.push(`/student-tools?view=${res.autoValidated ? "validate" : "mapping"}&batch=${res.batchId}`);
  }

  return (
    <>
      <Card style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", textAlign: "center", padding: 24, borderStyle: "dashed" }}>
        <Pill tone="acc" icon="upload">{tx(p(`New students into ${sessionLabel}`, `${sessionLabel} में नए विद्यार्थी`))}</Pill>
        <strong style={{ fontSize: 17 }}>{file ? file.name : tx(p("Choose the Excel or CSV file", "Excel या CSV फ़ाइल चुनें"))}</strong>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("One row per student. Name and class are needed; the rest can be filled later.", "हर विद्यार्थी की एक पंक्ति। नाम और कक्षा ज़रूरी हैं।"))}</span>
        <input ref={input} type="file" accept=".csv,.xlsx" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label={tx(p("Import file", "इम्पोर्ट फ़ाइल"))} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Btn variant="sec" icon="file" onClick={() => input.current?.click()}>{file ? tx(p("Choose another", "दूसरी चुनें")) : tx(p("Choose file", "फ़ाइल चुनें"))}</Btn>
          <Btn variant="ghost" icon="download" href="/fees/imports/template">{tx(p("Download the template", "टेम्पलेट डाउनलोड करें"))}</Btn>
        </div>
      </Card>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      {recent.length > 0 ? (
        <Card>
          <CardHead title={tx(p("Earlier uploads", "पिछली फ़ाइलें"))} />
          {recent.map((r) => (
            <a key={r.id} href={`/student-tools?view=${r.status === "completed" ? "imported" : r.status === "uploaded" ? "mapping" : "validate"}&batch=${r.id}`} className="tap" style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)", color: "inherit", textDecoration: "none" }}>
              <span style={{ flex: 1, minWidth: 0 }} className="clip">{r.filename}</span>
              <span style={{ color: "var(--mut)", fontSize: 12 }}>{ago(r.createdAt)}</span>
              <Pill tone={r.status === "completed" ? "ok" : "mut"}>{r.status === "completed" ? `${r.importedRows}/${r.totalRows}` : r.status}</Pill>
            </a>
          ))}
        </Card>
      ) : null}
      <ActionBar hint={file ? tx(p("Rows are checked before anything is saved", "सहेजने से पहले पंक्तियाँ जाँची जाती हैं")) : tx(p("Choose a file first", "पहले फ़ाइल चुनें"))}>
        <Btn variant="ghost" href="/student-tools">{tx(p("Cancel", "रद्द करें"))}</Btn>
        <Btn variant="pri" icon="upload" disabled={!file || busy} onClick={upload}>{busy ? tx(p("Uploading…", "अपलोड हो रहा…")) : tx(p("Upload and check", "अपलोड करें और जाँचें"))}</Btn>
      </ActionBar>
    </>
  );
}

function Mapping({ batch, fields }: ImportProps & { batch: NonNullable<ImportProps["batch"]> }) {
  const { tx } = useVx();
  const router = useRouter();
  const [map, setMap] = useState<Record<string, string>>(batch.mapping);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = fields.filter((f) => f.required && !map[f.key]);
  const shown = fields.filter((f) => f.key !== "studentId");

  async function check() {
    setBusy(true);
    setError(null);
    const res = await checkImportAction(batch.id, map, batch.headers);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.push(`/student-tools?view=validate&batch=${batch.id}`);
  }

  return (
    <>
      <Card>
        <CardHead title={tx(p("Which column is which?", "कौन सा कॉलम क्या है?"))} sub={`${batch.filename} · ${tx(p(`${batch.totalRows} rows`, `${batch.totalRows} पंक्तियाँ`))}`} />
        {shown.map((f) => (
          <div key={f.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <strong>{f.label}{f.required ? " *" : ""}</strong>
              <span style={{ fontSize: 12, color: "var(--mut)" }} className="clip">{f.description}</span>
            </span>
            <Select value={map[f.key] ?? ""} invalid={f.required && !map[f.key]} aria-label={f.label} onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value }))}>
              <option value="">{tx(p("Not in the file", "फ़ाइल में नहीं"))}</option>
              {batch.headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </Select>
          </div>
        ))}
      </Card>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      <ActionBar hint={missing.length > 0 ? tx(p(`Still to match: ${missing.map((f) => f.label).join(", ")}`, `मिलाना बाकी: ${missing.map((f) => f.label).join(", ")}`)) : tx(p("All needed columns matched", "सब ज़रूरी कॉलम मिल गए"))} hintTone={missing.length > 0 ? "bad" : undefined}>
        <Btn variant="ghost" href="/student-tools?view=import">{tx(p("Back", "पीछे"))}</Btn>
        <Btn variant="pri" icon="check" disabled={busy || missing.length > 0} onClick={check}>{busy ? tx(p("Checking rows…", "पंक्तियाँ जाँच रहे…")) : tx(p("Check the rows", "पंक्तियाँ जाँचें"))}</Btn>
      </ActionBar>
    </>
  );
}

function Validate({ batch }: ImportProps & { batch: NonNullable<ImportProps["batch"]> }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const errors = batch.rows.filter((r) => r.errors.length > 0 || r.status === "invalid" || r.status === "duplicate");
  const warnings = batch.rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0);
  const [tab, setTab] = useState<"errors" | "warnings" | "ready">(errors.length > 0 ? "errors" : warnings.length > 0 ? "warnings" : "ready");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function approve() {
    setBusy(true);
    const res = await approveSafeRowsAction(batch.id);
    setBusy(false);
    if (!res.ok) toast.show({ text: res.message, tone: "bad" });
    else router.refresh();
  }

  async function commit() {
    setBusy(true);
    const res = await commitImportAction(batch.id, batch.filename);
    setBusy(false);
    setConfirm(false);
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    if (res.remainingCount > 0) {
      toast.show({ text: tx(p(`Saved ${res.importedCount} so far; ${res.remainingCount} still to go. Press Import again.`, `${res.importedCount} सहेजे; ${res.remainingCount} बाकी। फिर से दबाएँ।`)), tone: "info" });
      router.refresh();
      return;
    }
    router.push(`/student-tools?view=imported&batch=${batch.id}`);
  }

  const list = tab === "errors" ? errors : tab === "warnings" ? warnings : [];
  return (
    <>
      <Card style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12 }}>
        <Stat label={tx(p("Rows", "पंक्तियाँ"))} value={batch.totalRows} />
        <Stat label={tx(p("Ready", "तैयार"))} value={batch.ready} tone="var(--ok)" />
        <Stat label={tx(p("Need fixing", "सुधार चाहिए"))} value={batch.invalidRows + batch.duplicateRows} tone={batch.invalidRows + batch.duplicateRows > 0 ? "var(--bad)" : undefined} />
        <Stat label={tx(p("Warnings", "चेतावनी"))} value={batch.warningRows} />
      </Card>
      <Seg
        label={tx(p("Show", "दिखाएँ"))}
        value={tab}
        onChange={setTab}
        options={[
          { value: "errors", label: `${tx(p("Errors", "ग़लतियाँ"))} ${errors.length}` },
          { value: "warnings", label: `${tx(p("Warnings", "चेतावनी"))} ${warnings.length}` },
          { value: "ready", label: `${tx(p("Ready", "तैयार"))} ${batch.ready}` },
        ]}
      />
      {tab === "ready" ? (
        <Card>
          {batch.pendingSafe > 0 ? (
            <Banner tone="info" action={<Btn variant="sec" icon="ticks" disabled={busy} onClick={approve}>{tx(p("Approve safe rows", "सही पंक्तियाँ मंज़ूर करें"))}</Btn>}>
              {tx(p(`${batch.pendingSafe} clean rows are waiting for approval.`, `${batch.pendingSafe} सही पंक्तियाँ मंज़ूरी की प्रतीक्षा में।`))}
            </Banner>
          ) : null}
          <p style={{ margin: "8px 0 0", color: "var(--mut)" }}>
            {tx(p(`${batch.ready} students will be added. Rows with errors are left out and stay here to fix in the sheet.`, `${batch.ready} विद्यार्थी जुड़ेंगे। ग़लत पंक्तियाँ छोड़ दी जाएँगी।`))}
          </p>
        </Card>
      ) : list.length === 0 ? (
        <Card><EmptyState icon="checkCircle" title={tx(p("Nothing here", "यहाँ कुछ नहीं"))} /></Card>
      ) : (
        <Card>
          {list.slice(0, 100).map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
              <Pill tone={tab === "errors" ? "bad" : "warn"}>{tx(p(`Row ${r.rowIndex}`, `पंक्ति ${r.rowIndex}`))}</Pill>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <strong className="clip">{r.name || "—"} <span style={{ fontWeight: 400, color: "var(--mut)" }}>{r.classLabel}</span></strong>
                <span style={{ fontSize: 13, color: tab === "errors" ? "var(--bad)" : "var(--mut)" }}>{(tab === "errors" ? r.errors : r.warnings).join(" · ") || r.status}</span>
              </span>
            </div>
          ))}
        </Card>
      )}
      <ActionBar hint={batch.ready > 0 ? tx(p(`${batch.ready} ready to import`, `${batch.ready} इम्पोर्ट के लिए तैयार`)) : tx(p("Approve rows first", "पहले पंक्तियाँ मंज़ूर करें"))}>
        <Btn variant="ghost" href={`/student-tools?view=mapping&batch=${batch.id}`}>{tx(p("Columns", "कॉलम"))}</Btn>
        <Btn variant="pri" icon="upload" disabled={busy || batch.ready === 0} onClick={() => setConfirm(true)}>{tx(p(`Import ${batch.ready} students`, `${batch.ready} विद्यार्थी जोड़ें`))}</Btn>
      </ActionBar>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={commit}
        busy={busy}
        icon="upload"
        title={tx(p(`Add ${batch.ready} students?`, `${batch.ready} विद्यार्थी जोड़ें?`))}
        body={tx(p("They join the roll and their fees are prepared. An import cannot be undone in one step — each student would be withdrawn by hand.", "वे रोल में जुड़ेंगे और फीस बनेगी। इसे एक बार में वापस नहीं लिया जा सकता।"))}
        confirmLabel={tx(p("Import", "जोड़ें"))}
      />
    </>
  );
}

function Imported({ batch }: { batch: NonNullable<ImportProps["batch"]> }) {
  const { tx } = useVx();
  return (
    <>
      <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: 24 }}>
        <SuccessTick />
        <h2 className="serif" style={{ margin: 0 }}>{tx(p(`${batch.importedRows} students added`, `${batch.importedRows} विद्यार्थी जुड़े`))}</h2>
        <span style={{ color: "var(--mut)" }}>{batch.filename}</span>
      </Card>
      {batch.totalRows - batch.importedRows > 0 ? (
        <Banner tone="warn">{tx(p(`${batch.totalRows - batch.importedRows} rows were left out. Fix them in the sheet and upload them again.`, `${batch.totalRows - batch.importedRows} पंक्तियाँ छूटीं। सुधारकर फिर अपलोड करें।`))}</Banner>
      ) : null}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn variant="pri" icon="users" href="/students">{tx(p("See students", "विद्यार्थी देखें"))}</Btn>
        <Btn variant="sec" icon="upload" href="/student-tools?view=import">{tx(p("Import another file", "दूसरी फ़ाइल"))}</Btn>
        <Btn variant="ghost" href="/student-tools">{tx(p("Student tools", "स्टूडेंट टूल्स"))}</Btn>
      </div>
    </>
  );
}
