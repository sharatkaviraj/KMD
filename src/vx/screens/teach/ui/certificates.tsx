"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { recordCertificateDownloadAction, withdrawCertificateRequestAction } from "@/app/(app)/teach/certificates/actions";
import { requestStage, type CertificateRequestRow, type RequestKind } from "@/modules/certificates/domain/request-view";
import type { CertificateTemplate } from "@/modules/certificates/domain/certificate";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { dateLabelP } from "@/vx/format";
import { useToast } from "@/vx/ui/overlays";
import { Btn, Pill } from "@/vx/ui/primitives";
import { KIND_LABELS } from "@/vx/screens/school-office/text";
import { R, STAGE, requestError } from "@/vx/screens/school-office/request-text";
import "@/vx/screens/school-office/cert.css";

/*
 * A teacher's certificate requests (D-542): the card on a child's page with
 * "Ask for a certificate", and the card on Today that appears once she has
 * asked for one. Both read after the page has drawn, so they never slow the
 * screen down; the sheet itself loads only when it is opened.
 */

const AskCertificateSheet = dynamic(() => import("./certificate-ask").then((m) => m.AskCertificateSheet), { ssr: false });

export type KindOffer = { kind: RequestKind; language: CertificateTemplate["language"]; purpose: boolean };
type Loaded = { rows: CertificateRequestRow[]; kinds: KindOffer[] };
const KIND_ICONS: Record<RequestKind, IconName> = { study: "book", character: "award", dob: "cake" };

function useRequests(query: string) {
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/teach/certificates?${query}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("unavailable");
      const body = await response.json() as Loaded;
      if (!controller.signal.aborted) { setData({ rows: body.rows ?? [], kinds: body.kinds ?? [] }); setFailed(false); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [query, round]);
  return { data, failed, reload: () => setRound((value) => value + 1) };
}

const pdfHref = (requestId: string, download = false) => `/teach/certificates/${requestId}/pdf${download ? "?download=1" : ""}`;
const fileName = (serial: string) => `${serial.replace(/[^a-z0-9-]/gi, "_") || "certificate"}.pdf`;

async function recordDownload(requestId: string): Promise<boolean> {
  try { return (await recordCertificateDownloadAction({ requestId, commandId: crypto.randomUUID() })).ok; } catch { return false; }
}

function saveFile(requestId: string) {
  const link = document.createElement("a");
  link.href = pdfHref(requestId, true);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Saves the signed copy; the download is written into the certificate's history first. */
async function downloadRequest(requestId: string): Promise<boolean> {
  if (!(await recordDownload(requestId))) return false;
  saveFile(requestId);
  return true;
}

/*
 * A phone opens its share list only close to the tap that asked for it, and
 * fetching the PDF on a slow connection can take longer than that. So the
 * copy is fetched (and the download written into its history) together, kept
 * for this visit, and a second tap shares it at once.
 */
const fetched = new Map<string, File>();

/** The phone's own share list (WhatsApp and the rest), started by the teacher; never sent by the app. */
async function shareRequest(requestId: string, serial: string): Promise<"shared" | "again" | "downloaded" | "failed"> {
  let file = fetched.get(requestId);
  try {
    if (!file) {
      const [response, recorded] = await Promise.all([fetch(pdfHref(requestId), { cache: "no-store" }), recordDownload(requestId)]);
      if (!response.ok || !recorded) return "failed";
      file = new File([await response.blob()], fileName(serial), { type: "application/pdf" });
      if (!navigator.canShare?.({ files: [file] })) { saveFile(requestId); return "downloaded"; }
      fetched.set(requestId, file);
    }
    await navigator.share({ files: [file], title: serial });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "shared";
    if (error instanceof DOMException && error.name === "NotAllowedError" && fetched.has(requestId)) return "again";
    return "failed";
  }
}

function RequestRow({ row, showChild, index, onChanged }: { row: CertificateRequestRow; showChild: boolean; index: number; onChanged: () => void }) {
  const { tx } = useVx();
  const toast = useToast();
  const [busy, setBusy] = useState<"download" | "share" | "withdraw" | null>(null);
  const stage = requestStage(row);
  const look = STAGE[stage];

  async function act(name: "download" | "share" | "withdraw") {
    if (busy) return;
    setBusy(name);
    try {
      if (name === "download") {
        if (await downloadRequest(row.id)) toast.show({ text: tx(R.downloaded), tone: "ok" });
        else toast.show({ text: tx(R.loadFailed), tone: "bad" });
      } else if (name === "share") {
        const result = await shareRequest(row.id, row.serial ?? "");
        if (result === "downloaded") toast.show({ text: tx(R.downloaded), tone: "ok" });
        else if (result === "again") toast.show({ text: tx(R.shareAgain), tone: "info" });
        else if (result === "failed") toast.show({ text: tx(R.loadFailed), tone: "bad" });
      } else {
        const result = await withdrawCertificateRequestAction({ requestId: row.id });
        if (result.ok) { toast.show({ text: tx(R.withdrawn), tone: "info" }); onChanged(); }
        else toast.show({ text: tx(requestError(result.code)), tone: "bad" });
      }
    } finally { setBusy(null); }
  }

  // Only the person who asked receives the signed copy; on a child's page a
  // colleague's request shows who asked, and no buttons that would be refused.
  const askedBy = row.mine ? "" : `${tx(R.askedBy)}: ${row.requestedByName}`;
  const detail = stage === "waiting" ? (row.mine ? `${tx(R.asked)} ${tx(dateLabelP(row.requestedAt))}` : askedBy)
    : stage === "ready" ? [row.serial, row.mine ? tx(R.signedBy) : askedBy].filter(Boolean).join(" · ")
    : stage === "declined" ? [row.declineReason, askedBy].filter(Boolean).join(" · ")
    : [row.serial, askedBy].filter(Boolean).join(" · ");

  return <div className="cert-req" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span className={`cert-req-ic ${look.tone}`} aria-hidden="true"><Ic n={stage === "ready" ? "checkCircle" : KIND_ICONS[row.kind]} size={19} /></span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>{showChild ? row.studentName : tx(KIND_LABELS[row.kind])}</strong>
        {showChild ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(KIND_LABELS[row.kind])} · {row.classLabel}</span> : null}
        {detail ? <span className={stage === "ready" ? "num" : undefined} style={{ fontSize: 12.5, color: stage === "declined" ? "var(--bad)" : "var(--mut)", overflowWrap: "anywhere" }}>{detail}</span> : null}
      </span>
      <Pill tone={look.tone}>{stage === "waiting" ? <span className="cert-wait-dot" aria-hidden="true" /> : null}{tx(look.label)}</Pill>
    </div>
    {stage === "ready" && row.mine ? <div className="cert-req-actions">
      <Btn variant="pri" icon="send" disabled={!!busy} onClick={() => act("share")}>{busy === "share" ? "…" : tx(R.sendParent)}</Btn>
      <Btn icon="download" disabled={!!busy} onClick={() => act("download")}>{busy === "download" ? "…" : tx(R.download)}</Btn>
    </div> : null}
    {stage === "waiting" && row.mine ? <div className="cert-req-actions one">
      <Btn variant="ghost" icon="x" disabled={!!busy} onClick={() => act("withdraw")}>{tx(R.withdraw)}</Btn>
    </div> : null}
  </div>;
}

/** On a child's page: ask, and see what was asked for this child. */
export function StudentCertificateCard({ studentId, studentName, sessionLabel }: { studentId: string; studentName: string; sessionLabel: string }) {
  const { tx, sub } = useVx();
  const { data, failed, reload } = useRequests(new URLSearchParams({ scope: "student", session: sessionLabel, student: studentId }).toString());
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const rows = data?.rows ?? [];
  const hasReady = rows.some((row) => row.mine && requestStage(row) === "ready");
  return <div className="card cert-card" style={{ order: 2, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span className="cert-req-ic ok" style={{ background: "var(--accs)", color: "var(--accfg)" }} aria-hidden="true"><Ic n="award" size={19} /></span>
      <span className="sech" style={{ flex: 1 }}>{tx(R.card)}{sub(R.card) ? ` · ${sub(R.card)}` : ""}</span>
    </div>
    {!rows.length ? <span className="tc-s" style={{ lineHeight: 1.5 }}>{tx(R.cardHint)}</span> : null}
    {failed ? <div role="alert" className="cert-note" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span style={{ flex: 1 }}>{tx(R.loadFailed)}</span><Btn icon="refresh" onClick={reload}>{tx(R.retry)}</Btn></div>
      : data === null ? <span role="status" className="cert-busy-text" style={{ textAlign: "left" }}>{tx(R.loading)}</span>
      : rows.length ? <div className="cert-req-list">{rows.map((row, index) => <RequestRow key={row.id} row={row} showChild={false} index={index} onChanged={reload} />)}</div> : null}
    <Btn variant={hasReady ? "sec" : "pri"} big full icon="award" disabled={data === null && !failed} onClick={() => { setOpened(true); setOpen(true); }}>{tx(rows.length ? R.askAnother : R.ask)}</Btn>
    {opened ? <AskCertificateSheet open={open} onClose={() => setOpen(false)} onSent={reload} studentId={studentId} studentName={studentName} sessionLabel={sessionLabel} kinds={data?.kinds ?? []} /> : null}
  </div>;
}

/** On Today, once a teacher has asked: what is waiting, and what is ready to send. Hidden when there is nothing. */
export function MyCertificateRequests({ sessionLabel }: { sessionLabel: string }) {
  const { tx, sub } = useVx();
  const { data, reload } = useRequests(new URLSearchParams({ scope: "mine", session: sessionLabel }).toString());
  const rows = data?.rows ?? [];
  if (!rows.length) return null;
  const ready = rows.filter((row) => requestStage(row) === "ready").length;
  return <div className="card tc-card cert-card" style={{ order: ready ? 2 : 3 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span className="cert-req-ic ok" style={{ background: ready ? "var(--oks)" : "var(--accs)", color: ready ? "var(--ok)" : "var(--accfg)" }} aria-hidden="true"><Ic n="award" size={19} /></span>
      <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <span className="tc-p" style={{ fontWeight: 700 }}>{tx(R.mine)}</span>
        {sub(R.mine) ? <span className="tc-s">{sub(R.mine)}</span> : null}
      </span>
      {ready ? <Pill tone="ok">{ready} · {tx(STAGE.ready.label)}</Pill> : null}
    </div>
    <div className="cert-req-list">{rows.slice(0, 6).map((row, index) => <RequestRow key={row.id} row={row} showChild index={index} onChanged={reload} />)}</div>
  </div>;
}
