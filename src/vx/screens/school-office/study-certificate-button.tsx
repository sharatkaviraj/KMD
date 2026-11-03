"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { generateStudyCertificateAction } from "@/app/(app)/school-office/actions";
import type { CertificateResult } from "@/modules/certificates/domain/certificate";
import { useVx } from "@/vx/i18n";
import { Btn } from "@/vx/ui/primitives";
import { O, FIELD_LABELS } from "./text";
import { p } from "@/vx/text";

export function StudyCertificateButton({ studentId, sessionLabel, newIssue = false, supersedes, reason, label, editHref, resumeIssue }: { studentId: string; sessionLabel: string; newIssue?: boolean; supersedes?: string; reason?: string; label?: string; editHref?: string; resumeIssue?: string }) {
  const { tx } = useVx();
  const router = useRouter();
  const command = useRef<string | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Extract<CertificateResult, { ok: false }> | null>(null);
  async function generate() {
    if (running.current) return;
    running.current = true; setBusy(true); setFailure(null);
    command.current ??= crypto.randomUUID();
    try {
      const result = await generateStudyCertificateAction({ studentId, sessionLabel, commandId: command.current, newIssue, ...(supersedes ? { supersedes } : {}), ...(reason ? { reason } : {}), ...(resumeIssue ? { resumeIssue } : {}) });
      if (result.ok) router.push(`/school-office/certificates/${result.issueId}`);
      else setFailure(result);
    } catch { setFailure({ ok: false, code: "unavailable" }); }
    finally { running.current = false; setBusy(false); }
  }
  return <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
    <Btn icon="fileText" disabled={busy || (!!supersedes && (!reason || reason.trim().length < 3))} onClick={generate}>{busy ? tx(O.preparing) : failure ? tx(O.retry) : label ?? tx(O.study)}</Btn>
    {failure ? <div role="alert" style={{ padding: 12, background: "var(--warns)", color: "var(--warnfg)", borderRadius: 12, fontSize: 13, maxWidth: 520 }}>
      {failure.code === "blocked" && failure.blockers?.length ? <>
        <strong>{tx(O.details)}</strong>
        <ul style={{ margin: "8px 0", paddingLeft: 18 }}>{failure.blockers.map((b) => <li key={`${b.field}:${b.reason}`}>{tx(b.field === "identity" ? O.identity : b.field === "source" ? O.source : b.field === "template" ? O.templateMissing : FIELD_LABELS[b.field])}</li>)}</ul>
        <Link href={editHref ?? `/students/${studentId}`} style={{ textDecoration: "underline" }}>{tx(editHref ? O.fix : p("Open student record", "विद्यार्थी रिकॉर्ड खोलें"))}</Link>
        {!editHref ? <p style={{ marginBottom: 0 }}>{tx(p("Ask an administrator to correct the original record, then try again.", "प्रशासक से मूल रिकॉर्ड ठीक कराएँ, फिर कोशिश करें।"))}</p> : null}
      </> : tx(O.unavailable)}
    </div> : null}
  </div>;
}
