import type { Language } from "@/platform/i18n/language";
import { lead } from "@/vx/text";
import { TopBar, VxPage } from "@/vx/ui/page";

import { BrandBand } from "@/vx/screens/system/brand";
import { SessionPicker, type RoleOption, type SessionOption } from "@/vx/screens/system/session-picker";

/**
 * Preferences → Session, drawn as the design's `Auth` · session: the navy
 * band and a narrow column on a phone, the column under the top bar on a desk.
 */
export function SessionScreen({ language, ...picker }: { language: Language; name: string; sessions: SessionOption[]; viewing: string; roles: RoleOption[] | null; previewing: string | null; home: string }) {
  return (
    <VxPage>
      <div className="only-d">
        <TopBar crumb={lead({ en: "Preferences", hi: "पसंद" }, language)} title={lead({ en: "Session and view", hi: "सत्र और दृश्य" }, language)} mBack="/preferences" />
      </div>
      <BrandBand language={language} />
      <main style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ margin: "0 auto", width: "100%", maxWidth: 440, padding: "28px 20px 32px" }}>
          <SessionPicker {...picker} />
        </div>
      </main>
    </VxPage>
  );
}
