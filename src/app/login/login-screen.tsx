import type { ReactNode } from "react";

import { schoolBrand } from "@/platform/config/school-brand";
import type { Language } from "@/platform/i18n/language";
import { lead, p } from "@/vx/text";
import { BrandBand, Crest, placeLine } from "@/vx/screens/system/brand";

/*
 * The sign-in screen's frame (design `Auth`, states signin · error · signing):
 * the navy brand panel beside the form from 900px, a navy band above it on a
 * phone. Presentational only, so the design fixture draws exactly what
 * /login draws; the page decides who may see it.
 */

const T = {
  app: p("School office app", "विद्यालय कार्यालय ऐप"),
  tagline: p("Fees, attendance, marks and messages — in one place.", "फीस, उपस्थिति, अंक और संदेश — एक ही जगह।"),
};

const CSS = `
.vx-login{min-height:100dvh;background:var(--bg);color:var(--fg);font-size:14px;line-height:1.45}
.vx-login .lg-grid{min-height:100dvh;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.vx-login .lg-brand{position:relative;overflow:hidden;background:#082F49;color:#F7F6F3;padding:44px 56px;display:flex;flex-direction:column;justify-content:space-between;min-height:100dvh}
.vx-login .lg-side{display:flex;flex-direction:column;min-height:100dvh;background:var(--bg)}
.vx-login .lg-form{margin:auto;width:100%;max-width:440px;padding:28px 20px 32px;display:flex;flex-direction:column;gap:18px}
.vx-login .lg-form:has(.lg-ways){min-height:580px}
@container vx (max-width:899px){.vx-login .lg-grid{grid-template-columns:minmax(0,1fr)}.vx-login .lg-form:has(.lg-code),.vx-login .lg-form:has(.lg-ways){margin:0 auto auto;padding-top:20px;min-height:0}}
`;
/* With WhatsApp code | Password at the top (D-608) the two forms differ in
 * height, so "Sign in" and the switch would jump on every tap: on a desk the
 * form keeps one height, on a phone both sit at the top of the screen. */

/** The design's jaali pattern and slow rings behind the brand panel. */
function Pattern() {
  return (
    <svg aria-hidden="true" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
      <defs>
        <pattern id="vpjaali" width="44" height="44" patternUnits="userSpaceOnUse">
          <path d="M22 4l18 18-18 18L4 22zM22 15l7 7-7 7-7-7z" style={{ fill: "none", stroke: "#81DAE4", strokeWidth: 1 }} />
        </pattern>
      </defs>
      <g style={{ opacity: 0.14 }}><rect width="600" height="900" style={{ fill: "url(#vpjaali)", animation: "xFade 6s ease-in-out infinite alternate" }} /></g>
      <g style={{ opacity: 0.5 }}><circle cx="90" cy="120" r="150" style={{ fill: "#0E717C", opacity: 0.35, animation: "xFade 8s ease-in-out infinite alternate" }} /></g>
      <g style={{ transformOrigin: "500px 780px", animation: "xLoop 140s linear infinite" }}>
        <circle cx="500" cy="780" r="250" style={{ fill: "none", stroke: "#81DAE4", strokeOpacity: 0.22, strokeWidth: 1.5, strokeDasharray: "3 12" }} />
        <circle cx="500" cy="780" r="190" style={{ fill: "none", stroke: "#81DAE4", strokeOpacity: 0.16, strokeWidth: 10, strokeDasharray: "40 22" }} />
      </g>
      <g style={{ transformOrigin: "500px 780px", animation: "xLoop 90s linear infinite reverse" }}>
        <circle cx="500" cy="780" r="330" style={{ fill: "none", stroke: "#F7F6F3", strokeOpacity: 0.12, strokeWidth: 1, strokeDasharray: "1 14" }} />
      </g>
    </svg>
  );
}

export function LoginScreen({ language, children, badge }: { language: Language; children: ReactNode; badge?: ReactNode }) {
  return (
    <div className="vx vx-login">
      <style>{CSS}</style>
      <div className="lg-grid">
        <div className="only-d lg-brand">
          <Pattern />
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
            <Crest size={44} radius={13} />
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{schoolBrand.appName}</span>
              <span style={{ fontSize: 12, color: "#AFC0CC" }}>{lead(T.app, language)}</span>
            </span>
          </div>
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 14, animation: "xRise .6s var(--ease) both" }}>
            <Crest size={92} radius={28} shadow />
            <span className="serif" style={{ fontSize: 38, fontWeight: 600, lineHeight: 1.12 }}>{schoolBrand.name}</span>
            <span style={{ fontSize: 20, color: "#CFE3EA" }}>{placeLine(language)}</span>
          </div>
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "#AFC0CC" }}>
            <span>{lead(T.tagline, language)}</span>
          </div>
        </div>
        <div className="lg-side">
          <BrandBand language={language} />
          <main className="lg-form">
            {badge}
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
