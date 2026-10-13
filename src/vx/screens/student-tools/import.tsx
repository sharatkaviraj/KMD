"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type CSSProperties } from "react";

import { approveSafeRowsAction, checkImportAction, commitImportAction, uploadImportAction } from "@/app/(app)/student-tools/actions";
import { agoP } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";
import { Confirm, useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";

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
    /** A few values from the first rows, per column, to recognise it by. */
    samples?: Record<string, string[]>;
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

const pad: CSSProperties = { padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 14 };
const mut12: CSSProperties = { fontSize: 12, color: "var(--mut)" };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, "");

/** Student tools states `import`, `mapping`, `validate`, `imported`. */
export function ImportFlow(props: ImportProps) {
  return (
    <div className="pp-page">
      <PeopleStyles />
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
      <div className="pad" style={{ ...pad, maxWidth: 860, width: "100%", margin: "0 auto" }}>
        <button type="button" className="tap lift" onClick={() => input.current?.click()} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8, padding: "34px 20px", borderRadius: 20, border: `2px dashed ${file ? "var(--acc)" : "var(--bds)"}`, background: file ? "var(--accs)" : "var(--card)", color: "var(--fg)", width: "100%" }}>
          <span aria-hidden="true" style={{ width: 58, height: 58, borderRadius: 18, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic n={file ? "check" : "upload"} size={26} />
          </span>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{file ? file.name : tx(p("Choose the Excel or CSV file", "Excel या CSV फ़ाइल चुनें"))}</span>
          <span style={mut12}>{tx(p(`Excel (.xlsx) or .csv · the first row has the column names · new students into ${sessionLabel}`, `Excel (.xlsx) या .csv · पहली पंक्ति में कॉलम के नाम · ${sessionLabel} में नए विद्यार्थी`))}</span>
        </button>
        <input ref={input} type="file" accept=".csv,.xlsx" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label={tx(p("Import file", "इम्पोर्ट फ़ाइल"))} />
        <Btn variant="ghost" icon="download" href="/fees/imports/template" style={{ alignSelf: "center", color: "var(--acc)" }}>{tx(p("Download the template", "टेम्पलेट डाउनलोड करें"))}</Btn>
        {error ? <Banner tone="bad">{error}</Banner> : null}
        {recent.length > 0 ? (
          <div className="card" style={{ padding: "14px 16px" }}>
            <span className="sech">{tx(p("Earlier uploads", "पिछली फ़ाइलें"))}</span>
            {recent.map((r) => (
              <a key={r.id} href={`/student-tools?view=${r.status === "completed" ? "imported" : r.status === "uploaded" ? "mapping" : "validate"}&batch=${r.id}`} className="tap" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)", marginTop: 8, color: "var(--fg)" }}>
                <Ic n="table" style={{ color: "var(--mut)" }} />
                <span className="clip" style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{r.filename}</span>
                <span style={mut12}>{tx(agoP(r.createdAt))}</span>
                <span className="pill" style={{ background: r.status === "completed" ? "var(--oks)" : "var(--s2)", color: r.status === "completed" ? "var(--ok)" : "var(--mut)" }}>{r.status === "completed" ? `${r.importedRows}/${r.totalRows}` : r.status}</span>
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <ActionBar hint={tx(p("Step 1 of 3 · Nothing is saved until the last step.", "चरण 1/3 · आख़िरी चरण तक कुछ नहीं सहेजा जाता।"))}>
        <Btn variant="pri" disabled={!file || busy} onClick={upload} style={{ minWidth: 190 }}>
          {busy ? tx(p("Uploading…", "अपलोड हो रहा…")) : tx(p("Next: match columns", "आगे: कॉलम मिलाएँ"))}
          <Ic n="arrowRight" />
        </Btn>
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
  const usable = fields.filter((f) => f.key !== "studentId");
  const missing = usable.filter((f) => f.required && !map[f.key]);
  const fieldOf = (header: string) => usable.find((f) => map[f.key] === header) ?? null;
  const matched = batch.headers.filter((h) => fieldOf(h)).length;
  const unmatched = batch.headers.length - matched;

  function choose(header: string, fieldKey: string) {
    setMap((m) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) if (v !== header && k !== fieldKey) next[k] = v;
      if (fieldKey) next[fieldKey] = header;
      return next;
    });
  }

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
      <div className="pad" style={pad}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p(`Matched ${matched} of ${batch.headers.length} columns`, `${batch.headers.length} में से ${matched} कॉलम मिले`))}</span>
            <span style={mut12}>{tx(p("Exact and likely matches were done for you. Pick a place for the rest, or leave them out.", "सही और संभावित मिलान हो गए हैं। बाकी के लिए जगह चुनें, या छोड़ दें।"))}</span>
          </span>
          <span className="pill" style={{ height: 28, padding: "0 12px", fontSize: 12, background: unmatched ? "var(--warns)" : "var(--oks)", color: unmatched ? "var(--warnfg)" : "var(--ok)" }}>
            {unmatched ? tx(p(`${unmatched} to pick`, `${unmatched} चुनने हैं`)) : tx(p("All matched", "सब मिल गए"))}
          </span>
        </div>
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="st-mrow only-d" style={{ minHeight: 40, background: "var(--s2)" }}>
            <span className="sech">{tx(p("Excel column", "Excel कॉलम"))}</span>
            <span className="sech">{tx(p("Sample values", "नमूना"))}</span>
            <span />
            <span className="sech">{tx(p("Goes into", "कहाँ जाएगा"))}</span>
            <span className="sech">{tx(p("Match", "मिलान"))}</span>
          </div>
          {batch.headers.map((h, i) => {
            const f = fieldOf(h);
            const exact = f ? norm(h) === norm(f.label) || norm(h) === norm(f.key) : false;
            const suggested = f ? batch.mapping[f.key] === h : false;
            const conf = !f ? { t: tx(p("Pick", "चुनें")), bg: "var(--warns)", fg: "var(--warnfg)" } : exact ? { t: tx(p("Exact", "सटीक")), bg: "var(--oks)", fg: "var(--ok)" } : suggested ? { t: tx(p("Likely", "संभावित")), bg: "var(--infos)", fg: "var(--info)" } : { t: tx(p("Picked", "चुना")), bg: "var(--accs)", fg: "var(--accfg)" };
            return (
              <div key={h} className="st-mrow" style={{ borderTop: "1px solid var(--bd)", animation: `xIn .3s var(--ease) ${Math.min(i, 14) * 26}ms both` }}>
                <span className="clip" style={{ fontSize: 14, fontWeight: 700 }}>{h}</span>
                <span className="clip" style={mut12}>{(batch.samples?.[h] ?? []).join(", ") || "—"}</span>
                <Ic n="arrowRight" style={{ color: "var(--mut)" }} />
                <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <select
                    aria-label={tx(p(`Where ${h} goes`, `${h} कहाँ जाएगा`))}
                    value={f?.key ?? ""}
                    onChange={(e) => choose(h, e.target.value)}
                    className="tap"
                    style={{ width: "100%", height: 42, padding: "0 34px 0 12px", borderRadius: 12, border: `1px solid ${f ? "var(--bds)" : "var(--warn)"}`, background: "var(--card)", color: f ? "var(--fg)" : "var(--warnfg)", fontSize: 14, fontWeight: 600, appearance: "none" }}
                  >
                    <option value="">{tx(p("Leave out", "छोड़ दें"))}</option>
                    {usable.map((x) => (
                      <option key={x.key} value={x.key}>{x.label}{x.required ? " *" : ""}</option>
                    ))}
                  </select>
                  <Ic n="chevDown" size={15} style={{ position: "absolute", right: 12, pointerEvents: "none", color: "var(--mut)" }} />
                </span>
                <span>
                  <span className="pill" style={{ background: conf.bg, color: conf.fg }}>{conf.t}</span>
                </span>
              </div>
            );
          })}
        </div>
        {error ? <Banner tone="bad">{error}</Banner> : null}
      </div>
      <ActionBar hint={missing.length > 0 ? tx(p(`Step 2 of 3 · Still to match: ${missing.map((f) => f.label).join(", ")}`, `चरण 2/3 · मिलाना बाकी: ${missing.map((f) => f.label).join(", ")}`)) : tx(p("Step 2 of 3 · All needed columns matched", "चरण 2/3 · सब ज़रूरी कॉलम मिल गए"))} hintTone={missing.length > 0 ? "bad" : undefined}>
        <Btn variant="sec" href="/student-tools?view=import">{tx(p("Back", "पीछे"))}</Btn>
        <Btn variant="pri" disabled={busy || missing.length > 0} onClick={check} style={{ minWidth: 190 }}>
          {busy ? tx(p("Checking rows…", "पंक्तियाँ जाँच रहे…")) : tx(p("Check the rows", "पंक्तियाँ जाँचें"))}
          <Ic n="arrowRight" />
        </Btn>
      </ActionBar>
    </>
  );
}

function Validate({ batch }: ImportProps & { batch: NonNullable<ImportProps["batch"]> }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const errors = batch.rows.filter((r) => r.errors.length > 0 || r.status === "invalid" || r.status === "duplicate");
  const warnings = batch.rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0 && r.status !== "invalid" && r.status !== "duplicate");
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

  const total = Math.max(1, batch.totalRows);
  const C = 2 * Math.PI * 42;
  const parts = [
    { key: "ready", n: batch.ready, c: "var(--ok)", label: p("Ready to import", "इम्पोर्ट को तैयार") },
    { key: "warn", n: warnings.length, c: "var(--warn)", label: p("Warnings · can fix later", "चेतावनी · बाद में सुधार") },
    { key: "err", n: errors.length, c: "var(--bad)", label: p("Errors · left out", "ग़लतियाँ · छोड़ी जाएँगी") },
  ];
  let offset = 0;
  const ring = parts.map((g) => {
    const len = (g.n / total) * C;
    const seg = { c: g.c, dash: `${Math.max(0, len - (len > 2 ? 2 : 0))} ${C}`, off: -offset };
    offset += len;
    return seg;
  });
  const tabs = [
    { v: "errors" as const, label: `${tx(p("Errors", "ग़लतियाँ"))} · ${errors.length}` },
    { v: "warnings" as const, label: `${tx(p("Warnings", "चेतावनी"))} · ${warnings.length}` },
    { v: "ready" as const, label: `${tx(p("Ready", "तैयार"))} · ${batch.ready}` },
  ];
  const idx = tabs.findIndex((t) => t.v === tab);
  const list = tab === "errors" ? errors : tab === "warnings" ? warnings : [];

  return (
    <>
      <div className="pad" style={pad}>
        <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, padding: "16px 18px" }}>
          <span style={{ position: "relative", flex: "none", width: 104, height: 104 }}>
            <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="52" cy="52" r="42" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 12 }} />
              {ring.map((g) => (
                <circle key={g.c} cx="52" cy="52" r="42" style={{ fill: "none", stroke: g.c, strokeWidth: 12, strokeDasharray: g.dash, strokeDashoffset: g.off, transition: "stroke-dasharray .5s var(--ease), stroke-dashoffset .5s var(--ease)" }} />
              ))}
            </svg>
            <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{batch.totalRows}</span>
              <span style={mut12}>{tx(p("rows", "पंक्तियाँ"))}</span>
            </span>
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 200 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>
              {errors.length ? tx(p(`${errors.length} rows need you before importing`, `इम्पोर्ट से पहले ${errors.length} पंक्तियाँ देखें`)) : tx(p("Every row can be imported", "हर पंक्ति इम्पोर्ट हो सकती है"))}
            </span>
            {parts.map((g) => (
              <span key={g.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: g.c }} />
                <span style={{ flex: 1 }}>{tx(g.label)}</span>
                <span className="num" style={{ fontWeight: 700 }}>{g.n}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="seg" role="radiogroup" aria-label={tx(p("Show", "दिखाएँ"))} style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))", maxWidth: 480, width: "100%" }}>
          <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 3)", transform: `translateX(${idx * 100}%)` }} />
          {tabs.map((t) => (
            <button key={t.v} type="button" role="radio" aria-checked={tab === t.v} className={`tap${tab === t.v ? " on" : ""}`} onClick={() => setTab(t.v)}>{t.label}</button>
          ))}
        </div>
        {tab === "ready" ? (
          <>
            {batch.pendingSafe > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--accs)", color: "var(--accfg)", fontSize: 13 }}>
                <span style={{ flex: 1 }}>{tx(p(`${batch.pendingSafe} clean rows are waiting for approval.`, `${batch.pendingSafe} सही पंक्तियाँ मंज़ूरी की प्रतीक्षा में।`))}</span>
                <Btn variant="pri" icon="zap" disabled={busy} onClick={approve} style={{ height: 36, fontSize: 13 }}>{tx(p("Approve safe rows", "सही पंक्तियाँ मंज़ूर करें"))}</Btn>
              </div>
            ) : null}
            <div className="card" style={{ padding: "14px 16px", fontSize: 14, color: "var(--mut)" }}>
              {tx(p(`${batch.ready} students will be added. Rows with errors are left out and stay here to fix in the sheet.`, `${batch.ready} विद्यार्थी जुड़ेंगे। ग़लत पंक्तियाँ छोड़ दी जाएँगी।`))}
            </div>
          </>
        ) : list.length === 0 ? (
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", background: "var(--oks)", color: "var(--ok)", fontSize: 14, fontWeight: 600 }}>
            <Ic n="checkCircle" />
            {tx(p("Nothing here", "यहाँ कुछ नहीं"))}
          </div>
        ) : (
          <>
            {tab === "errors" ? <span style={mut12}>{tx(p("Fix these in the sheet and upload it again, or leave them out — rows with errors are not imported.", "इन्हें शीट में सुधारकर फिर अपलोड करें, या छोड़ दें — ग़लत पंक्तियाँ इम्पोर्ट नहीं होतीं।"))}</span> : null}
            {list.slice(0, 100).map((r, i) => (
              <div key={r.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", animation: `xIn .3s var(--ease) ${Math.min(i, 14) * 26}ms both` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="pill num" style={{ background: "var(--s2)", color: "var(--fg)" }}>{tx(p(`Row ${r.rowIndex}`, `पंक्ति ${r.rowIndex}`))}</span>
                  <span className="clip" style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700 }}>{r.name || tx(p("(name is empty)", "(नाम ख़ाली)"))} {r.classLabel ? <span style={{ fontWeight: 400, color: "var(--mut)" }}>· {r.classLabel}</span> : null}</span>
                </div>
                <span style={{ fontSize: 13, color: tab === "errors" ? "var(--bad)" : "var(--warnfg)" }}>{(tab === "errors" ? r.errors : r.warnings).join(" · ") || r.status}</span>
              </div>
            ))}
            {list.length > 100 ? <span style={{ ...mut12, textAlign: "center" }}>{tx(p(`${list.length - 100} more rows like these`, `ऐसी ${list.length - 100} और पंक्तियाँ`))}</span> : null}
          </>
        )}
      </div>
      <ActionBar hint={errors.length ? tx(p(`Rows with errors are left out · ${batch.ready} ready to import`, `ग़लत पंक्तियाँ छूटेंगी · ${batch.ready} तैयार`)) : batch.ready > 0 ? tx(p(`${batch.ready} ready to import`, `${batch.ready} इम्पोर्ट के लिए तैयार`)) : tx(p("Approve rows first", "पहले पंक्तियाँ मंज़ूर करें"))} hintTone={errors.length ? "bad" : undefined}>
        <Btn variant="sec" href={`/student-tools?view=mapping&batch=${batch.id}`}>{tx(p("Back", "पीछे"))}</Btn>
        <Btn variant="pri" icon="upload" disabled={busy || batch.ready === 0} onClick={() => setConfirm(true)} style={{ minWidth: 180 }}>{tx(p(`Import ${batch.ready} rows`, `${batch.ready} पंक्तियाँ इम्पोर्ट करें`))}</Btn>
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
  const left = batch.totalRows - batch.importedRows;
  return (
    <div className="pad" style={{ ...pad, animation: "xIn .4s var(--ease) both" }}>
      <div className="card" style={{ maxWidth: 620, width: "100%", margin: "0 auto", padding: "30px 26px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" style={{ animation: "xPopIn .5s var(--spring) both" }}>
          <circle cx="48" cy="48" r="44" style={{ fill: "var(--oks)" }} />
          <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: "276.5", strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
          <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: "60", strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
        </svg>
        <span className="serif" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.25 }}>{tx(p(`${batch.importedRows} students added`, `${batch.importedRows} विद्यार्थी जुड़े`))}</span>
        <span style={{ fontSize: 14, color: "var(--mut)" }}>{batch.filename}</span>
        {left > 0 ? <span className="pill" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>{tx(p(`${left} rows left out — fix them in the sheet and upload again`, `${left} पंक्तियाँ छूटीं — सुधारकर फिर अपलोड करें`))}</span> : null}
        <div className="pp-g2" style={{ width: "100%", marginTop: 10, gap: 10 }}>
          <Btn variant="pri" icon="users" href="/students" style={{ height: 48 }}>{tx(p("See students", "विद्यार्थी देखें"))}</Btn>
          <Btn variant="sec" icon="upload" href="/student-tools?view=import" style={{ height: 48 }}>{tx(p("Import another file", "दूसरी फ़ाइल"))}</Btn>
        </div>
        <span style={mut12}>{tx(p("An import is not undone in one step; withdraw a wrong student from Admissions.", "इम्पोर्ट एक बार में वापस नहीं होता; ग़लत विद्यार्थी को दाख़िले से हटाएँ।"))}</span>
      </div>
    </div>
  );
}
