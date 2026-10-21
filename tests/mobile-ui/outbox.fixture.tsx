import { useEffect, useState } from "react";
import { LanguageProvider } from "@/platform/i18n/use-language";
import type { Language } from "@/platform/i18n/language";
import { Outbox } from "@/vx/screens/messages/outbox";
import type { OutboxData } from "@/vx/screens/messages/outbox-data";
import { ToastProvider } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";
import { qaOutboxState } from "./outbox-actions";
import "../../src/vx/vx.css";
export function OutboxFixture({ language }: { language: Language }) {
  const [snapshot, setSnapshot] = useState(() => ({ ...qaOutboxState }));
  useEffect(() => {
    const update = () => setSnapshot({ ...qaOutboxState });
    const originalOpen = window.open;
    // The actual UI is exercised, but no browser or WhatsApp handoff occurs.
    window.open = () => null;
    window.addEventListener("qa:outbox-change", update);
    return () => { window.open = originalOpen; window.removeEventListener("qa:outbox-change", update); };
  }, []);
  const data: OutboxData = { notices: [], batches: [], more: 0, outOfDate: [], repeats: 0, items: [{ source: "queue", id: "11111111-1111-4111-8111-111111111111", name: "QA Parent with a long name", about: "QA Child", group: "QA messages", groupLabel: { en: "QA messages" }, forDay: null, phone: "98765 **210", preview: "Synthetic QA notice", status: snapshot.status, sentAt: snapshot.status === "sent" ? "2026-10-11T00:00:00Z" : null, canUndo: false, blocked: false, queuedAt: "2026-10-10T10:00:00Z" }] };
  return <LanguageProvider language={language}><ToastProvider>
    <VxPage label="Synthetic manual outbox"><Outbox data={data} tabs={null} /></VxPage>
    <output aria-label="Synthetic send counters" style={{ display: "block", padding: 16 }} data-status={snapshot.status} data-prepared={snapshot.prepared} data-confirmed={snapshot.confirmed}>Synthetic handoff only</output>
    <div id="vx-layer" />
  </ToastProvider></LanguageProvider>;
}
