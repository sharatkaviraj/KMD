import { LanguageProvider } from "@/platform/i18n/use-language";
import type { Language } from "@/platform/i18n/language";
import { InboxScreen } from "@/vx/screens/admin/inbox";
import { ToastProvider } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";
import "../../src/vx/vx.css";
export function InboxFixture({ language }: { language: Language }) {
  return <LanguageProvider language={language}><ToastProvider><VxPage label="Synthetic inbox recovery">
    <InboxScreen items={[{ id: "qa-item", submissionIds: ["22222222-2222-4222-8222-222222222222"], type: "students", kind: "submission", at: null, urgent: false,
      badge: { en: "Synthetic submission" }, title: { en: "Synthetic child" }, sub: { en: "Phone number" }, facts: [] }]}
      initial="qa-item" previewing={false} unavailable={false} scope={{ accountId: "qa-account", sessionLabel: "QA-2026", day: "2026-10-11" }} />
    <div id="vx-layer" />
  </VxPage></ToastProvider></LanguageProvider>;
}
