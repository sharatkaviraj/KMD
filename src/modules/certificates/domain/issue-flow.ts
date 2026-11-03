import { certificatePreflight, type CertificateCommand, type CertificateFacts, type CertificateIssue, type CertificateResult, type CertificateSnapshot, type CertificateTemplate } from "./certificate";

export type CertificateIssuePorts = {
  replay: (command: CertificateCommand) => Promise<CertificateIssue | null>;
  currentIssue: (command: CertificateCommand) => Promise<CertificateIssue | null>;
  template: (command: CertificateCommand) => Promise<CertificateTemplate>;
  facts: (command: CertificateCommand) => Promise<CertificateFacts>;
  reserve: (command: CertificateCommand, facts: CertificateFacts, template: CertificateTemplate) => Promise<{ issue: CertificateIssue; existing: boolean }>;
  readArtifact: (path: string) => Promise<Uint8Array | null>;
  render: (snapshot: CertificateSnapshot) => Promise<Uint8Array>;
  storeArtifact: (path: string, bytes: Uint8Array) => Promise<void>;
  finish: (issue: CertificateIssue, path: string, bytes: Uint8Array) => Promise<void>;
  failed: (issueId: string) => Promise<void>;
};

export function certificateArtifactPath(issue: Pick<CertificateIssue, "id" | "student_id" | "session_label">): string {
  return `certificates/${issue.session_label}/${issue.student_id}/${issue.id}.pdf`;
}
export function validCertificatePdf(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 20 && bytes.byteLength <= 2 * 1024 * 1024 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
}

/** One command, one reserved identity, one immutable artifact even after a lost response. */
export async function executeCertificateIssue(command: CertificateCommand, ports: CertificateIssuePorts): Promise<CertificateResult> {
  let held: CertificateIssue | null = null;
  try {
    held = await ports.replay(command);
    let existing = Boolean(held);
    if (!held && !command.newIssue && !command.supersedes) {
      held = await ports.currentIssue(command);
      existing = Boolean(held);
    }
    if (!held) {
      const [template, facts] = await Promise.all([ports.template(command), ports.facts(command)]);
      const blockers = certificatePreflight(facts, template, command.extras);
      if (blockers.length) return { ok: false, code: "blocked", blockers };
      const reserved = await ports.reserve(command, facts, template);
      held = reserved.issue;
      existing = reserved.existing;
    }
    if (held.artifact_state === "ready") return { ok: true, issueId: held.id, existing, serial: held.serial };
    if (held.status === "cancelled" || held.status === "superseded") return { ok: false, code: "invalid" };
    const path = certificateArtifactPath(held);
    let bytes = await ports.readArtifact(path);
    if (!bytes) {
      bytes = await ports.render(held.snapshot);
      if (!validCertificatePdf(bytes)) throw new Error("Invalid certificate PDF");
      try { await ports.storeArtifact(path, bytes); }
      catch (error) {
        const recovered = await ports.readArtifact(path);
        if (!recovered) throw error;
        bytes = recovered;
      }
    }
    if (!validCertificatePdf(bytes)) throw new Error("Invalid certificate PDF");
    await ports.finish(held, path, bytes);
    return { ok: true, issueId: held.id, existing, serial: held.serial };
  } catch {
    if (held) await ports.failed(held.id).catch(() => undefined);
    return { ok: false, code: "unavailable" };
  }
}
