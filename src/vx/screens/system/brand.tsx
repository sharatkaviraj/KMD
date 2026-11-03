import Image from "next/image";

import { schoolBrand } from "@/platform/config/school-brand";
import type { Language } from "@/platform/i18n/language";
import { lead, p, under } from "@/vx/text";

/*
 * The design's crest and the navy band it sits in (design `Auth`): above the
 * sign-in form on a phone, and above the password and session screens that
 * follow it. The design's crest says "VP"; the school's own logo stands in it
 * (RULES I: keep the name and mark the repo already uses).
 */

export const PLACE = p("Amet, Rajasthan", "आमेट, राजस्थान");

/** `still`: no pop-in — for the logo on a receipt, record or report rather than a greeting. */
export function Crest({ size, radius, shadow, still = false }: { size: number; radius: number; shadow?: boolean; still?: boolean }) {
  return (
    <span
      style={{
        flex: "none",
        width: size,
        height: size,
        borderRadius: radius,
        background: "#F7F6F3",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        boxShadow: shadow ? "0 20px 40px -18px rgba(0,0,0,.6)" : undefined,
        animation: still ? undefined : "xPopIn .5s var(--spring) both",
      }}
    >
      <Image src={schoolBrand.logo} alt="" width={size} height={size} sizes={`${size}px`} style={{ width: "78%", height: "78%", objectFit: "contain" }} />
    </span>
  );
}

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
