"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";

import { logoutAction } from "@/app/login/actions";
import { saveLanguageAction } from "@/app/(app)/preferences/actions";
import { archiveSessionAction, backupNowAction, restoreDrillAction, saveAssistSettingsAction, savePrefsAction, saveProfileAction, type SettingsResult } from "@/app/(app)/settings/actions";
import type { AssistPanelData } from "@/modules/assist/data/panel";
import { AssistSettingsPanel } from "@/vx/assist/settings-panel";
import { dateLabel, initials, longDay, schoolToday, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Chip, Input, Seg, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Pill } from "@/vx/ui/primitives";

import type { SettingsData } from "./data";
import { aiConnectionMessages as aiConnection, taskIntegrationMessages as taskIntegration } from "@/messages/setup";
import {
  activityCsv,
  AREA_LABELS,
  changesOn,
  AREA_TONES,
  backupHealth,
  bytesLabel,
  CLASSIC_SCREENS,
  FOOTER_MAX,
  GLOSSARY,
  GLOSSARY_TAGS,
  groupByDay,
  IMAGE_MAX_BYTES,
  matchesGlossary,
  PROFILE_PROBLEMS,
  profileProblems,
  type ActivityArea,
  type SchoolProfile,
  type SettingsState,
} from "./domain/settings";

/*
 * Settings, backups & glossary (design `Settings`). Admin only; every change
 * goes through the server actions in app/(app)/settings, which check
 * `settings:manage` and refuse while previewing. Drawn as the design: a
 * section list in its own sticky column, the section beside it; on a phone
 * the list is the first screen and each section opens on its own.
 */

const go = (s: SettingsState) => (s === "home" ? "/settings" : `/settings?s=${s}`);

/* The unsaved-changes bar spans the section and sits above the phone's bottom bar. */
const SETTINGS_CSS = `
.vx .st-dirty{bottom:0;margin:16px -28px 0}
@container vx (max-width:899px){.vx .st-dirty{bottom:calc(76px + env(safe-area-inset-bottom));margin:16px -16px 0;z-index:45}}
`;

type Tone = "acc" | "info" | "ok" | "warn" | "mut" | "soft";
const TONE: Record<Tone, { bg: string; fg: string }> = {
  acc: { bg: "var(--accs)", fg: "var(--accfg)" },
  info: { bg: "var(--infos)", fg: "var(--info)" },
  ok: { bg: "var(--oks)", fg: "var(--ok)" },
  warn: { bg: "var(--warns)", fg: "var(--warnfg)" },
  mut: { bg: "var(--s3)", fg: "var(--fg)" },
  soft: { bg: "var(--s2)", fg: "var(--accfg)" },
};

/** The design's square icon tile (36px, radius 11). */
function Tile({ icon, tone = "acc", size = 36, radius = 11, iconSize = 18, spin }: { icon: IconName; tone?: Tone; size?: number; radius?: number; iconSize?: number; spin?: boolean }) {
  const t = TONE[tone];
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size, height: size, borderRadius: radius, background: t.bg, color: t.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Ic n={icon} size={iconSize} className={spin ? "spin" : undefined} />
    </span>
  );
}

const card: CSSProperties = { background: "var(--card)", border: "1px solid var(--bd)", borderRadius: 18, boxShadow: "var(--sh)" };
const t15: CSSProperties = { fontSize: 15, fontWeight: 700 };
const m12: CSSProperties = { fontSize: 12, color: "var(--mut)" };
const m13: CSSProperties = { fontSize: 13, color: "var(--mut)" };
const sech = (children: ReactNode, action?: ReactNode, style?: CSSProperties) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, ...style }}>
    <span className="sech">{children}</span>
    {action}
  </div>
);

const T = {
  crumb: p("System · Settings", "सिस्टम · सेटिंग्स"),
  settings: p("Settings", "सेटिंग्स"),
  school: p("School", "विद्यालय"),
  records: p("Records", "रिकॉर्ड"),
  connected: p("Connected", "जुड़ी सेवाएँ"),
  help: p("Help", "मदद"),
  classic: p("Classic screens", "पुरानी स्क्रीन"),
  schoolProfile: p("School profile", "विद्यालय प्रोफ़ाइल"),
  schoolSub: p("Name, logo, signature, receipt footer", "नाम, लोगो, हस्ताक्षर, रसीद का नीचे का लेख"),
  prefs: p("Preferences", "पसंद"),
  session: p("Session & year", "सत्र और वर्ष"),
  users: p("Users & roles", "उपयोगकर्ता और भूमिकाएँ"),
  activity: p("Activity log", "गतिविधि लॉग"),
  backups: p("Backups & archive", "बैकअप और संग्रह"),
  master: p("Master data", "मूल डेटा"),
  integrations: p("Integrations", "जुड़ी सेवाएँ"),
  ai: p("AI helper", "AI सहायक"),
  aiSub: p("Claude drafts, staff decide · switch, budget, usage", "Claude लिखता है, स्टाफ़ तय करता है · स्विच, बजट, उपयोग"),
  glossary: p("Glossary", "शब्दकोश"),
  glossarySub: p("Plain meanings · English + हिंदी", "आसान अर्थ · English + हिंदी"),
  about: p("About", "ऐप के बारे में"),
  aboutSub: p("VPPS One · tap to check for updates", "VPPS One · अपडेट देखने के लिए दबाएँ"),
  checking: p("Checking for updates…", "अपडेट देख रहे हैं…"),
  checked: p("Checked for updates. A new version, when there is one, shows at the bottom of the screen.", "अपडेट देख लिया। नया संस्करण होने पर वह स्क्रीन के नीचे दिखेगा।"),
  signOut: p("Sign out", "साइन आउट"),
};

type NavItem = { s: SettingsState | "about" | "users" | "ai-connection"; icon: IconName; tone: Tone; title: Pair; sub: string; subTone?: string; href?: string };

export function SettingsScreen({ data, state, ai = null }: { data: SettingsData; state: SettingsState; ai?: AssistPanelData | null }) {
  const { tx, language } = useVx();
  const router = useRouter();
  const toast = useToast();
  const { theme } = useTheme();
  const [pending, start] = useTransition();
  const [largeText, setLargeText] = useState(data.prefs.largeText);
  const [checking, setChecking] = useState(false);

  const done = (result: SettingsResult) => {
    toast.show({ text: tx(result.message), tone: result.ok ? "ok" : "bad" });
    if (result.ok) router.refresh();
  };

  const today = schoolToday();
  const todayChanges = changesOn(data.activity, today);
  const lastBackup = data.backups[0];
  const health = backupHealth(data.backups, today);
  const themeWord = theme === "light" ? tx(p("Light", "हल्की")) : theme === "dark" ? tx(p("Dark", "गहरी")) : tx(p("Auto", "अपने-आप"));
  const langWord = language === "hi" ? "हिंदी" : language === "both" ? "English + हिंदी" : "English";
  const allOn = data.integrations.every((i) => i.status === "on");
  const houses = data.master.houses.length;

  const status: Record<string, { sub: string; tone?: string }> = {
    prefs: { sub: `${themeWord} ${tx(p("theme", "थीम"))} · ${langWord}${largeText ? ` · ${tx(p("large text", "बड़े अक्षर"))}` : ""}` },
    session: { sub: data.sessionLabel ? `${yearLabel(data.sessionLabel)} · ${tx(p("running now", "चालू"))}` : tx(p("No session", "कोई सत्र नहीं")) },
    activity: { sub: tx(p(`${todayChanges} ${todayChanges === 1 ? "change" : "changes"} today`, `आज ${todayChanges} बदलाव`)) },
    backups: lastBackup
      ? { sub: lastBackup.day === today ? tx(p("Last backup today ✓", "आखिरी बैकअप आज ✓")) : tx(p(`Last backup ${dateLabel(lastBackup.day)}`, `आखिरी बैकअप ${dateLabel(lastBackup.day)}`)), tone: health === "ok" ? "var(--ok)" : "var(--warnfg)" }
      : { sub: tx(p("No nightly copy yet", "अभी कोई रात की प्रति नहीं")), tone: "var(--warnfg)" },
    master: { sub: `${data.master.classes.length} ${tx(p("classes", "कक्षाएँ"))} · ${data.master.subjects.length} ${tx(p("subjects", "विषय"))}${houses ? ` · ${houses} ${tx(p("houses", "हाउस"))}` : ""}` },
    integrations: { sub: `${data.integrations.map((i) => i.name.split(" ")[0]).join(" · ")}${allOn ? ` — ${tx(p("all working", "सब चालू"))}` : ""}`, tone: allOn ? "var(--ok)" : undefined },
  };

  const groups: { title: Pair; items: NavItem[] }[] = [
    {
      title: T.school,
      items: [
        { s: "school", icon: "building", tone: "acc", title: T.schoolProfile, sub: tx(T.schoolSub) },
        { s: "school", icon: "fileText", tone: "info", title: p("Certificate settings", "प्रमाण पत्र की सेटिंग्स"), sub: tx(p("Wording, numbering and manual signature", "पाठ, संख्या और हस्ताक्षर")), href: "/school-office/template" },
        { s: "prefs", icon: "sliders", tone: "info", title: T.prefs, sub: status.prefs.sub },
        { s: "session", icon: "calendar", tone: "warn", title: T.session, sub: status.session.sub },
        { s: "users", icon: "shield", tone: "ok", title: T.users, sub: tx(data.staffTotal && data.staffTotal > data.staffCount ? p(`${data.staffCount} active of ${data.staffTotal} · ${data.roleCount} roles`, `${data.staffTotal} में से ${data.staffCount} सक्रिय · ${data.roleCount} भूमिकाएँ`) : p(`${data.staffCount} people · ${data.roleCount} roles`, `${data.staffCount} लोग · ${data.roleCount} भूमिकाएँ`)), href: "/staff?view=roles" },
      ],
    },
    {
      title: T.records,
      items: [
        { s: "activity", icon: "activity", tone: "acc", title: T.activity, sub: status.activity.sub },
        { s: "backups", icon: "cloud", tone: "ok", title: T.backups, sub: status.backups.sub, subTone: status.backups.tone },
        { s: "master", icon: "layers", tone: "info", title: T.master, sub: status.master.sub },
      ],
    },
    {
      title: T.connected,
      items: [
        { s: "integrations", icon: "link", tone: "warn", title: T.integrations, sub: status.integrations.sub, subTone: status.integrations.tone },
        { s: "ai", icon: "sparkle", tone: "acc", title: T.ai, sub: tx(T.aiSub) },
        // The AI connection (Claude / ChatGPT through MCP) has its own page: the switch and every connection.
        { s: "ai-connection", icon: "shield", tone: "info", title: aiConnection.title, sub: tx(aiConnection.settingsSub), href: "/settings/ai-connection" },
      ],
    },
    {
      title: T.help,
      items: [
        { s: "glossary", icon: "book", tone: "mut", title: T.glossary, sub: tx(T.glossarySub) },
        { s: "about", icon: "info", tone: "mut", title: T.about, sub: tx(checking ? T.checking : T.aboutSub) },
      ],
    },
  ];

  const titles: Record<SettingsState, Pair> = {
    home: T.settings,
    school: T.schoolProfile,
    prefs: T.prefs,
    session: T.session,
    activity: T.activity,
    backups: T.backups,
    restore: T.backups,
    archive: T.backups,
    master: T.master,
    integrations: T.integrations,
    ai: T.ai,
    glossary: T.glossary,
  };
  const active: SettingsState = state === "home" ? "school" : state;
  const isOn = (s: NavItem["s"]) => s === active || (s === "backups" && (active === "restore" || active === "archive"));

  const checkUpdates = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      await registration?.update();
    } catch {
      // A failed check changes nothing; the toast still says what happens next.
    }
    window.setTimeout(() => {
      setChecking(false);
      toast.show({ text: tx(T.checked), tone: "info" });
    }, 600);
  };

  const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "8px 10px", borderRadius: 13, width: "100%", border: 0, color: "var(--fg)", textAlign: "left", textDecoration: "none" };
  const nav = (
    <div className="pad" style={{ padding: "18px 14px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
      {groups.map((g, gi) => (
        <div key={g.title.en} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="sech" style={{ padding: "0 8px" }}>{tx(g.title)}</span>
          <div className="card" style={{ padding: 4, overflow: "hidden" }}>
            {g.items.map((item, i) => {
              const inner = (
                <>
                  <Tile icon={item.icon} tone={item.tone} spin={item.s === "about" && checking} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(item.title)}</span>
                    <span className="clip" style={{ fontSize: 12, color: item.subTone ?? "var(--mut)" }}>{item.sub}</span>
                  </span>
                  <Ic n={item.href ? "arrowRight" : item.s === "about" ? "refresh" : "chevRight"} size={18} style={{ color: "var(--sub)" }} />
                </>
              );
              const st: CSSProperties = { ...rowStyle, animation: `xIn .32s var(--ease) ${Math.min(gi * 3 + i, 14) * 28}ms both` };
              if (item.href) return <Link key={item.s} href={item.href} className="tap row" style={st}>{inner}</Link>;
              if (item.s === "about") return <button key={item.s} type="button" className="tap row" style={{ ...st, background: "transparent" }} onClick={() => void checkUpdates()}>{inner}</button>;
              const on = isOn(item.s);
              return (
                <Link key={item.s} href={go(item.s as SettingsState)} className={`tap row${on ? " sel" : ""}`} aria-current={on ? "page" : undefined} style={st}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      <form action={logoutAction}>
        <button type="submit" className="tap btn sec" style={{ height: 46, width: "100%", color: "var(--bad)" }}>
          <Ic n="logout" size={18} />
          {tx(T.signOut)}
        </button>
      </form>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="sech" style={{ padding: "0 8px" }}>{tx(T.classic)}</span>
        <div className="card" style={{ padding: 4, overflow: "hidden" }}>
          {CLASSIC_SCREENS.map((c) => (
            <Link key={c.href} href={c.href} className="tap row" style={{ ...rowStyle, minHeight: 48 }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{tx(c.label)}</span>
                <span className="clip" style={m12}>{c.sub}</span>
              </span>
              <Ic n="arrowRight" size={16} style={{ color: "var(--sub)" }} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );

  let content: ReactNode = null;
  switch (active) {
    case "school":
      content = <SchoolProfileForm key={data.profileChangedAt ?? "new"} initial={data.profile} changedAt={data.profileChangedAt} changedBy={data.profileChangedBy} pending={pending} onSave={(profile) => start(async () => done(await saveProfileAction(profile)))} />;
      break;
    case "prefs":
      content = (
        <Prefs
          largeText={largeText}
          alerts={data.prefs.alerts}
          pending={pending}
          onSave={(next) => {
            setLargeText(next.largeText);
            start(async () => done(await savePrefsAction(next)));
          }}
          onLanguage={(lang) =>
            start(async () => {
              const fd = new FormData();
              fd.set("language", lang);
              await saveLanguageAction({ status: "idle", message: null }, fd);
              router.refresh();
            })
          }
        />
      );
      break;
    case "session":
      content = <SessionPanel data={data} onArchive={() => router.replace(go("archive"), { scroll: false })} />;
      break;
    case "activity":
      content = <Activity events={data.activity} />;
      break;
    case "backups":
    case "restore":
    case "archive":
      content = (
        <Backups
          data={data}
          sheet={active === "backups" ? null : active}
          pending={pending}
          onClose={() => router.replace(go("backups"), { scroll: false })}
          onOpen={(s) => router.replace(go(s), { scroll: false })}
          onBackup={() => start(async () => done(await backupNowAction()))}
          onDrill={(id) => start(async () => done(await restoreDrillAction(id)))}
          onArchive={(label, sessionLabel) => start(async () => done(await archiveSessionAction({ label, sessionLabel })))}
        />
      );
      break;
    case "master":
      content = <Master master={data.master} />;
      break;
    case "integrations":
      content = <Integrations data={data} />;
      break;
    case "glossary":
      content = <Glossary />;
      break;
    case "ai":
      content = ai ? <AssistSettingsPanel key={ai.settings?.updatedAt ?? "new"} data={ai} pending={pending} onSave={(next) => start(async () => done(await saveAssistSettingsAction(next)))} /> : null;
      break;
  }

  const homeSub = `${data.me.name} · ${tx(data.me.role)}`;
  const mSub = state === "home" ? homeSub : state === "school" ? tx(T.schoolSub) : state === "glossary" ? tx(T.glossarySub) : state === "ai" ? tx(T.aiSub) : (status[active === "restore" || active === "archive" ? "backups" : active]?.sub ?? undefined);

  return (
    <VxPage style={largeText ? { fontSize: 16 } : undefined}>
      <TopBar crumb={tx(T.crumb)} title={tx(titles[active])} mTitle={tx(titles[state])} mBack={state === "home" ? "/menu" : "/settings"} mSub={mSub} />
      <style>{SETTINGS_CSS}</style>
      <div className="vx-pmain">
        <div className="stack" style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr)", alignItems: "start", minHeight: "calc(100dvh - 64px)" }}>
          <nav aria-label={tx(T.settings)} className={`unstick${state === "home" ? "" : " hide-m"}`} style={{ position: "sticky", top: 64, maxHeight: "calc(100dvh - 64px)", overflowY: "auto", borderTop: 0, scrollbarWidth: "thin" }}>
            {nav}
          </nav>
          <section className={`unstick${state === "home" ? " hide-m" : ""}`} style={{ position: "relative", minWidth: 0, minHeight: "calc(100dvh - 64px)", borderLeft: "1px solid var(--bd)", borderTop: 0 }}>
            <div className="pad" style={{ padding: "22px 28px 40px" }}>{content}</div>
          </section>
        </div>
      </div>
    </VxPage>
  );
}

/* ----------------------------------------------------------------- profile */

function readImage(file: File, onLoad: (dataUrl: string | null) => void) {
  if (file.size > IMAGE_MAX_BYTES || !/^image\/(png|jpeg|webp)$/.test(file.type)) return onLoad(null);
  const reader = new FileReader();
  reader.onload = () => onLoad(typeof reader.result === "string" ? reader.result : null);
  reader.readAsDataURL(file);
}

const SIGNATURE_PATH = "M3 22c6-12 9-16 11-12s-4 14 1 12 7-15 10-12-2 11 2 10 6-9 9-8 1 6 4 6 6-4 12-5";

function SchoolProfileForm({ initial, changedAt, changedBy, pending, onSave }: { initial: SchoolProfile; changedAt: string | null; changedBy: string | null; pending: boolean; onSave: (p: SchoolProfile) => void }) {
  const { tx } = useVx();
  const toast = useToast();
  const [f, setF] = useState<SchoolProfile>(initial);
  const set = <K extends keyof SchoolProfile>(k: K, v: SchoolProfile[K]) => setF((x) => ({ ...x, [k]: v }));
  const problems = profileProblems(f);
  const changed = (Object.keys(f) as (keyof SchoolProfile)[]).filter((k) => f[k] !== initial[k]).length;
  const image = (k: "logo" | "signature") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImage(file, (url) => {
      if (!url) toast.show({ text: tx(p(`Use a PNG or JPG under ${Math.round(IMAGE_MAX_BYTES / 1024)} KB.`, `${Math.round(IMAGE_MAX_BYTES / 1024)} KB से छोटी PNG या JPG लगाएँ।`)), tone: "bad" });
      else set(k, url);
    });
  };
  const last = changedAt ? tx(p(`Last changed ${shortDay(changedAt)}${changedBy ? ` · ${changedBy}` : ""}`, `आखिरी बदलाव ${shortDay(changedAt)}${changedBy ? ` · ${changedBy}` : ""}`)) : tx(p("Not saved yet", "अभी सहेजा नहीं"));
  const box: CSSProperties = { ...card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 };
  const footerTone = f.footer.length > FOOTER_MAX ? "var(--bad)" : "var(--mut)";
  const sample: [string, string, number][] = [
    [tx(p("Academic fee · Installment 2", "शैक्षणिक फीस · किस्त 2")), "₹6,450", 400],
    [tx(p("Transport · October", "परिवहन · अक्टूबर")), "₹800", 400],
    [tx(p("Total received", "कुल प्राप्त")), "₹7,250", 700],
  ];

  return (
    <>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div style={box}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <span style={t15}>{tx(p("Name and address", "नाम और पता"))}</span>
              <Link href="/settings?s=activity" className="tap btn ghost" style={{ height: 30, padding: "0 8px", fontSize: 12, color: "var(--mut)" }}>
                <Ic n="clock" size={14} />
                {last}
              </Link>
            </div>
            <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
              <label className="field"><span>{tx(p("School name · English", "विद्यालय का नाम · English"))}</span><Input value={f.nameEn} onChange={(e) => set("nameEn", e.target.value)} /></label>
              <label className="field"><span>{tx(p("School name · हिंदी", "विद्यालय का नाम · हिंदी"))}</span><Input lang="hi" value={f.nameHi} onChange={(e) => set("nameHi", e.target.value)} /></label>
            </div>
            <label className="field"><span>{tx(p("Address", "पता"))}</span><Textarea value={f.address} onChange={(e) => set("address", e.target.value)} style={{ minHeight: 70 }} /></label>
            <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
              <label className="field"><span>{tx(p("Affiliation number", "संबद्धता संख्या"))}</span><Input className="num" value={f.affiliation} onChange={(e) => set("affiliation", e.target.value)} /></label>
              <label className="field"><span>{tx(p("Office phone", "कार्यालय फ़ोन"))}</span><Input className="num" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></label>
            </div>
          </div>

          <div style={{ ...box, gap: 12 }}>
            <span style={t15}>{tx(p("Logo and signature", "लोगो और हस्ताक्षर"))}</span>
            <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
              {(["logo", "signature"] as const).map((k) => {
                const title = k === "logo" ? tx(p("School logo", "विद्यालय का लोगो")) : tx(p("Principal’s signature", "प्रधानाचार्य के हस्ताक्षर"));
                return (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, border: "1.5px dashed var(--bds)", background: "var(--s2)" }}>
                    <span style={{ flex: "none", width: 64, height: 64, borderRadius: 14, background: "var(--card)", border: "1px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                      {f[k] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f[k] as string} alt="" style={{ maxWidth: "86%", maxHeight: "86%", objectFit: "contain" }} />
                      ) : (
                        <Ic n={k === "logo" ? "image" : "edit"} size={22} style={{ color: "var(--mut)" }} />
                      )}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
                      <span className="clip" style={m12}>{f[k] ? tx(p("Saved image", "सहेजी गई तस्वीर")) : tx(p("Not added yet", "अभी नहीं लगाया"))}</span>
                      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <label className="tap btn sec" style={{ position: "relative", overflow: "hidden", height: 34, padding: "0 12px", fontSize: 13, alignSelf: "flex-start", cursor: "pointer" }}>
                          <Ic n="upload" size={16} />
                          {f[k] ? tx(p("Replace", "बदलें")) : tx(p("Upload", "लगाएँ"))}
                          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label={title} onChange={image(k)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
                        </label>
                        {f[k] ? <Btn variant="ghost" style={{ height: 34, padding: "0 10px", fontSize: 13 }} onClick={() => set(k, null)}>{tx(p("Remove", "हटाएँ"))}</Btn> : null}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            <span style={m12}>{tx(p(`PNG or JPG under ${Math.round(IMAGE_MAX_BYTES / 1024)} KB. Square works best for the logo; a clear scan on white paper for the signature.`, `${Math.round(IMAGE_MAX_BYTES / 1024)} KB से छोटी PNG या JPG। लोगो चौकोर हो; हस्ताक्षर सफ़ेद कागज़ पर साफ़ स्कैन।`))}</span>
          </div>

          <div style={{ ...box, gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={t15}>{tx(p("Receipt footer", "रसीद का नीचे का लेख"))}</span>
              <span className="num" style={{ fontSize: 12, color: footerTone }}>{f.footer.length} / {FOOTER_MAX}</span>
            </div>
            <label className="field">
              <span>{tx(p("Printed at the bottom of every receipt · Hindi first, then English", "हर रसीद के नीचे छपता है · पहले हिंदी, फिर English"))}</span>
              <Textarea maxLength={FOOTER_MAX} value={f.footer} onChange={(e) => set("footer", e.target.value)} style={{ minHeight: 84 }} />
            </label>
          </div>
          {problems.length ? <div role="status" style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", fontSize: 14, fontWeight: 600 }}><Ic n="alert" size={18} />{tx(PROFILE_PROBLEMS[problems[0]])}</div> : null}
        </div>

        <aside className="unstick" style={{ position: "sticky", top: 86, display: "flex", flexDirection: "column", gap: 10, borderTop: 0 }}>
          {sech(tx(p("Live receipt preview", "रसीद का नमूना")), <span style={m12}>{tx(p("Updates as you type", "लिखते ही बदलता है"))}</span>)}
          <div style={{ ...card, padding: 18, display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 10, borderBottom: "1.5px dashed var(--bds)" }}>
              <span style={{ flex: "none", width: 40, height: 40, borderRadius: 11, background: "#082F49", color: "#F7F6F3", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontFamily: "var(--font-display),'Source Serif 4',Georgia,serif", fontWeight: 700 }}>
                {f.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", background: "#fff" }} />
                ) : (
                  initials(f.nameEn) || "VP"
                )}
              </span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="serif" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{f.nameEn || tx(p("School name", "विद्यालय का नाम"))}</span>
                {f.nameHi ? <span lang="hi" style={m12}>{f.nameHi}</span> : null}
                <span style={{ fontSize: 11, color: "var(--sub)" }}>{f.address.split("\n").join(", ")}</span>
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, color: "var(--mut)" }}>रसीद · FEE RECEIPT</span>
              <span className="num" style={{ fontWeight: 700 }}>R-0001</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{tx(p("Sample Student · Class 7", "नमूना विद्यार्थी · कक्षा 7"))}</span>
              <span className="num">{shortDay(new Date())}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--bd)" }}>
              {sample.map(([l, v, w]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--bd)", fontWeight: w }}>
                  <span>{l}</span>
                  <span className="num">{v}</span>
                </div>
              ))}
            </div>
            {f.footer ? <span style={{ padding: "8px 10px", borderRadius: 10, background: "var(--s2)", color: "var(--mut)", fontStyle: "italic", lineHeight: 1.5, whiteSpace: "pre-line" }}>{f.footer}</span> : null}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, paddingTop: 6, borderTop: "1.5px dashed var(--bds)" }}>
              <span className="num" style={{ color: "var(--mut)", fontSize: 11 }}>{[f.phone, f.affiliation ? `Aff. ${f.affiliation}` : ""].filter(Boolean).join(" · ")}</span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                {f.signature ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.signature} alt="" style={{ height: 26 }} />
                ) : (
                  <svg width="56" height="26" viewBox="0 0 56 32" aria-hidden="true"><path d={SIGNATURE_PATH} style={{ fill: "none", stroke: "var(--info)", strokeWidth: 2, strokeLinecap: "round", opacity: 0.35 }} /></svg>
                )}
                <span style={{ fontSize: 10, color: "var(--mut)" }}>{tx(p("Principal", "प्रधानाचार्य"))}</span>
              </span>
            </div>
          </div>
          <span style={m12}>{tx(p("The fee app prints receipts from its own settings until it is retired; this profile is what the new receipts will use.", "फीस ऐप बंद होने तक रसीदें अपनी सेटिंग से छापता है; नई रसीदें यह प्रोफ़ाइल लेंगी।"))}</span>
        </aside>
      </div>
      {changed > 0 ? (
        <div className="glass st-dirty" style={{ position: "sticky", zIndex: 4, display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: "1px solid var(--bd)", animation: "xIn .32s var(--ease) both" }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{tx(p(`${changed} ${changed === 1 ? "change" : "changes"} not saved yet`, `${changed} बदलाव अभी सहेजे नहीं`))}</span>
          <Btn variant="ghost" disabled={pending} onClick={() => setF(initial)}>{tx(p("Discard", "रद्द करें"))}</Btn>
          <Btn variant="pri" icon="check" disabled={pending || problems.length > 0} onClick={() => onSave(f)}>{pending ? tx(p("Saving…", "सहेज रहे हैं…")) : tx(p("Save changes", "बदलाव सहेजें"))}</Btn>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------- preferences */

const ALERTS: { key: string; icon: IconName; tone: Tone; title: Pair; sub: Pair }[] = [
  { key: "day_not_closed", icon: "lock", tone: "warn", title: p("Day not closed by 6 pm", "शाम 6 बजे तक दिन बंद नहीं"), sub: p("A reminder if the cash book is still open.", "अगर नकद बही अभी खुली है तो याद दिलाना।") },
  { key: "big_payment", icon: "rupee", tone: "acc", title: p("A payment over ₹25,000", "₹25,000 से बड़ा भुगतान"), sub: p("Tells you when a large amount is received.", "बड़ी राशि आने पर बताना।") },
  { key: "absent_teacher", icon: "user", tone: "info", title: p("A teacher marked absent", "कोई शिक्षक अनुपस्थित"), sub: p("So cover can be arranged early.", "ताकि जल्दी व्यवस्था हो सके।") },
  { key: "parent_reply", icon: "message", tone: "ok", title: p("A parent replies", "किसी अभिभावक का जवाब"), sub: p("New messages in Replies.", "जवाब में नए संदेश।") },
];

function Prefs({ largeText, alerts, pending, onSave, onLanguage }: { largeText: boolean; alerts: Record<string, boolean>; pending: boolean; onSave: (next: { largeText: boolean; alerts: Record<string, boolean> }) => void; onLanguage: (lang: "en" | "both" | "hi") => void }) {
  const { tx, language } = useVx();
  const { theme, setTheme } = useTheme();
  const [on, setOn] = useState<Record<string, boolean>>(alerts);
  const segRow = (icon: IconName, label: Pair, sub: Pair, width: number, control: ReactNode, first: boolean) => (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 14px", padding: "14px 18px", borderTop: first ? 0 : "1px solid var(--bd)" }}>
      <Tile icon={icon} tone="soft" />
      <span style={{ flex: 1, minWidth: 160, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(label)}</span>
        <span style={m12}>{tx(sub)}</span>
      </span>
      <div className="mfull" style={{ width }}>{control}</div>
    </div>
  );
  const switchRow = (key: string, icon: IconName, tone: Tone, title: Pair, sub: Pair, value: boolean, flip: () => void) => (
    <button key={key} type="button" role="switch" aria-checked={value} className="tap row" onClick={flip} disabled={pending} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", padding: "13px 18px", border: 0, borderTop: "1px solid var(--bd)", background: "transparent", color: "var(--fg)", textAlign: "left" }}>
      <Tile icon={icon} tone={tone} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(title)}</span>
        <span style={m12}>{tx(sub)}</span>
      </span>
      <span className={`sw${value ? " on" : ""}`}><span /></span>
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 780 }}>
      <span style={m13}>{tx(p("Changes save as soon as you make them, for your account on every device.", "बदलाव तुरंत सहेजे जाते हैं, आपके खाते के लिए हर डिवाइस पर।"))}</span>
      <div className="card" style={{ overflow: "hidden" }}>
        {segRow(
          "moon",
          p("Theme", "थीम"),
          p("Auto follows this device’s light or dark setting.", "‘अपने-आप’ इस डिवाइस की हल्की या गहरी सेटिंग मानता है।"),
          270,
          <Seg
            label={tx(p("Theme", "थीम"))}
            value={(theme as "system" | "light" | "dark") ?? "system"}
            onChange={(v) => setTheme(v)}
            options={[
              { value: "light", label: tx(p("Light", "हल्की")) },
              { value: "dark", label: tx(p("Dark", "गहरी")) },
              { value: "system", label: tx(p("Auto", "अपने-आप")) },
            ]}
          />,
          true,
        )}
        {segRow(
          "globe",
          p("App language", "ऐप की भाषा"),
          p("Menus and labels. Parent messages are always Hindi first.", "मेनू और लेबल। अभिभावकों के संदेश हमेशा पहले हिंदी में।"),
          300,
          <Seg<"en" | "both" | "hi">
            label={tx(p("App language", "ऐप की भाषा"))}
            value={language}
            onChange={(v) => onLanguage(v)}
            options={[
              { value: "en", label: "English" },
              { value: "both", label: "EN + हिंदी" },
              { value: "hi", label: "हिंदी" },
            ]}
          />,
          false,
        )}
        {switchRow("large", "type", "mut", p("Large text", "बड़े अक्षर"), p("Bigger letters and buttons, right away.", "बड़े अक्षर और बटन, तुरंत।"), largeText, () => onSave({ largeText: !largeText, alerts: on }))}
        <div style={{ display: "flex", flexDirection: "column", padding: "16px 18px 6px", borderTop: "1px solid var(--bd)" }}>
          <span style={t15}>{tx(p("Alerts", "सूचनाएँ"))}</span>
          <span style={m12}>{tx(p("What you want to hear about. For your account only, never parents.", "आप किस बारे में जानना चाहते हैं। सिर्फ़ आपके खाते के लिए, अभिभावकों को कभी नहीं।"))}</span>
        </div>
        {ALERTS.map((a) =>
          switchRow(a.key, a.icon, a.tone, a.title, a.sub, on[a.key] === true, () => {
            const next = { ...on, [a.key]: !(on[a.key] === true) };
            setOn(next);
            onSave({ largeText, alerts: next });
          }),
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- session */

const yearLabel = (label: string) => label.replace(/(\d{4})-(\d{2})$/, "$1–$2");
const nextLabel = (label: string | null) => {
  const m = label?.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const start = Number(m[1]) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

function SessionPanel({ data, onArchive }: { data: SettingsData; onArchive: () => void }) {
  const { tx } = useVx();
  const current = data.sessionLabel;
  const students = data.master.classes.reduce((n, c) => n + c.students, 0);
  const next = nextLabel(current);
  const past = data.sessions.filter((s) => s !== current);
  const stats: [Pair, string, Pair][] = [
    [p("Students", "विद्यार्थी"), String(students), p(`on the roll · ${data.master.classes.length} classes`, `नामांकित · ${data.master.classes.length} कक्षाएँ`)],
    [p("Subjects", "विषय"), String(data.master.subjects.length), p("in timetables and marks", "समय-सारणी और अंकों में")],
    [p("Archives", "संग्रह"), String(data.archives.filter((a) => a.sessionLabel === current).length), p("sealed copies of this year", "इस साल की मुहरबंद प्रतियाँ")],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 880 }}>
      <div className="rise" style={{ ...card, padding: 20, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 22 }}>
        <Tile icon="calendar" tone="ok" size={64} radius={20} iconSize={28} />
        <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="pill" style={{ alignSelf: "flex-start", background: "var(--oks)", color: "var(--ok)" }}>
            <span className="live-dot" style={{ width: 7, height: 7, background: "var(--ok)" }} />
            {tx(p("Current session", "चालू सत्र"))}
          </span>
          <span className="serif" style={{ fontSize: 32, fontWeight: 600, lineHeight: 1.1 }}>{current ? yearLabel(current) : tx(p("None", "कोई नहीं"))}</span>
          <span style={m13}>{tx(p("Every screen reads this one. It is the fee app’s active session setting.", "हर स्क्रीन यही पढ़ती है। यह फीस ऐप की चालू सत्र सेटिंग है।"))}</span>
        </div>
        <div className="g3" style={{ flexBasis: "100%", display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
          {stats.map(([k, v, s]) => (
            <div key={k.en} style={{ display: "flex", flexDirection: "column", padding: "10px 12px", borderRadius: 14, background: "var(--s2)" }}>
              <span style={{ ...m12, fontWeight: 600 }}>{tx(k)}</span>
              <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>{v}</span>
              <span style={m12}>{tx(s)}</span>
            </div>
          ))}
        </div>
      </div>
      {next ? (
        <div style={{ ...card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, borderStyle: "dashed", borderColor: "var(--bds)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column" }}>
              <span className="sech">{tx(p("Next session", "अगला सत्र"))}</span>
              <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{yearLabel(next)}</span>
              <span style={m13}>{data.sessions.includes(next) ? tx(p("Already in the records", "रिकॉर्ड में पहले से है")) : tx(p("Not prepared yet", "अभी तैयार नहीं"))}</span>
            </span>
            <Btn variant="pri" icon="arrowRight" href="/fees/settings" style={{ height: 44 }}>{tx(p(`Prepare ${yearLabel(next)}`, `${yearLabel(next)} तैयार करें`))}</Btn>
          </div>
          <span style={m13}>{tx(p("Starting a new year happens in the fee settings and Promote & import, so fees and classes move together. Nothing changes in this year until then.", "नया साल फीस सेटिंग और ‘प्रमोट और इम्पोर्ट’ में शुरू होता है, ताकि फीस और कक्षाएँ साथ चलें। तब तक इस साल में कुछ नहीं बदलता।"))}</span>
        </div>
      ) : null}
      {past.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="sech" style={{ padding: "0 4px" }}>{tx(p("Other sessions", "दूसरे सत्र"))}</span>
          <div className="card" style={{ overflow: "hidden" }}>
            {past.map((s, i) => {
              const archived = data.archives.some((a) => a.sessionLabel === s && a.status === "ready");
              const rehearsal = /^TEST-/i.test(s);
              const pill = rehearsal ? { t: p("Rehearsal", "अभ्यास"), bg: "var(--warns)", fg: "var(--warnfg)" } : archived ? { t: p("Archived", "संग्रहित"), bg: "var(--s3)", fg: "var(--mut)" } : { t: p("Closed · archive it", "बंद · संग्रह करें"), bg: "var(--warns)", fg: "var(--warnfg)" };
              const count = data.archives.filter((a) => a.sessionLabel === s).length;
              return (
                <button key={s} type="button" className="tap row" onClick={archived || rehearsal ? undefined : onArchive} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "13px 16px", border: 0, borderTop: i ? "1px solid var(--bd)" : 0, background: "transparent", color: "var(--fg)", textAlign: "left", cursor: archived || rehearsal ? "default" : "pointer", animation: `xIn .32s var(--ease) ${i * 28}ms both` }}>
                  <Tile icon={archived ? "lock" : "archive"} tone="mut" />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{yearLabel(s)}</span>
                    <span className="num" style={m12}>{count ? tx(p(`${count} ${count === 1 ? "archive" : "archives"}`, `${count} संग्रह`)) : tx(p("Not archived yet", "अभी संग्रह नहीं"))}</span>
                  </span>
                  <span className="pill" style={{ background: pill.bg, color: pill.fg }}>{tx(pill.t)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- activity */

/** "Thu 8 Oct", as the design heads a day. */
const day3 = (value: string) => shortDay(value).replace(",", "");
/** "3:12 pm", as the design writes a time. */
const ampm = (value: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value)).toLowerCase();
/** "Mr. Meena" → "M", "Janmejay Singh" → "JS". */
const personInitials = (name: string) => initials(name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, ""));

const WHO_TONES: Tone[] = ["acc", "info", "ok", "warn"];
function whoTone(name: string): Tone {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return WHO_TONES[h % WHO_TONES.length];
}

function Activity({ events }: { events: SettingsData["activity"] }) {
  const { tx } = useVx();
  const [area, setArea] = useState<ActivityArea | "all">("all");
  const [who, setWho] = useState<string>("everyone");
  const [open, setOpen] = useState<string | null>(null);
  const people = useMemo(() => {
    const count = new Map<string, number>();
    for (const e of events) count.set(e.who, (count.get(e.who) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name]) => name);
  }, [events]);
  const shown = events.filter((e) => (area === "all" || e.area === area) && (who === "everyone" || e.who === who));
  const days = groupByDay(shown);
  const today = schoolToday();
  const yesterday = (() => {
    const d = new Date(`${today}T12:00:00+05:30`);
    d.setDate(d.getDate() - 1);
    return schoolToday(d);
  })();
  const dayTitle = (day: string) => (day === today ? `${tx(p("Today", "आज"))} · ${day3(day)}` : day === yesterday ? `${tx(p("Yesterday", "कल"))} · ${day3(day)}` : longDay(day));
  const exportCsv = () => {
    const blob = new Blob([activityCsv(shown)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-${schoolToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const areas: ActivityArea[] = ["money", "students", "marks", "attendance", "settings", "staff", "signin"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="hs" role="group" aria-label={tx(p("Area", "क्षेत्र"))} style={{ flex: 1, minWidth: 0, display: "flex", gap: 6 }}>
          <Chip on={area === "all"} onClick={() => setArea("all")}>{tx(p("All", "सब"))}</Chip>
          {areas.map((a) => (
            <Chip key={a} on={area === a} onClick={() => setArea(a)}>{tx(AREA_LABELS[a])}</Chip>
          ))}
        </div>
        <button type="button" className="tap btn sec" onClick={exportCsv} aria-label={tx(p("Export to Excel", "एक्सेल में निकालें"))}>
          <Ic n="download" size={18} />
          <span className="hide-m">{tx(p("Export", "निकालें"))}</span>
        </button>
      </div>
      <div className="hs" role="group" aria-label={tx(p("Who", "किसने"))} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...m12, flex: "none", fontWeight: 600 }}>{tx(p("Who", "किसने"))}</span>
        <Chip on={who === "everyone"} onClick={() => setWho("everyone")}>{tx(p("Everyone", "सब"))}</Chip>
        {people.map((name) => (
          <Chip key={name} on={who === name} onClick={() => setWho(name)}>{name}</Chip>
        ))}
      </div>
      {days.map((d) => (
        <div key={d.day} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sech(dayTitle(d.day), <span style={{ ...m12, fontWeight: 600 }}>{tx(p(`${d.events.length} ${d.events.length === 1 ? "change" : "changes"}`, `${d.events.length} बदलाव`))}</span>, { padding: "0 4px" })}
          <div className="card" style={{ overflow: "hidden" }}>
            {d.events.map((e, i) => {
              const isOpen = open === e.id;
              const tone = TONE[whoTone(e.who)];
              const tag = TONE[AREA_TONES[e.area]];
              return (
                <div key={e.id} style={{ borderTop: i ? "1px solid var(--bd)" : 0, animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 28}ms both` }}>
                  <button type="button" className="tap row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.id)} style={{ width: "100%", display: "grid", gridTemplateColumns: "36px minmax(0,1fr) auto 18px", gap: 12, alignItems: "center", padding: "12px 16px", textAlign: "left", background: isOpen ? "var(--s2)" : "transparent", border: 0, color: "var(--fg)" }}>
                    <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 18, background: tone.bg, color: tone.fg, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{personInitials(e.who)}</span>
                    <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 14, lineHeight: 1.35 }}><b>{e.who}</b> · {e.text}</span>
                      <span style={{ ...m12, display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="pill" style={{ background: tag.bg, color: tag.fg }}>{tx(AREA_LABELS[e.area])}</span>
                        <span className="only-m num">· {ampm(e.at)}</span>
                      </span>
                    </span>
                    <span className="num hide-m" style={{ ...m12, whiteSpace: "nowrap" }}>{ampm(e.at)}</span>
                    <Ic n="chevDown" size={18} style={{ color: "var(--sub)", transform: `rotate(${isOpen ? 180 : 0}deg)`, transition: "transform .3s var(--spring)" }} />
                  </button>
                  {isOpen ? (
                    <div className="pad fadein" style={{ padding: "2px 16px 16px 64px", display: "flex", flexDirection: "column", gap: 8 }}>
                      {e.changes.map((c) => {
                        const blank = c.before === "—";
                        return (
                          <div key={c.field} className="stack" style={{ display: "grid", gridTemplateColumns: "170px minmax(0,1fr)", gap: "4px 12px", alignItems: "center", fontSize: 13 }}>
                            <span style={{ color: "var(--mut)", fontWeight: 600 }}>{c.field}</span>
                            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                              <span className="num" style={{ padding: "3px 9px", borderRadius: 8, background: blank ? "var(--s3)" : "var(--bads)", color: blank ? "var(--mut)" : "var(--bad)", textDecoration: blank ? "none" : "line-through" }}>{c.before}</span>
                              <Ic n="arrowRight" size={15} style={{ color: "var(--sub)" }} />
                              <span className="num" style={{ padding: "3px 9px", borderRadius: 8, background: "var(--oks)", color: "var(--ok)", fontWeight: 700, animation: "xPopIn .42s .15s var(--spring) both" }}>{c.after}</span>
                            </span>
                          </div>
                        );
                      })}
                      <span style={{ fontSize: 12, color: "var(--sub)" }}>{day3(e.at)} · {ampm(e.at)}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {days.length === 0 ? (
        <div className="card fadein" style={{ padding: "36px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <Tile icon="activity" tone="mut" size={52} radius={26} iconSize={24} />
          <span style={t15}>{tx(p("Nothing logged for this filter", "इस चुनाव में कुछ दर्ज नहीं"))}</span>
          <Btn variant="sec" onClick={() => { setArea("all"); setWho("everyone"); }}>{tx(p("Show everything", "सब दिखाएँ"))}</Btn>
        </div>
      ) : null}
      <span style={{ ...m12, padding: "0 4px" }}>{tx(p("Nobody can edit or delete the log, including the admin.", "इस लॉग को कोई बदल या मिटा नहीं सकता, प्रशासक भी नहीं।"))}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- backups */

function Radio({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
    </span>
  );
}

function Backups({
  data,
  sheet,
  pending,
  onClose,
  onOpen,
  onBackup,
  onDrill,
  onArchive,
}: {
  data: SettingsData;
  sheet: "restore" | "archive" | null;
  pending: boolean;
  onClose: () => void;
  onOpen: (s: "restore" | "archive") => void;
  onBackup: () => void;
  onDrill: (archiveId: string) => void;
  onArchive: (label: string, sessionLabel: string) => void;
}) {
  const { tx } = useVx();
  const today = schoolToday();
  const health = backupHealth(data.backups, today);
  const ready = data.archives.filter((a) => a.status === "ready");
  const [pick, setPick] = useState<string | null>(ready[0]?.id ?? null);
  const closed = data.sessions.filter((s) => s !== data.sessionLabel);
  const [archSession, setArchSession] = useState<string>(closed[0] ?? data.sessionLabel ?? "");
  const [archLabel, setArchLabel] = useState("");
  const last = data.backups[0];
  const sizes = data.backups.map((b) => b.bytes);
  const max = Math.max(1, ...sizes);
  const min = Math.min(...sizes, max);
  const okTile = health === "ok";
  const kv = (l: Pair, v: string) => (
    <span key={l.en} style={{ display: "flex", flexDirection: "column", padding: "8px 10px", borderRadius: 14, background: "var(--s2)", minWidth: 0 }}>
      <span style={{ fontSize: 11, color: "var(--mut)", fontWeight: 600 }}>{tx(l)}</span>
      <span className="num clip" style={{ fontSize: 13, fontWeight: 700 }}>{v}</span>
    </span>
  );
  const dest = (icon: IconName, name: Pair, where: string, working: boolean, boxes: ReactNode[], delay: number) => (
    <div className="rise" style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, animationDelay: `${delay}ms` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Tile icon={icon} tone="acc" size={40} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={t15}>{tx(name)}</span>
          <span className="clip" style={m12}>{where}</span>
        </span>
        <span className="pill" style={{ background: working ? "var(--oks)" : "var(--warns)", color: working ? "var(--ok)" : "var(--warnfg)" }}>
          {working ? <span className="live-dot" style={{ width: 7, height: 7, background: "var(--ok)" }} /> : null}
          {working ? tx(p("Working", "चालू")) : tx(p("Check", "देखें"))}
        </span>
      </div>
      <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>{boxes}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="rise" style={{ ...card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <span aria-hidden="true" style={{ flex: "none", width: 52, height: 52, borderRadius: 16, background: okTile ? "var(--oks)" : "var(--warns)", color: okTile ? "var(--ok)" : "var(--warnfg)", display: "flex", alignItems: "center", justifyContent: "center", animation: "xPopIn .5s var(--spring) both" }}>
            <Ic n={okTile ? "checkCircle" : "alert"} size={26} />
          </span>
          <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column" }}>
            <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{health === "ok" ? tx(p("All backed up", "सब सुरक्षित है")) : health === "late" ? tx(p("Last night’s copy is missing", "कल रात की प्रति नहीं मिली")) : tx(p("No nightly copy yet", "अभी कोई रात की प्रति नहीं"))}</span>
            <span style={m13}>{last ? tx(p(`Every night, the fee records to storage. Last: ${dateLabel(last.day)} · ${bytesLabel(last.bytes)}.`, `हर रात फीस रिकॉर्ड की प्रति। आखिरी: ${dateLabel(last.day)} · ${bytesLabel(last.bytes)}।`)) : tx(p("The nightly backup writes here once its schedule runs.", "रात का बैकअप चलने पर यहाँ दिखेगा।"))}</span>
          </span>
          <div className="mfull" style={{ display: "flex", gap: 8 }}>
            <Btn variant="sec" icon="undo" style={{ flex: 1 }} onClick={() => onOpen("restore")}>{tx(p("Restore…", "वापस लाएँ…"))}</Btn>
            <button type="button" className="tap btn pri" disabled={pending} onClick={onBackup} style={{ flex: 1.4, opacity: pending ? 0.7 : 1 }}>
              <Ic n={pending ? "refresh" : "upload"} size={18} className={pending ? "spin" : undefined} />
              {pending ? tx(p("Backing up…", "बैकअप हो रहा है…")) : tx(p("Back up now", "अभी बैकअप लें"))}
            </button>
          </div>
        </div>
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
        {dest("cloud", p("Nightly fee backup", "रात का फीस बैकअप"), tx(p("Storage bucket · nightly-backups", "स्टोरेज · nightly-backups")), health === "ok", [
          kv(p("Last run", "आखिरी बार"), last ? dateLabel(last.day) : "—"),
          kv(p("Size", "आकार"), bytesLabel(last?.bytes)),
          kv(p("Files", "फ़ाइलें"), String(last?.files ?? 0)),
        ], 40)}
        {dest("database", p("Sealed archives", "मुहरबंद संग्रह"), tx(p("Every VPPS One table and document", "VPPS One की हर तालिका और दस्तावेज़")), ready.length > 0, [
          kv(p("Last built", "आखिरी बना"), data.archives[0] ? dateLabel(data.archives[0].createdAt) : "—"),
          kv(p("Size", "आकार"), bytesLabel(data.archives[0]?.totalBytes)),
          kv(p("Restore check", "जाँच"), data.archives[0]?.lastDrill ? (data.archives[0].lastDrill.ok ? tx(p("Passed", "सफल")) : tx(p("Failed", "विफल"))) : tx(p("Not run", "नहीं चली"))),
        ], 80)}
      </div>
      <button type="button" className="tap card lift" onClick={() => onOpen("archive")} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", padding: "14px 18px", textAlign: "left", color: "var(--fg)" }}>
        <Tile icon="archive" tone="warn" size={40} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={t15}>{tx(p("Archive old sessions", "पुराने सत्र संग्रह करें"))}</span>
          <span style={m12}>{closed.length ? tx(p(`${yearLabel(closed[0])} can be archived · ${data.archives.length} archives so far`, `${yearLabel(closed[0])} संग्रह हो सकता है · अब तक ${data.archives.length} संग्रह`)) : tx(p(`Seal a copy of a session · ${data.archives.length} archives so far`, `किसी सत्र की मुहरबंद प्रति · अब तक ${data.archives.length} संग्रह`))}</span>
        </span>
        <Ic n="chevRight" size={18} style={{ color: "var(--sub)" }} />
      </button>
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 16, padding: "14px 18px 10px" }}>
          <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
            <span style={t15}>{tx(p(`Last ${Math.max(data.backups.length, 1)} nights`, `पिछली ${Math.max(data.backups.length, 1)} रातें`))}</span>
            <span style={m12}>{tx(p("Each copy is kept in storage.", "हर प्रति स्टोरेज में रखी जाती है।"))}</span>
          </span>
          <span aria-hidden="true" style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 44 }}>
            {[...data.backups].reverse().map((b, i, all) => (
              <span key={b.day} style={{ width: 9, height: Math.round(10 + (max === min ? 30 : ((b.bytes - min) / (max - min)) * 34)), borderRadius: 3, background: i === all.length - 1 ? "var(--acc)" : "var(--c4)", transformOrigin: "bottom", animation: `xGrowY .5s var(--ease) ${i * 30}ms both` }} />
            ))}
          </span>
        </div>
        {data.backups.length === 0 ? <div style={{ padding: "24px 18px", borderTop: "1px solid var(--bd)", ...m13 }}>{tx(p("The nightly backup has not written to storage on this deployment.", "इस डिप्लॉयमेंट पर रात का बैकअप अभी नहीं लिखा गया।"))}</div> : null}
        {data.backups.map((b, i) => (
          <div key={b.day} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 12, alignItems: "center", padding: "10px 18px", borderTop: "1px solid var(--bd)", animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 28}ms both` }}>
            <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>{day3(b.day)}</span>
              <span style={m12}>{tx(p(`Nightly · ${b.files} files`, `रात · ${b.files} फ़ाइलें`))}</span>
            </span>
            <span className="num" style={m13}>{bytesLabel(b.bytes)}</span>
            <span className="pill" style={{ background: b.files ? "var(--oks)" : "var(--bads)", color: b.files ? "var(--ok)" : "var(--bad)" }}>
              <Ic n={b.files ? "check" : "alert"} size={12} stroke={2.4} />
              {b.files ? tx(p("Saved", "सुरक्षित")) : tx(p("Empty", "खाली"))}
            </span>
          </div>
        ))}
      </div>

      <Sheet
        open={sheet === "restore"}
        onClose={onClose}
        title={tx(p("Restore a backup", "बैकअप वापस लाएँ"))}
        sub={tx(p("Pick the copy to check.", "जाँचने के लिए प्रति चुनें।"))}
        footer={
          <>
            <Btn variant="sec" style={{ flex: 1 }} onClick={onClose}>{tx(p("Not now", "अभी नहीं"))}</Btn>
            <Btn variant="danger" icon="undo" style={{ flex: 1.4 }} disabled={!pick || pending} onClick={() => pick && onDrill(pick)}>{pending ? tx(p("Checking…", "जाँच रहे हैं…")) : tx(p("Check this copy restores", "जाँचें कि प्रति लौटती है"))}</Btn>
          </>
        }
      >
        <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
          {ready.length === 0 ? <span style={m13}>{tx(p("No sealed copy yet. Press Back up now to make one.", "अभी कोई मुहरबंद प्रति नहीं। एक बनाने के लिए ‘अभी बैकअप लें’ दबाएँ।"))}</span> : null}
          {ready.slice(0, 8).map((a) => {
            const on = pick === a.id;
            return (
              <button key={a.id} type="button" role="radio" aria-checked={on} className="tap" onClick={() => setPick(a.id)} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 54, padding: "10px 14px", borderRadius: 14, border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)", color: "var(--fg)", textAlign: "left" }}>
                <Radio on={on} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>{a.label}</span>
                  <span style={m12}>{`${dateLabel(a.createdAt)} · ${bytesLabel(a.totalBytes)} · ${a.rowCount ?? 0} rows${a.lastDrill ? ` · last check ${a.lastDrill.ok ? "passed" : "failed"}` : ""}`}</span>
                </span>
              </button>
            );
          })}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", fontSize: 14, lineHeight: 1.5 }}>
            <Ic n="alert" size={18} style={{ marginTop: 2 }} />
            <span>{tx(p("This loads the copy into scratch tables and re-checks every file — the live records are not touched. Putting a copy back over live data is done by the developer, with a copy of right now taken first.", "यह प्रति को अलग तालिकाओं में लोड करके हर फ़ाइल जाँचता है — असली रिकॉर्ड नहीं छुए जाते। असली डेटा पर प्रति वापस डालना डेवलपर करते हैं, पहले अभी की प्रति लेकर।"))}</span>
          </div>
          <span style={{ ...m13, display: "flex", gap: 8, alignItems: "center" }}>
            <Ic n="shield" size={18} style={{ color: "var(--ok)" }} />
            {tx(p("Nothing live changes during a check.", "जाँच के दौरान असली डेटा नहीं बदलता।"))}
          </span>
        </div>
      </Sheet>

      <Sheet
        open={sheet === "archive"}
        onClose={onClose}
        title={tx(p("Archive a session", "सत्र संग्रह करें"))}
        sub={tx(p("A sealed, checked copy of everything in it.", "उसमें सब कुछ की मुहरबंद, जाँची हुई प्रति।"))}
        footer={
          <>
            <Btn variant="sec" style={{ flex: 1 }} onClick={onClose}>{tx(p("Not now", "अभी नहीं"))}</Btn>
            <Btn variant="pri" icon="archive" style={{ flex: 1.4 }} disabled={pending || !archLabel.trim() || !archSession} onClick={() => onArchive(archLabel, archSession)}>{pending ? tx(p("Building…", "बन रहा है…")) : tx(p("Build archive", "संग्रह बनाएँ"))}</Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
          <label className="field">
            <span>{tx(p("Session", "सत्र"))}</span>
            <span className="hs" style={{ display: "flex", gap: 6 }}>
              {data.sessions.map((s) => (
                <Chip key={s} on={archSession === s} onClick={() => setArchSession(s)}>{yearLabel(s)}</Chip>
              ))}
            </span>
          </label>
          <label className="field">
            <span>{tx(p("Name", "नाम"))}</span>
            <Input value={archLabel} onChange={(e) => setArchLabel(e.target.value)} placeholder={`Session ${archSession} · year end`} />
          </label>
          {data.archives.slice(0, 5).map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderTop: "1px solid var(--bd)", paddingTop: 8 }}>
              <span>{a.label} · {a.sessionLabel}</span>
              <Pill tone={a.status === "ready" ? "ok" : a.status === "failed" ? "bad" : "warn"}>{a.status}</Pill>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------- master data */

type MasterTab = "classes" | "subjects" | "houses" | "modes" | "holidays";

function Master({ master }: { master: SettingsData["master"] }) {
  const { tx } = useVx();
  const [tab, setTab] = useState<MasterTab>("classes");
  const tabs: { key: MasterTab; label: Pair; n: number; help: Pair; dot: string; href: string; open: Pair }[] = [
    { key: "classes", label: p("Classes & sections", "कक्षाएँ और सेक्शन"), n: master.classes.length, help: p("In school order. Teachers and strength come from Staff and Students.", "विद्यालय के क्रम में। शिक्षक और संख्या स्टाफ़ और विद्यार्थियों से आती है।"), dot: "var(--acc)", href: "/academics/classes", open: p("Open classes", "कक्षाएँ खोलें") },
    { key: "subjects", label: p("Subjects", "विषय"), n: master.subjects.length, help: p("Subjects used in timetables, marks and report cards.", "समय-सारणी, अंक और रिपोर्ट कार्ड में इस्तेमाल होने वाले विषय।"), dot: "var(--info)", href: "/academics/subjects", open: p("Open subjects", "विषय खोलें") },
    { key: "houses", label: p("Houses", "हाउस"), n: master.houses.length, help: p("Houses on the students’ records.", "विद्यार्थियों के रिकॉर्ड में लिखे हाउस।"), dot: "var(--c3)", href: "/fees/master-data", open: p("Open master data", "मूल डेटा खोलें") },
    { key: "modes", label: p("Payment modes", "भुगतान के तरीके"), n: master.paymentModes.length, help: p("How parents have paid. Old receipts always keep their mode.", "अभिभावकों ने कैसे भुगतान किया। पुरानी रसीदें अपना तरीका रखती हैं।"), dot: "var(--acc)", href: "/fees/settings", open: p("Open fee settings", "फीस सेटिंग खोलें") },
    { key: "holidays", label: p("Holidays", "छुट्टियाँ"), n: master.holidays.length, help: p("Holidays from the fee calendar. They also show in the calendar.", "फीस कैलेंडर की छुट्टियाँ। ये कैलेंडर में भी दिखती हैं।"), dot: "var(--warn)", href: "/calendar", open: p("Open calendar", "कैलेंडर खोलें") },
  ];
  const t = tabs.find((x) => x.key === tab) ?? tabs[0];
  const rows: { key: string; title: string; sub: string }[] =
    tab === "classes"
      ? master.classes.map((c) => ({ key: c.id, title: c.label, sub: `${c.classTeacher ?? tx(p("No class teacher", "कक्षा शिक्षक नहीं"))} · ${c.students} ${tx(p("students", "विद्यार्थी"))}` }))
      : tab === "subjects"
        ? master.subjects.map((s) => ({ key: s.id, title: s.name, sub: `${s.code}${s.active ? "" : ` · ${tx(p("turned off", "बंद"))}`}` }))
        : tab === "houses"
          ? master.houses.map((h) => ({ key: h.name, title: h.name, sub: `${h.students} ${tx(p("students", "विद्यार्थी"))}` }))
          : tab === "modes"
            ? master.paymentModes.map((m) => ({ key: m.mode, title: m.mode.replace(/_/g, " "), sub: `${m.receipts} ${tx(p("receipts", "रसीदें"))}` }))
            : master.holidays.map((h) => ({ key: h.day, title: h.label, sub: shortDay(h.day) }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 860 }}>
      <div className="hs" role="tablist" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--bd)" }}>
        {tabs.map((x) => {
          const on = x.key === tab;
          return (
            <button key={x.key} type="button" role="tab" aria-selected={on} className="tap" onClick={() => setTab(x.key)} style={{ flex: "none", height: 44, padding: "0 14px", border: 0, borderBottom: `2.5px solid ${on ? "var(--acc)" : "transparent"}`, background: "transparent", color: on ? "var(--fg)" : "var(--mut)", fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
              {tx(x.label)}
              <span className="pill num" style={{ background: "var(--s3)", color: "var(--mut)" }}>{x.n}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <span style={m13}>{tx(t.help)}</span>
        <Btn variant="soft" icon="edit" href={t.href}>{tx(t.open)}</Btn>
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        {rows.length === 0 ? <div style={{ padding: "24px 18px", ...m13 }}>{tx(p("Nothing here yet.", "अभी यहाँ कुछ नहीं।"))}</div> : null}
        {rows.map((r, i) => (
          <div key={r.key} className="row" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 60, padding: "8px 10px 8px 16px", borderTop: i ? "1px solid var(--bd)" : 0, animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 28}ms both` }}>
            <span className="num" style={{ flex: "none", width: 22, fontSize: 12, color: "var(--sub)", fontWeight: 700 }}>{i + 1}</span>
            <span style={{ flex: "none", width: 12, height: 12, borderRadius: 6, background: t.dot }} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{r.title}</span>
              <span className="clip" style={m12}>{r.sub}</span>
            </span>
            <Link href={t.href} className="tap btn ghost" aria-label={tx(p(`Edit ${r.title}`, `${r.title} बदलें`))} style={{ width: 38, height: 38, padding: 0 }}>
              <Ic n="edit" size={18} />
            </Link>
          </div>
        ))}
      </div>
      <span style={{ ...m12, padding: "0 4px" }}>{tx(p("Read here; changed in the screen that owns it, so every list, report and report card stays in step.", "यहाँ पढ़ें; बदलाव उसी स्क्रीन में होता है जिसका यह है, ताकि हर सूची और रिपोर्ट एक जैसी रहे।"))}</span>
    </div>
  );
}

/* ------------------------------------------------------------ integrations */

const INTEGRATION_LOOK: Record<string, { icon: IconName; tone: Tone; action: Pair; actionIcon: IconName }> = {
  aisensy: { icon: "message", tone: "ok", action: p("Templates", "टेम्पलेट"), actionIcon: "file" },
  sampark: { icon: "link", tone: "acc", action: p("Manage links", "लिंक देखें"), actionIcon: "clipboard" },
  backups: { icon: "cloud", tone: "info", action: p("Backups", "बैकअप"), actionIcon: "cloud" },
  jobs: { icon: "clock", tone: "warn", action: p("Scheduled jobs", "निर्धारित कार्य"), actionIcon: "list" },
};

function Integrations({ data }: { data: SettingsData }) {
  const { tx } = useVx();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={m13}>{tx(p("The outside services VPPS One talks to. Nothing here sends anything to parents.", "बाहर की सेवाएँ जिनसे VPPS One जुड़ा है। यहाँ से अभिभावकों को कुछ नहीं जाता।"))}</span>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
        {data.integrations.map((i, n) => {
          const look = INTEGRATION_LOOK[i.key] ?? INTEGRATION_LOOK.jobs;
          const st = i.status === "pending" ? { t: taskIntegration.pending, bg: "var(--warns)", fg: "var(--warnfg)" } : i.status === "on" ? { t: p("Connected", "जुड़ा है"), bg: "var(--oks)", fg: "var(--ok)" } : i.status === "partial" ? { t: p("Partly set up", "आधा तैयार"), bg: "var(--warns)", fg: "var(--warnfg)" } : { t: p("Not set up", "तैयार नहीं"), bg: "var(--s3)", fg: "var(--mut)" };
          return (
            <div key={i.key} className="rise" style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, animationDelay: `${n * 28}ms` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Tile icon={look.icon} tone={look.tone} size={44} radius={13} iconSize={21} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={t15}>{i.name}</span>
                  <span style={m12}>{i.taskDelivery ? tx(taskIntegration.sub) : i.sub}</span>
                </span>
                <span className="pill" style={{ background: st.bg, color: st.fg }}>
                  {i.status === "on" ? <span className="live-dot" style={{ width: 7, height: 7, background: "var(--ok)" }} /> : null}
                  {tx(st.t)}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {i.facts.map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: "1px solid var(--bd)", fontSize: 13 }}>
                    <span style={{ color: "var(--mut)" }}>{l}</span>
                    <span className="num" style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
                  </div>
                ))}
              </div>
              {i.taskDelivery && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={m13}>{tx(i.taskDelivery === "ready" ? taskIntegration.ready : i.taskDelivery === "test_mode" ? taskIntegration.test : taskIntegration.deferred)}</p>
                <p style={m13}>{tx(taskIntegration.local)}: {i.localContracts ?? 0}</p>
                <p style={m12}>{tx(taskIntegration.localNote)}</p>
                <p style={m13}>{tx(taskIntegration.manualNote)}</p>
              </div>}
              {i.href ? (
                <Btn variant="soft" icon={i.taskDelivery ? "link" : look.actionIcon} href={i.href} style={{ width: "100%" }}>{tx(i.taskDelivery ? taskIntegration.manual : look.action)}</Btn>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- glossary */

function Glossary() {
  const { tx } = useVx();
  const [q, setQ] = useState("");
  const shown = GLOSSARY.filter((e) => matchesGlossary(e, q));
  const count = q.trim() ? tx(p(`${shown.length} of ${GLOSSARY.length} words`, `${GLOSSARY.length} में से ${shown.length} शब्द`)) : tx(p(`${GLOSSARY.length} words the app uses, in plain language`, `ऐप के ${GLOSSARY.length} शब्द, आसान भाषा में`));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, height: 48, maxWidth: 520, padding: "0 16px", borderRadius: 24, border: "1px solid var(--bds)", background: "var(--card)", color: "var(--mut)", boxShadow: "var(--sh)" }}>
        <Ic n="search" size={18} />
        <span className="sr">{tx(p("Search the glossary", "शब्दकोश में खोजें"))}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Look up a word · शब्द खोजें" style={{ flex: 1, minWidth: 0, height: 38, border: 0, outline: "none", background: "transparent", fontSize: 15 }} />
      </label>
      <span style={m13}>{count}</span>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
        {shown.map((e, i) => {
          const tag = GLOSSARY_TAGS[e.tag];
          const tone = TONE[tag.tone];
          return (
            <div key={e.term.en} className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6, animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 28}ms both` }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{e.term.en}</span>
                <span lang="hi" style={{ fontSize: 15, color: "var(--accfg)", fontWeight: 600 }}>{e.term.hi}</span>
                <span className="pill" style={{ marginLeft: "auto", background: tone.bg, color: tone.fg }}>{tx(tag.label)}</span>
              </div>
              <span style={{ fontSize: 14, lineHeight: 1.5 }}>{e.meaning.en}</span>
              <span lang="hi" style={{ ...m13, lineHeight: 1.6 }}>{e.meaning.hi}</span>
            </div>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <div className="card fadein" style={{ padding: "32px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span style={t15}>{tx(p(`No word matches “${q.trim()}”`, `“${q.trim()}” से कोई शब्द नहीं मिला`))}</span>
          <span style={m13}>{tx(p("Try a shorter word.", "छोटा शब्द आज़माएँ।"))}</span>
          <Btn variant="sec" onClick={() => setQ("")}>{tx(p("Clear search", "खोज साफ़ करें"))}</Btn>
        </div>
      ) : null}
    </div>
  );
}
