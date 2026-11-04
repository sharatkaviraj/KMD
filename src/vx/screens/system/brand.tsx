import { schoolBrand } from "@/platform/config/school-brand";
import type { Language } from "@/platform/i18n/language";
import { lead, p, under } from "@/vx/text";

import { Crest } from "./crest";

/*
 * The design's crest and the navy band it sits in (design `Auth`): above the
 * sign-in form on a phone, and above the password and session screens that
 * follow it. The design's crest says "VP"; the school's own logo stands in it
 * (RULES I: keep the name and mark the repo already uses).
 *
 * The crest itself is a Client Component (its fallback listens for the
 * image failing); this file stays server-safe, since sign-in calls
 * `placeLine` while rendering on the server.
 */

export { Crest };

export const PLACE = p("Amet, Rajasthan", "आमेट, राजस्थान");

export function placeLine(language: Language): string {
  const second = under(PLACE, language);
  return `${lead(PLACE, language)}${second ? ` · ${second}` : ""}`;
}

export function BrandBand({ language, className = "only-m" }: { language: Language; className?: string }) {
  return (
    <div className={className} style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "34px 20px 26px", background: "#082F49", color: "#F7F6F3", borderRadius: "0 0 28px 28px", textAlign: "center" }}>
      <Crest size={64} radius={20} />
      <span className="serif" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.2 }}>{schoolBrand.name}</span>
      <span style={{ fontSize: 14, color: "#CFE3EA" }}>{placeLine(language)}</span>
    </div>
  );
}
