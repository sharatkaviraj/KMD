"use client";

import Link from "@/vx/ui/link";
import { useState } from "react";

import type { Language } from "@/platform/i18n/language";
import { Ic, type IconName } from "@/vx/icons";
import { lead, p, type Pair } from "@/vx/text";

/*
 * P11 state `notfound` (design `Auth` · notfound): an old or broken link.
 * A picture, one sentence, a search over the pages this person can open and
 * six of them as cards, and the way home.
 */

export type NotFoundLink = { label: Pair; icon: IconName; href: string };

const T = {
  title: p("This page moved or no longer exists", "यह पेज हट गया या अब नहीं है"),
  body: p("The link may be old. Search for what you need, or pick a page below.", "लिंक पुराना हो सकता है। जो चाहिए उसे खोजें, या नीचे से कोई पेज चुनें।"),
  search: p("Search pages, e.g. dues or reports", "पेज खोजें, जैसे बकाया या रिपोर्ट"),
  searchLabel: p("Search pages", "पेज खोजें"),
  none: (q: string) => p(`No page called “${q}”. Try another word.`, `“${q}” नाम का कोई पेज नहीं। कोई और शब्द आज़माएँ।`),
  home: p("Go to my Home", "मेरे होम पर जाएँ"),
};

export function NotFoundScreen({ language, links, home }: { language: Language; links: NotFoundLink[]; home: string }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? links.filter((l) => `${l.label.en} ${l.label.hi ?? ""}`.toLowerCase().includes(needle)) : links.slice(0, 6);
  return (
    <div className="rise" style={{ maxWidth: 600, width: "100%", margin: "20px auto 0", display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center" }}>
      <svg width="120" height="96" viewBox="0 0 120 96" aria-hidden="true">
        <rect x="16" y="14" width="88" height="68" rx="12" style={{ fill: "var(--card)", stroke: "var(--bds)", strokeWidth: 2 }} />
        <path d="M16 32h88" style={{ stroke: "var(--bds)", strokeWidth: 2 }} />
        <circle cx="28" cy="23" r="3" style={{ fill: "var(--bds)" }} />
        <circle cx="38" cy="23" r="3" style={{ fill: "var(--bds)" }} />
        <path d="M44 66c4-10 28-10 32 0M48 48l6 6m0-6l-6 6M66 48l6 6m0-6l-6 6" style={{ fill: "none", stroke: "var(--acc)", strokeWidth: 3, strokeLinecap: "round", ["--len" as string]: "120", strokeDasharray: 120, animation: "xDraw 1s .2s var(--ease) both" }} />
      </svg>
      <h1 className="serif" style={{ margin: 0, fontSize: 26, fontWeight: 600, lineHeight: 1.25 }}>{lead(T.title, language)}</h1>
      <span style={{ fontSize: 14, color: "var(--mut)" }}>{lead(T.body, language)}</span>
      <label style={{ position: "relative", width: "100%", height: 48, borderRadius: 24, border: "1px solid var(--bds)", background: "var(--card)", display: "flex", alignItems: "center", gap: 10, padding: "0 16px", color: "var(--mut)", boxShadow: "var(--sh)" }}>
        <Ic n="search" size={18} />
        <span className="sr">{lead(T.searchLabel, language)}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={lead(T.search, language)} style={{ flex: 1, minWidth: 0, height: 44, border: 0, outline: "none", background: "transparent", fontSize: 15 }} />
      </label>
      {shown.length ? (
        <div className="g2" style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, textAlign: "left" }}>
          {shown.map((l, i) => (
            <Link key={l.href} href={l.href} className="tap card lift" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", animation: `xIn .32s var(--ease) ${i * 40}ms both` }}>
              <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 11, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n={l.icon} size={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{lead(l.label, language)}</span>
              <Ic n="chevRight" size={18} style={{ color: "var(--sub)" }} />
            </Link>
          ))}
        </div>
      ) : (
        <span className="fadein" style={{ fontSize: 13, color: "var(--mut)" }}>{lead(T.none(q.trim()), language)}</span>
      )}
      <Link href={home} className="tap btn pri" style={{ height: 46 }}>
        <Ic n="home" size={18} />
        {lead(T.home, language)}
      </Link>
    </div>
  );
}
