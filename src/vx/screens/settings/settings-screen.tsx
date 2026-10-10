"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useMemo, useState, useTransition } from "react";

import { saveLanguageAction } from "@/app/(app)/preferences/actions";
import { archiveSessionAction, backupNowAction, restoreDrillAction, savePrefsAction, saveProfileAction, type SettingsResult } from "@/app/(app)/settings/actions";
import { clock, dateLabel, initials, longDay, schoolToday } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p } from "@/vx/text";
import { Chip, ChipRow, Field, Input, RadioCard, Seg, SearchBox, SwitchRow, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, Grid, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, Btn, Card, CardHead, EmptyState, IconTile, Pill, SecHead } from "@/vx/ui/primitives";

import type { SettingsData } from "./data";
import {
  activityCsv,
  AREA_LABELS,
  AREA_TONES,
  backupHealth,
  bytesLabel,
  CLASSIC_SCREENS,
  FOOTER_MAX,
  GLOSSARY,
  groupByDay,
  IMAGE_MAX_BYTES,
  matchesGlossary,
  PROFILE_PROBLEMS,
  profileProblems,
  type ActivityArea,
  type SchoolProfile,
  type SettingsState,
} from "./domain/settings";

const go = (s: SettingsState) => (s === "home" ? "/settings" : `/settings?s=${s}`);

type NavItem = { s: SettingsState; icon: IconName; title: string; sub: string };

export function SettingsScreen({ data, state }: { data: SettingsData; state: SettingsState }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [largeText, setLargeText] = useState(data.prefs.largeText);

  const done = (result: SettingsResult) => {
    toast.show({ text: tx(result.message), tone: result.ok ? "ok" : "bad" });
    if (result.ok) router.refresh();
  };

  const today = schoolToday();
  const todayChanges = data.activity.filter((e) => e.at.slice(0, 10) === today).length;
  const lastBackup = data.backups[0];

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: "School",
      items: [
        { s: "school", icon: "building", title: "School profile", sub: "Name, logo, signature, receipt footer" },
        { s: "prefs", icon: "sliders", title: "Preferences", sub: "Theme, language, large text" },
        { s: "session", icon: "calendar", title: "Session & year", sub: data.sessionLabel ? `${data.sessionLabel} · running now` : "No session" },
      ],
    },
    {
      title: "Records",
      items: [
        { s: "activity", icon: "activity", title: "Activity log", sub: `${todayChanges} changes today` },
        { s: "backups", icon: "cloud", title: "Backups & archive", sub: lastBackup ? `Last copy ${dateLabel(lastBackup.day)}` : "No nightly copy yet" },
        { s: "master", icon: "layers", title: "Master data", sub: `${data.master.classes.length} classes · ${data.master.subjects.length} subjects` },
      ],
    },
    { title: "Connected", items: [{ s: "integrations", icon: "link", title: "Integrations", sub: data.integrations.map((i) => i.name.split(" ")[0]).join(" · ") }] },
    { title: "Help", items: [{ s: "glossary", icon: "book", title: "Glossary", sub: "Plain meanings · English + हिंदी" }] },
  ];
  const titles: Record<SettingsState, string> = {
    home: "Settings",
    school: "School profile",
    prefs: "Preferences",
    session: "Session & year",
    activity: "Activity log",
    backups: "Backups & archive",
    restore: "Backups & archive",
    archive: "Backups & archive",
    master: "Master data",
    integrations: "Integrations",
    glossary: "Glossary",
  };
  const active: SettingsState = state === "home" ? "school" : state;

  const nav = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {groups.map((g) => (
        <div key={g.title} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SecHead>{g.title}</SecHead>
          <Card pad={false} style={{ overflow: "hidden" }}>
            {g.items.map((item, i) => (
              <Link key={item.s} href={go(item.s)} className={`row tap${item.s === active || (item.s === "backups" && (active === "restore" || active === "archive")) ? " sel" : ""}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: i ? "1px solid var(--bd)" : 0, color: "inherit", textDecoration: "none" }}>
                <IconTile icon={item.icon} size={36} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <b className="clip">{item.title}</b>
                  <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{item.sub}</span>
                </span>
                <Ic n="chevRight" size={18} style={{ color: "var(--mut)" }} />
              </Link>
            ))}
            {g.title === "School" ? (
              <Link href="/staff?view=roles" className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: "1px solid var(--bd)", color: "inherit", textDecoration: "none" }}>
                <IconTile icon="shield" size={36} tone="ok" />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <b>Users & roles</b>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{data.staffCount} people · {data.roleCount} roles</span>
                </span>
                <Ic n="arrowRight" size={18} style={{ color: "var(--mut)" }} />
              </Link>
            ) : null}
          </Card>
        </div>
      ))}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SecHead>Classic screens</SecHead>
        <Card pad={false} style={{ overflow: "hidden" }}>
          {CLASSIC_SCREENS.map((c, i) => (
            <Link key={c.href} href={c.href} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: i ? "1px solid var(--bd)" : 0, color: "inherit", textDecoration: "none" }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <b className="clip">{tx(c.label)}</b>
                <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{c.sub}</span>
              </span>
              <Ic n="arrowRight" size={16} style={{ color: "var(--mut)" }} />
            </Link>
          ))}
        </Card>
      </div>
    </div>
  );

  let content: React.ReactNode = null;
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
      content = <SessionPanel current={data.sessionLabel} sessions={data.sessions} />;
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
  }

  return (
    <VxPage style={largeText ? { fontSize: 16 } : undefined}>
      <TopBar crumb="System · Settings" title={titles[active]} mTitle={titles[state]} mBack={state === "home" ? "/menu" : "/settings"} mSub={state === "backups" && lastBackup ? `Last copy ${dateLabel(lastBackup.day)}` : undefined} />
      <main>
        <Section>
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr)", gap: 24, alignItems: "start" }}>
            <div className={state === "home" ? "" : "hide-m"}>{nav}</div>
            <div className={state === "home" ? "hide-m" : ""} style={{ minWidth: 0 }}>{content}</div>
          </div>
        </Section>
      </main>
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

function SchoolProfileForm({ initial, changedAt, changedBy, pending, onSave }: { initial: SchoolProfile; changedAt: string | null; changedBy: string | null; pending: boolean; onSave: (p: SchoolProfile) => void }) {
  const { tx } = useVx();
  const toast = useToast();
  const [f, setF] = useState<SchoolProfile>(initial);
  const set = <K extends keyof SchoolProfile>(k: K, v: SchoolProfile[K]) => setF((x) => ({ ...x, [k]: v }));
  const problems = profileProblems(f);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const image = (k: "logo" | "signature") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImage(file, (url) => {
      if (!url) toast.show({ text: `Use a PNG or JPG under ${Math.round(IMAGE_MAX_BYTES / 1024)} KB.`, tone: "bad" });
      else set(k, url);
    });
  };

  return (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <CardHead title="Name and address" sub={changedAt ? `Last changed ${dateLabel(changedAt)}${changedBy ? ` · ${changedBy}` : ""}` : "Not saved yet"} />
          <Grid cols={2}>
            <Field label="School name · English"><Input value={f.nameEn} onChange={(e) => set("nameEn", e.target.value)} /></Field>
            <Field label="School name · हिंदी"><Input lang="hi" value={f.nameHi} onChange={(e) => set("nameHi", e.target.value)} /></Field>
          </Grid>
          <Field label="Address"><Textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Grid cols={2}>
            <Field label="Affiliation number"><Input value={f.affiliation} onChange={(e) => set("affiliation", e.target.value)} /></Field>
            <Field label="Office phone"><Input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          </Grid>
        </Card>
        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <CardHead title="Logo and signature" />
          <Grid cols={2}>
            {(["logo", "signature"] as const).map((k) => (
              <div key={k} style={{ border: "1.5px dashed var(--bd)", borderRadius: 14, padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 56, height: 56, borderRadius: 12, background: "var(--s2)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flex: "none" }}>
                  {f[k] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f[k] as string} alt="" style={{ maxWidth: "100%", maxHeight: "100%" }} />
                  ) : (
                    <Ic n={k === "logo" ? "image" : "edit"} size={22} style={{ color: "var(--mut)" }} />
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <b>{k === "logo" ? "School logo" : "Principal's signature"}</b>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <label className="tap btn sec" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid var(--bd)", fontWeight: 600, fontSize: 13 }}>
                      <Ic n="upload" size={16} /> {f[k] ? "Replace" : "Upload"}
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={image(k)} style={{ display: "none" }} />
                    </label>
                    {f[k] ? <Btn variant="ghost" onClick={() => set(k, null)}>Remove</Btn> : null}
                  </span>
                </span>
              </div>
            ))}
          </Grid>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>PNG or JPG under {Math.round(IMAGE_MAX_BYTES / 1024)} KB. Square works best for the logo; a clear scan on white paper for the signature.</span>
        </Card>
        <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <CardHead title="Receipt footer" sub={`${f.footer.length} / ${FOOTER_MAX}`} />
          <span style={{ fontSize: 13, color: "var(--mut)" }}>Printed at the bottom of every receipt · Hindi first, then English</span>
          <Textarea rows={3} maxLength={FOOTER_MAX} value={f.footer} onChange={(e) => set("footer", e.target.value)} />
        </Card>
        {problems.length ? <Banner tone="warn">{tx(PROFILE_PROBLEMS[problems[0]])}</Banner> : null}
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="sec" disabled={!dirty || pending} onClick={() => setF(initial)}>Discard</Btn>
          <Btn variant="pri" icon="check" disabled={!dirty || pending || problems.length > 0} onClick={() => onSave(f)}>{pending ? "Saving…" : "Save profile"}</Btn>
        </div>
      </div>
      <div className="unstick" style={{ position: "sticky", top: 84, display: "flex", flexDirection: "column", gap: 8 }}>
        <SecHead action={<span style={{ fontSize: 12, color: "var(--mut)" }}>Updates as you type</span>}>Live receipt preview</SecHead>
        <Card style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {f.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.logo} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "contain" }} />
            ) : (
              <Avatar text={initials(f.nameEn) || "VP"} seed="school" size={44} />
            )}
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <b className="serif" style={{ fontSize: 16 }}>{f.nameEn || "School name"}</b>
              {f.nameHi ? <span lang="hi">{f.nameHi}</span> : null}
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{f.address}</span>
            </span>
          </div>
          <div style={{ borderTop: "1px dashed var(--bd)", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
            <b>रसीद · FEE RECEIPT</b>
            <b className="num">R-0001</b>
          </div>
          {[["Sample Student · Class 7", longDay(new Date())], ["Academic fee · Instalment 2", "₹6,450"], ["Transport · October", "₹800"]].map(([l, r]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--bd)", paddingTop: 6 }}>
              <span>{l}</span>
              <span className="num">{r}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}><span>Total received</span><span className="num">₹7,250</span></div>
          {f.footer ? <div style={{ background: "var(--s2)", borderRadius: 10, padding: 10, fontStyle: "italic", color: "var(--mut)", whiteSpace: "pre-wrap" }}>{f.footer}</div> : null}
          <div style={{ borderTop: "1px dashed var(--bd)", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 12, color: "var(--mut)" }}>
            <span className="num">{[f.phone, f.affiliation ? `Aff. ${f.affiliation}` : ""].filter(Boolean).join(" · ")}</span>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {f.signature ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.signature} alt="" style={{ height: 28 }} />
              ) : null}
              Principal
            </span>
          </div>
        </Card>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>The fee app prints receipts from its own settings until it is retired; this profile is what the new receipts will use.</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- preferences */

const ALERTS: { key: string; title: string; sub: string }[] = [
  { key: "day_not_closed", title: "Day not closed by 6 pm", sub: "A reminder if the cash book is still open" },
  { key: "big_payment", title: "A payment over ₹25,000", sub: "Tells you when a large amount is received" },
  { key: "absent_teacher", title: "A teacher marked absent", sub: "So cover can be arranged early" },
  { key: "parent_reply", title: "A parent replies", sub: "New messages in Replies" },
];

function Prefs({ largeText, alerts, pending, onSave, onLanguage }: { largeText: boolean; alerts: Record<string, boolean>; pending: boolean; onSave: (next: { largeText: boolean; alerts: Record<string, boolean> }) => void; onLanguage: (lang: "en" | "both" | "hi") => void }) {
  const { language } = useVx();
  const { theme, setTheme } = useTheme();
  const [on, setOn] = useState<Record<string, boolean>>(alerts);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
      <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CardHead title="Theme" />
        <Seg
          label="Theme"
          value={(theme as "system" | "light" | "dark") ?? "system"}
          onChange={(v) => setTheme(v)}
          options={[
            { value: "system", label: "Auto" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Card>
      <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CardHead title={<Bi en="Language" hi="भाषा" />} sub="How you read the app. Each person chooses their own." />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="radiogroup">
          <RadioCard checked={language === "both"} onSelect={() => onLanguage("both")} title="English with हिंदी" sub="English first, Hindi under key words" />
          <RadioCard checked={language === "hi"} onSelect={() => onLanguage("hi")} title="हिंदी" sub="Hindi first, English under key words" />
          <RadioCard checked={language === "en"} onSelect={() => onLanguage("en")} title="English" sub="English only" />
        </div>
      </Card>
      <Card>
        <SwitchRow icon="type" title="Large text" sub="Bigger letters on this screen now; across the app once the shell reads it" on={largeText} onChange={(v) => onSave({ largeText: v, alerts: on })} />
      </Card>
      <Card>
        <CardHead title="Alerts" sub="What the app tells you about" />
        {ALERTS.map((a) => (
          <SwitchRow
            key={a.key}
            title={a.title}
            sub={a.sub}
            on={on[a.key] === true}
            onChange={(v) => {
              const next = { ...on, [a.key]: v };
              setOn(next);
              onSave({ largeText, alerts: next });
            }}
          />
        ))}
        {pending ? <span style={{ fontSize: 12, color: "var(--mut)" }}>Saving…</span> : null}
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- session */

function SessionPanel({ current, sessions }: { current: string | null; sessions: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
      <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <IconTile icon="calendar" tone="ok" size={48} />
        <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>Current session</span>
          <b className="serif" style={{ fontSize: 24 }}>{current ?? "None"}</b>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>Every screen reads this one. It is the fee app&apos;s active session setting.</span>
        </span>
      </Card>
      <Card pad={false} style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 18px" }}><CardHead title="All sessions" sub={`${sessions.length} in the records`} /></div>
        {sessions.map((s) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--bd)" }}>
            <b style={{ flex: 1 }}>{s}</b>
            {s === current ? <Pill tone="ok">Running</Pill> : /^TEST-/.test(s) ? <Pill tone="warn">Rehearsal</Pill> : <Pill tone="mut">Closed</Pill>}
          </div>
        ))}
      </Card>
      <Banner tone="info" action={<Btn variant="soft" href="/fees/settings">Open fee settings</Btn>}>Starting a new year and promoting children happens in the fee app&apos;s settings and Promote & import, so fees and classes move together.</Banner>
    </div>
  );
}

/* ---------------------------------------------------------------- activity */

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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <ChipRow label="Area" style={{ flex: 1, minWidth: 0 }}>
          <Chip on={area === "all"} onClick={() => setArea("all")}>All</Chip>
          {areas.map((a) => (
            <Chip key={a} on={area === a} onClick={() => setArea(a)}>{tx(AREA_LABELS[a])}</Chip>
          ))}
        </ChipRow>
        <Btn variant="sec" icon="download" onClick={exportCsv}>Export</Btn>
      </div>
      <ChipRow label="Who">
        <span style={{ alignSelf: "center", fontSize: 13, color: "var(--mut)" }}>Who</span>
        <Chip on={who === "everyone"} onClick={() => setWho("everyone")}>Everyone</Chip>
        {people.map((name) => (
          <Chip key={name} on={who === name} onClick={() => setWho(name)}>{name}</Chip>
        ))}
      </ChipRow>
      {days.length === 0 ? <EmptyState icon="activity" title="Nothing recorded" body="Changes made anywhere in the app show up here." /> : null}
      {days.map((d) => (
        <div key={d.day} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SecHead action={<span style={{ fontSize: 12, color: "var(--mut)" }}>{d.events.length} changes</span>}>{longDay(d.day)}</SecHead>
          <Card pad={false} style={{ overflow: "hidden" }}>
            {d.events.map((e, i) => {
              const isOpen = open === e.id;
              return (
                <div key={e.id} style={{ borderTop: i ? "1px solid var(--bd)" : 0 }}>
                  <button type="button" className="tap row" onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen} style={{ width: "100%", display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", textAlign: "left", background: isOpen ? "var(--s2)" : "transparent", border: 0, color: "inherit" }}>
                    <Avatar text={initials(e.who)} seed={e.who} size={36} />
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span><b>{e.who}</b> · {e.text}</span>
                      <span><Pill tone={AREA_TONES[e.area]}>{tx(AREA_LABELS[e.area])}</Pill></span>
                    </span>
                    <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{clock(e.at)}</span>
                    {e.changes.length ? <Ic n={isOpen ? "chevUp" : "chevDown"} size={18} style={{ color: "var(--mut)" }} /> : <span style={{ width: 18 }} />}
                  </button>
                  {isOpen && e.changes.length ? (
                    <div style={{ padding: "6px 16px 14px 64px", display: "flex", flexDirection: "column", gap: 8 }}>
                      {e.changes.map((c) => (
                        <div key={c.field} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                          <span style={{ width: 140, color: "var(--mut)" }}>{c.field}</span>
                          <span style={{ padding: "2px 8px", borderRadius: 8, background: "var(--bads)", color: "var(--bad)", textDecoration: "line-through" }}>{c.before}</span>
                          <Ic n="arrowRight" size={14} />
                          <span style={{ padding: "2px 8px", borderRadius: 8, background: "var(--oks)", color: "var(--ok)", fontWeight: 600 }}>{c.after}</span>
                        </div>
                      ))}
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{dateLabel(e.at)} · {clock(e.at)}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </Card>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- backups */

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
  const health = backupHealth(data.backups, schoolToday());
  const ready = data.archives.filter((a) => a.status === "ready");
  const [pick, setPick] = useState<string | null>(ready[0]?.id ?? null);
  const closed = data.sessions.filter((s) => s !== data.sessionLabel);
  const [archSession, setArchSession] = useState<string>(closed[0] ?? data.sessionLabel ?? "");
  const [archLabel, setArchLabel] = useState("");
  const max = Math.max(1, ...data.backups.map((b) => b.bytes));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <IconTile icon={health === "ok" ? "checkCircle" : "alert"} tone={health === "ok" ? "ok" : "warn"} size={52} />
        <span style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column" }}>
          <b className="serif" style={{ fontSize: 22 }}>{health === "ok" ? "All backed up" : health === "late" ? "Last night's copy is missing" : "No nightly copy yet"}</b>
          <span style={{ color: "var(--mut)" }}>{data.backups[0] ? `Every night, fee records to storage. Last: ${dateLabel(data.backups[0].day)} · ${bytesLabel(data.backups[0].bytes)}.` : "The nightly backup writes here once its schedule runs."}</span>
        </span>
        <Btn variant="sec" icon="undo" onClick={() => onOpen("restore")}>Restore…</Btn>
        <Btn variant="pri" icon="upload" disabled={pending} onClick={onBackup}>{pending ? "Copying…" : "Back up now"}</Btn>
      </Card>
      <Grid cols={2}>
        <Card>
          <CardHead title="Nightly fee backup" sub="Storage bucket · nightly-backups" badge={<Pill tone={health === "ok" ? "ok" : "warn"}>{health === "ok" ? "Working" : "Check"}</Pill>} />
          <Grid cols={3} style={{ marginTop: 10 }}>
            <Mini l="Last run" v={data.backups[0] ? dateLabel(data.backups[0].day) : "—"} />
            <Mini l="Size" v={bytesLabel(data.backups[0]?.bytes)} />
            <Mini l="Files" v={String(data.backups[0]?.files ?? 0)} />
          </Grid>
        </Card>
        <Card>
          <CardHead title="Sealed archives" sub="Every VPPS One table and document" badge={<Pill tone={ready.length ? "ok" : "mut"}>{ready.length} ready</Pill>} />
          <Grid cols={3} style={{ marginTop: 10 }}>
            <Mini l="Last built" v={data.archives[0] ? dateLabel(data.archives[0].createdAt) : "—"} />
            <Mini l="Size" v={bytesLabel(data.archives[0]?.totalBytes)} />
            <Mini l="Drill" v={data.archives[0]?.lastDrill ? (data.archives[0].lastDrill.ok ? "Passed" : "Failed") : "Not run"} />
          </Grid>
        </Card>
      </Grid>
      <button type="button" className="tap card" onClick={() => onOpen("archive")} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", textAlign: "left", border: "1px solid var(--bd)", color: "var(--fg)" }}>
        <IconTile icon="archive" tone="warn" />
        <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <b>Archive old sessions</b>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{closed.length ? `${closed[0]} can be archived` : "Seal a copy of a session"} · {data.archives.length} archives so far</span>
        </span>
        <Ic n="chevRight" size={18} />
      </button>
      <Card pad={false} style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
          <CardHead title="Last 14 nights" sub="Each copy is kept in storage." />
          <span style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 40 }} aria-hidden="true">
            {[...data.backups].reverse().map((b) => (
              <span key={b.day} style={{ width: 8, borderRadius: 3, height: `${Math.max(12, (b.bytes / max) * 100)}%`, background: "var(--acc)", opacity: 0.6 }} />
            ))}
          </span>
        </div>
        {data.backups.length === 0 ? <EmptyState icon="cloud" title="No copies yet" body="The nightly backup has not written to storage on this deployment." /> : null}
        {data.backups.map((b) => (
          <div key={b.day} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--bd)" }}>
            <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <b>{longDay(b.day)}</b>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>Nightly · {b.files} files</span>
            </span>
            <span className="num" style={{ color: "var(--mut)" }}>{bytesLabel(b.bytes)}</span>
            <Pill tone={b.files ? "ok" : "bad"} icon={b.files ? "check" : "alert"}>{b.files ? "Saved" : "Empty"}</Pill>
          </div>
        ))}
      </Card>

      <Sheet
        open={sheet === "restore"}
        onClose={onClose}
        title="Restore a backup"
        sub="Pick the copy to check."
        icon="undo"
        footer={
          <div style={{ display: "flex", gap: 10 }}>
            <Btn variant="sec" full onClick={onClose}>Not now</Btn>
            <Btn variant="danger" full icon="undo" disabled={!pick || pending} onClick={() => pick && onDrill(pick)}>{pending ? "Checking…" : "Check this copy restores"}</Btn>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="radiogroup">
          {ready.length === 0 ? <EmptyState icon="archive" title="No sealed copy yet" body="Press Back up now to make one." /> : null}
          {ready.slice(0, 8).map((a) => (
            <RadioCard key={a.id} checked={pick === a.id} onSelect={() => setPick(a.id)} title={`${a.label}`} sub={`${dateLabel(a.createdAt)} · ${bytesLabel(a.totalBytes)} · ${a.rowCount ?? 0} rows${a.lastDrill ? ` · last check ${a.lastDrill.ok ? "passed" : "failed"}` : ""}`} />
          ))}
          <Banner tone="warn">This loads the copy into scratch tables and re-checks every file — the live records are not touched. Putting a copy back over live data is done by the developer, with a copy of right now taken first.</Banner>
        </div>
      </Sheet>

      <Sheet
        open={sheet === "archive"}
        onClose={onClose}
        title="Archive a session"
        sub="A sealed, checked copy of everything in it."
        icon="archive"
        footer={
          <div style={{ display: "flex", gap: 10 }}>
            <Btn variant="sec" full onClick={onClose}>Cancel</Btn>
            <Btn variant="pri" full icon="archive" disabled={pending || !archLabel.trim() || !archSession} onClick={() => onArchive(archLabel, archSession)}>{pending ? "Building…" : "Build archive"}</Btn>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Session">
            <ChipRow label="Session">
              {data.sessions.map((s) => (
                <Chip key={s} on={archSession === s} onClick={() => setArchSession(s)}>{s}</Chip>
              ))}
            </ChipRow>
          </Field>
          <Field label="Name">
            <Input value={archLabel} onChange={(e) => setArchLabel(e.target.value)} placeholder={`Session ${archSession} · year end`} />
          </Field>
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

function Mini({ l, v }: { l: string; v: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", padding: "8px 10px", borderRadius: 10, background: "var(--s2)" }}>
      <span style={{ fontSize: 11, color: "var(--mut)" }}>{l}</span>
      <b className="num">{v}</b>
    </span>
  );
}

/* ------------------------------------------------------------- master data */

type MasterTab = "classes" | "subjects" | "houses" | "modes" | "holidays";

function Master({ master }: { master: SettingsData["master"] }) {
  const [tab, setTab] = useState<MasterTab>("classes");
  const tabs: { key: MasterTab; label: string; n: number }[] = [
    { key: "classes", label: "Classes & sections", n: master.classes.length },
    { key: "subjects", label: "Subjects", n: master.subjects.length },
    { key: "houses", label: "Houses", n: master.houses.length },
    { key: "modes", label: "Payment modes", n: master.paymentModes.length },
    { key: "holidays", label: "Holidays", n: master.holidays.length },
  ];
  const editHref: Record<MasterTab, string> = { classes: "/academics/classes", subjects: "/academics/subjects", houses: "/fees/master-data", modes: "/fees/settings", holidays: "/calendar" };
  const rows: { key: string; title: string; sub: string }[] =
    tab === "classes"
      ? master.classes.map((c) => ({ key: c.id, title: c.label, sub: `${c.classTeacher ?? "No class teacher"} · ${c.students} students` }))
      : tab === "subjects"
        ? master.subjects.map((s) => ({ key: s.id, title: s.name, sub: `${s.code}${s.active ? "" : " · turned off"}` }))
        : tab === "houses"
          ? master.houses.map((h) => ({ key: h.name, title: h.name, sub: `${h.students} students` }))
          : tab === "modes"
            ? master.paymentModes.map((m) => ({ key: m.mode, title: m.mode.replace(/_/g, " "), sub: `${m.receipts} receipts` }))
            : master.holidays.map((h) => ({ key: h.day, title: h.label, sub: longDay(h.day) }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ChipRow label="Master data">
        {tabs.map((t) => (
          <Chip key={t.key} on={tab === t.key} count={t.n} onClick={() => setTab(t.key)}>{t.label}</Chip>
        ))}
      </ChipRow>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tab === "classes" ? "In school order. Teachers and strength come from Staff and Students." : "Read here; changed in the screen that owns it."}</span>
        <Btn variant="soft" icon="edit" href={editHref[tab]}>Edit</Btn>
      </div>
      <Card pad={false} style={{ overflow: "hidden" }}>
        {rows.length === 0 ? <EmptyState icon="layers" title="Nothing here yet" /> : null}
        {rows.map((r, i) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
            <span className="num" style={{ width: 24, color: "var(--mut)", fontSize: 13 }}>{i + 1}</span>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", flex: "none" }} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <b className="clip">{r.title}</b>
              <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{r.sub}</span>
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ integrations */

function Integrations({ data }: { data: SettingsData }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ color: "var(--mut)" }}>The outside services VPPS One talks to. Nothing here sends anything to parents.</span>
      <Grid cols={2}>
        {data.integrations.map((i) => (
          <Card key={i.key} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <IconTile icon={i.key === "aisensy" ? "message" : i.key === "sampark" ? "link" : i.key === "backups" ? "cloud" : "clock"} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <b>{i.name}</b>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{i.sub}</span>
              </span>
              <Pill tone={i.status === "on" ? "ok" : i.status === "partial" ? "warn" : "mut"}>{i.status === "on" ? "Connected" : i.status === "partial" ? "Partly set up" : "Not set up"}</Pill>
            </div>
            {i.facts.map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid var(--bd)", paddingTop: 8, fontSize: 13 }}>
                <span style={{ color: "var(--mut)" }}>{l}</span>
                <b style={{ textAlign: "right" }}>{v}</b>
              </div>
            ))}
            {i.href ? <Btn variant="soft" href={i.href}>Open</Btn> : null}
          </Card>
        ))}
      </Grid>
    </div>
  );
}

/* ---------------------------------------------------------------- glossary */

function Glossary() {
  const [q, setQ] = useState("");
  const shown = GLOSSARY.filter((e) => matchesGlossary(e, q));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <SearchBox value={q} onChange={setQ} placeholder="Search a word · शब्द खोजें" />
      <Card pad={false} style={{ overflow: "hidden" }}>
        {shown.length === 0 ? <EmptyState icon="book" title="No such word" /> : null}
        {shown.map((e, i) => (
          <div key={e.term.en} style={{ padding: "12px 16px", borderTop: i ? "1px solid var(--bd)" : 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <b>{e.term.en}</b>
              <b lang="hi" style={{ color: "var(--accfg)" }}>{e.term.hi}</b>
            </span>
            <span style={{ fontSize: 14 }}>{e.meaning.en}</span>
            <span lang="hi" style={{ fontSize: 13, color: "var(--mut)" }}>{e.meaning.hi}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
