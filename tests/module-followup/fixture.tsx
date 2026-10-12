import { Component, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { ToastProvider } from "@/vx/ui/overlays";
import { FamilyContactLog } from "@/vx/screens/family-contact/ui";
import { VxBottomBar } from "@/vx/shell/bottom-bar";
import { contactFixtureRecords } from "./contact-actions";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

class ContactBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <p data-testid="contact-boundary">Synthetic page error boundary replaced the contact form.</p> : this.props.children; }
}
function ContactFixture() {
  const [, update] = useState(0);
  useEffect(() => {
    const refreshed = () => update(value => value + 1);
    window.addEventListener("qa:refresh", refreshed);
    return () => window.removeEventListener("qa:refresh", refreshed);
  }, []);
  const contacts = contactFixtureRecords().map((row, index) => ({ id: `OPS-contact-${index + 1}`, outcome: row.outcome as "attempted" | "spoke" | "follow_up_agreed", note: row.note ?? null, agreedOn: row.agreedOn ?? null, at: "2026-10-11T11:00:00Z", by: "OPS Synthetic teacher" })).reverse();
  const query = new URLSearchParams(location.search);
  return (
  <LanguageProvider language="en"><ToastProvider><main className="vx" style={{ padding: 16 }}>
    <h1>OPS Synthetic family-contact test</h1>
    <a href={`/?view=other&run=${new URLSearchParams(location.search).get("run") ?? "initial"}`} style={{ display: "inline-flex", minHeight: 44, alignItems: "center" }}>OPS other fixture view</a>
    <ContactBoundary><FamilyContactLog studentId={query.get("student") ?? "00000000-0000-4000-8000-000000000001"} contacts={contacts} canLog={!query.has("readonly")} today="2026-10-11" recoveryScope={query.has("legacy") ? undefined : { owner: query.get("owner") ?? "00000000-0000-4000-8000-000000000002", sessionLabel: query.get("session") ?? "OPS-FOLLOWUP-2026-27", previewing: query.has("preview") }} /></ContactBoundary>
  </main><VxBottomBar tabs={[{ key: "students", label: { en: "Students" }, icon: "users", href: "/students" }, { key: "notes", label: { en: "Notes" }, icon: "note", href: "/notes" }]} badges={Promise.resolve({})} /></ToastProvider></LanguageProvider>
  );
}
createRoot(document.getElementById("root")!).render(<ContactFixture />);
