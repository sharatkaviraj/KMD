import type { Language } from "@/platform/i18n/language";
import { lead } from "@/vx/text";
import { TopBar, VxPage } from "@/vx/ui/page";

import { BrandBand } from "@/vx/screens/system/brand";
import { PasswordForm } from "@/vx/screens/system/password-form";

/**
 * Preferences → Password, drawn as the design's `Auth` · password: the navy
 * band and a narrow form on a phone, the form under the top bar on a desk.
 */
export function PasswordScreen({ language, temporary, phone, initial, back = "/preferences" }: { language: Language; temporary: boolean; phone: string | null; initial?: { current?: string; next?: string; confirm?: string }; /** Where Back and a saved password go: a teacher came from More → My profile. */ back?: string }) {
  return (
    <VxPage>
      <div className="only-d">
        <TopBar crumb={lead({ en: "Preferences", hi: "पसंद" }, language)} title={lead({ en: "Password", hi: "पासवर्ड" }, language)} mBack={back} />
      </div>
      <BrandBand language={language} />
      <main style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ margin: "0 auto", width: "100%", maxWidth: 440, padding: "28px 20px calc(32px + var(--vx-bottom-h, 0px))" }}>
          <PasswordForm temporary={temporary} phone={phone} initial={initial} after={back} />
        </div>
      </main>
    </VxPage>
  );
}
