"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { logoutAction } from "@/app/login/actions";
import { Ic, type IconName } from "@/vx/icons";
import { Bi, useVx } from "@/vx/i18n";
import { ago, initials, shortDay } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { SwitchRow } from "@/vx/ui/controls";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { useToast } from "@/vx/ui/overlays";
import { Avatar, Btn, Card, EmptyState, Pill, Progress } from "@/vx/ui/primitives";
import { LangButton, ThemeButton } from "@/vx/shell/sidebar";

import { cancelLeaveVx, noticeSeenVx, setAlertVx, setTextSizeVx } from "../actions";
import type { MoreData } from "../data";
import { Head, HelpSheet, LeaveSheet, useUrlState, type HelpStep } from "./shared";

export type MoreView = "menu" | "news" | "links" | "timetable" | "profile";
type SheetKey = "leave" | "help";

const HELP: HelpStep[] = [
  { icon: "megaphone", title: p("Office notices", "ऑफ़िस की सूचनाएँ"), body: p("Everything the office sends to staff. Tap Got it when you have read one.", "ऑफ़िस से आई सब सूचनाएँ। पढ़कर ठीक है दबाएँ।") },
  { icon: "link", title: p("Marks links", "अंक लिंक"), body: p("Each paper you teach. Open it to enter marks, or copy the link.", "आपके हर विषय की परीक्षा। अंक भरने के लिए खोलें।") },
  { icon: "calMinus", title: p("Leave", "छुट्टी"), body: p("Ask for leave here. The admin answers, and you see it in Profile.", "यहाँ छुट्टी माँगें। जवाब प्रोफ़ाइल में दिखेगा।") },
];

const LEAVE_STATUS: Record<string, { text: Pair; tone: "warn" | "ok" | "bad" | "mut" }> = {
  asked: { text: p("Waiting", "प्रतीक्षा में"), tone: "warn" },
  approved: { text: p("Approved", "स्वीकृत"), tone: "ok" },
  declined: { text: p("Declined", "अस्वीकृत"), tone: "bad" },
  cancelled: { text: p("Cancelled", "रद्द"), tone: "mut" },
};

const ALERTS: { key: string; icon: IconName; text: Pair; sub: Pair }[] = [
  { key: "notices", icon: "megaphone", text: p("Office notices", "ऑफ़िस की सूचनाएँ"), sub: p("When the office sends something to staff", "जब ऑफ़िस स्टाफ़ को कुछ भेजे") },
  { key: "cover", icon: "swap", text: p("Cover requests", "सब्स्टिट्यूशन"), sub: p("When you are asked to take a class", "जब आपको कक्षा लेने को कहा जाए") },
  { key: "followups", icon: "flag", text: p("Follow-ups due", "फ़ॉलो-अप"), sub: p("Notes you said you would follow up", "जिन नोट्स पर फ़ॉलो-अप करना है") },
  { key: "marks", icon: "edit", text: p("Marks deadlines", "अंक की अंतिम तिथि"), sub: p("Before marks entry closes", "अंक भरना बंद होने से पहले") },
];

function weekdayName(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }).toLowerCase();
}

export function TeachMore({ data, initialView, initialSheet }: { data: MoreData; initialView: MoreView; initialSheet: string | null }) {
  const { tx, sub } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useUrlState<MoreView>("view", initialView === "menu" ? null : initialView);
  const [sheet, setSheet] = useUrlState<SheetKey>("sheet", (initialSheet as SheetKey) ?? null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set(data.notices.filter((n) => n.seen).map((n) => n.id)));
  const [large, setLarge] = useState(data.profile.largeText);
  const [alerts, setAlerts] = useState<Record<string, boolean>>(data.profile.alerts);
  const [pending, start] = useTransition();
  const current: MoreView = view ?? "menu";
  const unseen = data.notices.filter((n) => !seen.has(n.id)).length;

  const gotIt = (ids: string[]) =>
    start(async () => {
      const res = await noticeSeenVx(ids);
      if (res.ok) setSeen((cur) => new Set([...cur, ...ids]));
      else toast.show({ text: tx(res.error), tone: "bad" });
    });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ text: tx(p("Link copied", "लिंक कॉपी हुआ")) });
    } catch {
      toast.show({ text: tx(p("Could not copy", "कॉपी नहीं हुआ")), tone: "bad" });
    }
  };

  const share = async (title: string, url: string) => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* dismissed: fall through to copy */
      }
    }
    await copy(url);
  };

  const toggleLarge = (on: boolean) =>
    start(async () => {
      setLarge(on);
      const res = await setTextSizeVx(on);
      if (!res.ok) {
        setLarge(!on);
        toast.show({ text: tx(res.error), tone: "bad" });
      } else router.refresh();
    });

  const toggleAlert = (key: string, on: boolean) =>
    start(async () => {
      setAlerts((cur) => ({ ...cur, [key]: on }));
      const res = await setAlertVx(key, on);
      if (!res.ok) {
        setAlerts((cur) => ({ ...cur, [key]: !on }));
        toast.show({ text: tx(res.error), tone: "bad" });
      }
    });

  const cancelLeave = (id: string) =>
    start(async () => {
      const res = await cancelLeaveVx(id);
      if (res.ok) {
        toast.show({ text: tx(p("Leave request cancelled", "छुट्टी का अनुरोध रद्द")) });
        router.refresh();
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });

  const titles: Record<MoreView, Pair> = {
    menu: p("More", "और"),
    news: p("Office notices", "ऑफ़िस की सूचनाएँ"),
    links: p("Marks links", "अंक लिंक"),
    timetable: p("My timetable", "मेरी समय-सारणी"),
    profile: p("My profile", "मेरी प्रोफ़ाइल"),
  };

  const tiles: { key: MoreView | SheetKey; icon: IconName; text: Pair; sub: Pair; badge?: number }[] = [
    { key: "news", icon: "megaphone", text: titles.news, sub: p(`${data.notices.length} notices`, `${data.notices.length} सूचनाएँ`), badge: unseen },
    { key: "links", icon: "link", text: titles.links, sub: p(`${data.links.length} papers`, `${data.links.length} परीक्षाएँ`) },
    { key: "timetable", icon: "calendar", text: titles.timetable, sub: p(`${data.week.length} periods a week`, `हफ़्ते में ${data.week.length} पीरियड`) },
    { key: "leave", icon: "calMinus", text: p("Apply for leave", "छुट्टी के लिए आवेदन"), sub: p("Goes to the admin", "एडमिन को जाएगा") },
    { key: "help", icon: "help", text: p("Help", "मदद"), sub: p("How this app works", "यह ऐप कैसे चलता है") },
    { key: "profile", icon: "user", text: titles.profile, sub: p("Language, text size, alerts", "भाषा, अक्षर का आकार, सूचनाएँ") },
  ];

  const open = (key: MoreView | SheetKey) => {
    if (key === "leave" || key === "help") setSheet(key);
    else setView(key === "menu" ? null : key);
  };

  /* --------------------------------------------------------- timetable */
  const days = [...new Set(data.week.map((w) => w.day))];
  const numbers = [...new Set([...data.periodTimes.map((t) => t.number), ...data.week.map((w) => w.number)])].sort((a, b) => a - b);
  const todayName = weekdayName(data.today);
  const isToday = (d: string) => d.trim().length >= 3 && todayName.startsWith(d.trim().toLowerCase().slice(0, 3));

  return (
    <VxPage label="More" className={large ? "t-large" : undefined}>
      <TopBar
        crumb={current === "menu" ? undefined : tx(p("More", "और"))}
        title={<Bi en={titles[current].en} hi={titles[current].hi} block={false} />}
        mTitle={tx(titles[current])}
        mBack={current === "menu" ? undefined : "/teach/more"}
        actions={current !== "menu" ? <Btn icon="chevLeft" onClick={() => setView(null)}>{tx(p("More", "और"))}</Btn> : undefined}
      />
      <Section>
        {current === "menu" ? (
          <>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Avatar text={initials(data.profile.name)} seed={data.profile.email} size={56} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 18 }}>{data.profile.name}</strong>
                  <div style={{ color: "var(--mut)", fontSize: 13 }}>{data.profile.classes.filter((c) => c.held).map((c) => c.classLabel).join(", ") || data.profile.subjects.join(", ")}</div>
                </div>
              </div>
            </Card>
            <div className="t-menu">
              {tiles.map((t, i) => (
                <button key={t.key} type="button" className="tap t-menuTile rise" style={{ animationDelay: `${i * 40}ms` }} onClick={() => open(t.key)}>
                  {t.badge ? <span className="t-badge num">{t.badge}</span> : null}
                  <span style={{ width: 44, height: 44, borderRadius: 13, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Ic n={t.icon} size={22} />
                  </span>
                  <strong><Bi en={t.text.en} hi={t.text.hi} /></strong>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(t.sub)}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {current === "news" ? (
          data.notices.length === 0 ? (
            <Card><EmptyState icon="megaphone" title={tx(p("No notices yet", "अभी कोई सूचना नहीं"))} /></Card>
          ) : (
            <>
              {unseen > 1 ? (
                <Btn variant="sec" icon="ticks" disabled={pending} onClick={() => gotIt(data.notices.filter((n) => !seen.has(n.id)).map((n) => n.id))} style={{ alignSelf: "flex-start" }}>
                  {tx(p("Mark all as seen", "सब देखा गया"))}
                </Btn>
              ) : null}
              {data.notices.map((n) => (
                <Card key={n.id} style={seen.has(n.id) ? undefined : { borderColor: "var(--acc)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                    <strong style={{ fontSize: 16 }}>{n.title}</strong>
                    {seen.has(n.id) ? <Pill tone="ok" icon="check">{tx(p("Seen", "देखा"))}</Pill> : <Pill tone="info">{tx(p("New", "नया"))}</Pill>}
                  </div>
                  {n.bodyHi ? <p lang="hi" style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{n.bodyHi}</p> : null}
                  {n.bodyEn ? <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", color: n.bodyHi ? "var(--mut)" : undefined }}>{n.bodyEn}</p> : null}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{n.fromName} · {ago(n.createdAt)}</span>
                    {!seen.has(n.id) ? <Btn variant="pri" icon="check" disabled={pending} onClick={() => gotIt([n.id])}>{tx(p("Got it", "ठीक है"))}</Btn> : null}
                  </div>
                </Card>
              ))}
            </>
          )
        ) : null}

        {current === "links" ? (
          data.links.length === 0 ? (
            <Card><EmptyState icon="link" title={tx(p("No papers for your subjects yet", "आपके विषयों की कोई परीक्षा नहीं"))} body={tx(p("Links appear when an exam is set up.", "परीक्षा बनने पर लिंक दिखेंगे।"))} /></Card>
          ) : (
            data.links.map((l) => {
              const href = `/teach/marks?paper=${l.paperId}`;
              const full = typeof window === "undefined" ? href : `${window.location.origin}${href}`;
              return (
                <Card key={l.paperId}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span>
                      <strong>{l.subjectCode} · {l.classLabel}</strong>
                      <div style={{ fontSize: 13, color: "var(--mut)" }}>{l.exam}</div>
                    </span>
                    {l.submitted ? <Pill tone="ok" icon="check">{tx(p("Submitted", "जमा"))}</Pill> : <Pill tone="warn">{tx(p(`${l.entered}/${l.total} entered`, `${l.entered}/${l.total} भरे`))}</Pill>}
                  </div>
                  <Progress value={l.entered} max={Math.max(1, l.total)} style={{ marginTop: 10 }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <Btn variant="pri" icon="edit" href={href}>{tx(p("Open", "खोलें"))}</Btn>
                    <Btn variant="sec" icon="send" onClick={() => void share(`${l.subjectCode} ${l.classLabel}`, full)}>{tx(p("Share", "भेजें"))}</Btn>
                    <Btn variant="sec" icon="copy" onClick={() => void copy(full)}>{tx(p("Copy", "कॉपी"))}</Btn>
                  </div>
                </Card>
              );
            })
          )
        ) : null}

        {current === "timetable" ? (
          data.week.length === 0 ? (
            <Card><EmptyState icon="calendar" title={tx(p("No timetable published yet", "अभी समय-सारणी प्रकाशित नहीं"))} /></Card>
          ) : (
            <Card>
              <div className="t-wk" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(84px,1fr))` }}>
                <span />
                {days.map((d) => (
                  <strong key={d} style={{ fontSize: 13, textAlign: "center", color: isToday(d) ? "var(--acc)" : undefined }}>{d.slice(0, 3)}</strong>
                ))}
                {numbers.map((n) => {
                  const t = data.periodTimes.find((x) => x.number === n);
                  return (
                    <div key={n} style={{ display: "contents" }}>
                      <span style={{ fontSize: 12, color: "var(--mut)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                        <b style={{ color: "var(--fg)" }}>P{n}</b>
                        {t?.starts ?? ""}
                      </span>
                      {days.map((d) => {
                        const slot = data.week.find((w) => w.day === d && w.number === n);
                        return (
                          <span key={d} className={`t-wkCell${slot ? " has" : ""}${slot && isToday(d) ? " today" : ""}`}>
                            {slot ? (
                              <>
                                <b>{slot.subjectCode}</b>
                                <span>{slot.classLabel}</span>
                              </>
                            ) : (
                              <span style={{ color: "var(--sub)" }}>{tx(p("Free", "खाली"))}</span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </Card>
          )
        ) : null}

        {current === "profile" ? (
          <>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Avatar text={initials(data.profile.name)} seed={data.profile.email} size={64} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 20 }}>{data.profile.name}</strong>
                  <div style={{ color: "var(--mut)", fontSize: 13 }}>{data.profile.email}</div>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                {data.profile.classes.map((c) => (
                  <Pill key={c.classId} tone={c.held ? "acc" : "mut"}>{c.held ? tx(p(`Class teacher ${c.classLabel}`, `कक्षा अध्यापक ${c.classLabel}`)) : c.classLabel}</Pill>
                ))}
                {data.profile.subjects.map((s) => <Pill key={s} tone="info">{s}</Pill>)}
              </div>
            </Card>
            <Card>
              <Head t={p("How the app looks", "ऐप कैसा दिखे")} icon="sliders" />
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <Bi en="Language" hi="भाषा" />
                  <LangButton tone="page" />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <Bi en="Light or dark" hi="हल्का या गहरा" />
                  <ThemeButton tone="page" />
                </div>
                <SwitchRow icon="text" title={<Bi en="Large text" hi="बड़े अक्षर" />} sub={tx(p("Bigger letters on every screen", "हर स्क्रीन पर बड़े अक्षर"))} on={large} onChange={toggleLarge} />
              </div>
            </Card>
            <Card>
              <Head t={p("Alerts", "सूचनाएँ")} icon="bell" />
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                {ALERTS.map((a) => (
                  <SwitchRow key={a.key} icon={a.icon} title={<Bi en={a.text.en} hi={a.text.hi} />} sub={tx(a.sub)} on={alerts[a.key] !== false} onChange={(on) => toggleAlert(a.key, on)} />
                ))}
              </div>
            </Card>
            <Card>
              <Head t={p("My leave", "मेरी छुट्टियाँ")} icon="calMinus" action={<Btn variant="sec" icon="plus" onClick={() => setSheet("leave")}>{tx(p("Apply", "आवेदन"))}</Btn>} />
              {data.leave.length === 0 ? (
                <EmptyState icon="calendar" title={tx(p("No leave asked for", "कोई छुट्टी नहीं माँगी"))} />
              ) : (
                <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.leave.map((l) => {
                    const st = LEAVE_STATUS[l.status] ?? LEAVE_STATUS.asked!;
                    return (
                      <li key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--bd)", flexWrap: "wrap" }}>
                        <span style={{ flex: 1, minWidth: 160 }}>
                          <strong>{l.from_day === l.to_day ? shortDay(l.from_day) : `${shortDay(l.from_day)} – ${shortDay(l.to_day)}`}</strong>
                          {l.note ? <div style={{ fontSize: 13, color: "var(--mut)" }}>{l.note}</div> : null}
                        </span>
                        <Pill tone={st.tone}>{tx(st.text)}</Pill>
                        {l.status === "asked" && l.from_day >= data.today ? (
                          <Btn variant="ghost" icon="x" disabled={pending} onClick={() => cancelLeave(l.id)}>{tx(p("Cancel", "रद्द करें"))}</Btn>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <form action={logoutAction}>
              <Btn type="submit" variant="sec" big full icon="logout">
                <Bi en="Sign out" hi="साइन आउट" />
              </Btn>
            </form>
            <p style={{ margin: 0, fontSize: 12, color: "var(--mut)", textAlign: "center" }}>
              {tx(p("Questions? Ask the office.", "कोई सवाल? ऑफ़िस से पूछें।"))} <Link href="/teach">{sub(p("Home", "होम")) || tx(p("Home", "होम"))}</Link>
            </p>
          </>
        ) : null}
      </Section>

      <LeaveSheet open={sheet === "leave"} onClose={() => { setSheet(null); router.refresh(); }} today={data.today} />
      <HelpSheet open={sheet === "help"} onClose={() => setSheet(null)} title={p("Help", "मदद")} steps={HELP} />
    </VxPage>
  );
}
