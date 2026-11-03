"use client";
import { certificateEventAction } from "@/app/(app)/school-office/actions";

/**
 * Opening, downloading and sharing a stored certificate. Each records an
 * honest request event first (the app cannot know whether paper came out);
 * the bytes are always the stored original.
 */
const pdfHref = (issueId: string, download = false) => `/school-office/certificates/${issueId}/pdf${download ? "?download=1" : ""}`;

async function record(issueId: string, kind: "download_requested" | "print_requested") {
  try { return (await certificateEventAction({ issueId, kind, commandId: crypto.randomUUID() })).ok; } catch { return false; }
}

export async function printCertificate(issueId: string): Promise<boolean> {
  // Opened before the await so a phone's popup blocker sees the tap.
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  const ok = await record(issueId, "print_requested");
  if (!ok) { tab?.close(); return false; }
  if (tab) tab.location.href = pdfHref(issueId);
  else window.location.assign(pdfHref(issueId));
  return true;
}

export async function downloadCertificate(issueId: string): Promise<boolean> {
  if (!(await record(issueId, "download_requested"))) return false;
  const link = document.createElement("a");
  link.href = pdfHref(issueId, true);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}

/** The phone's own share sheet, started by the person, never sent by the app. */
export async function shareCertificate(issueId: string, serial: string): Promise<"shared" | "downloaded" | "failed"> {
  try {
    const response = await fetch(pdfHref(issueId), { cache: "no-store" });
    if (!response.ok) return "failed";
    const file = new File([await response.blob()], `${serial.replace(/[^a-z0-9-]/gi, "_")}.pdf`, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      await record(issueId, "download_requested");
      await navigator.share({ files: [file], title: serial });
      return "shared";
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "shared";
  }
  return (await downloadCertificate(issueId)) ? "downloaded" : "failed";
}

export const bundleHref = (ids: string[]) => `/school-office/certificates/bundle?ids=${ids.join(",")}`;
