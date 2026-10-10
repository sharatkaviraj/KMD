"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Ic } from "@/vx/icons";
import { Bi, useVx } from "@/vx/i18n";
import { clock, dayMonth, greeting, initials, longDay, shortDay } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Avatar, Btn, Card, EmptyState, Pill, Ring, SuccessTick, WhatsAppPreview } from "@/vx/ui/primitives";
import { LangButton } from "@/vx/shell/sidebar";

import { answerCoverVx, noticeSeenVx, queueBirthdayWishVx } from "../actions";
import type { HomeData } from "../data";
import { birthdayWish, periodPhases, type AttentionReason } from "../domain/teach";
import { Head, HelpIcon, HelpSheet, LeaveSheet, useUrlState, type HelpStep } from "./shared";


type SheetKey = "news" | "leave" | "help" | "link" | "wish" | "subs";

const HELP: HelpStep[] = [
  { icon: "calCheck", title: p("Mark attendance first", "पहले हाज़िरी लगाएँ"), body: p("Everyone starts Present. Tap only the children who are absent, then Save.", "सब उपस्थित से शुरू। सिर्फ़ अनुपस्थित बच्चों पर टैप करें, फिर सहेजें।") },
  { icon: "megaphone", title: p("Read the office notices", "ऑफ़िस की सूचनाएँ पढ़ें"), body: p("Tap Got it so the office knows you have seen it.", "ठीक है दबाएँ ताकि ऑफ़िस को पता चले।") },
  { icon: "swap", title: p("Answer a cover quickly", "सब्स्टिट्यूशन का जवाब दें"), body: p("If you are asked to take a class, say I'll take it or I can't.", "अगर कक्षा लेने को कहा जाए तो हाँ या नहीं बताएँ।") },
];

const REASON_TEXT: Record<AttentionReason, Pair> = {
  attendance: p("Attendance below 75%", "उपस्थिति 75% से कम"),
  marks: p("Below 33% in a subject", "किसी विषय में 33% से कम"),
  notes: p("Open notes", "खुले नोट्स"),
};

export function TeachHome({ data, name, initialSheet, school }: { data: HomeData; name: string; initialSheet: string | null; school: string }) {
  const { tx, sub } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useUrlState<SheetKey>("sheet", (initialSheet as SheetKey) ?? null);
  const [wishFor, setWishFor] = useState<string | null>(data.birthdays[0]?.id ?? null);
  const [pending, start] = useTransition();
  const [seen, setSeen] = useState<Set<string>>(() => new Set(data.notices.filter((n) => n.seen).map((n) => n.id)));

  const phases = periodPhases(data.periods, data.nowMinutes);
  const reg = data.myClass?.register ?? null;
  const allTaught = data.periods.length === 0 || phases.every((ph) => ph === "done");
  const later = Boolean(reg) && allTaught && data.schoolOpen;
  const unseen = data.notices.filter((n) => !seen.has(n.id));
  const pinned = unseen[0] ?? data.notices[0] ?? null;

  const gotIt = (ids: string[]) =>
    start(async () => {
      const res = await noticeSeenVx(ids);
      if (res.ok) {
        setSeen((cur) => new Set([...cur, ...ids]));
        toast.show({ text: tx(p("Marked as seen", "देखा गया")) });
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });

  const answer = (id: string, a: "acknowledge" | "cannot_cover") =>
    start(async () => {
      const res = await answerCoverVx(id, a, "");
      if (res.ok) {
        toast.show({ text: tx(a === "acknowledge" ? p("Thank you — you are covering it", "धन्यवाद — आप यह कक्षा लेंगे") : p("The office has been told", "ऑफ़िस को बता दिया गया")) });
        setSheet(null);
        router.refresh();
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });

  const wishKid = data.birthdays.find((b) => b.id === wishFor) ?? null;
  const wishText = wishKid ? birthdayWish({ childName: wishKid.name, school }) : null;
  const sendWish = () =>
    start(async () => {
      if (!wishKid) return;
      const res = await queueBirthdayWishVx(wishKid.id);
      if (res.ok) {
        toast.show({ text: tx(p("Wish queued for the parents", "शुभकामना माता-पिता के लिए कतार में")) });
        setSheet(null);
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });

  const firstName = name.split(/\s+/)[0] ?? name;
  const context = [longDay(data.today), data.myClass ? `${data.myClass.classLabel} ${tx(p("class teacher", "कक्षा अध्यापक"))}` : null].filter(Boolean).join(" · ");

  /* ------------------------------------------------------------ hero */
  const hero = !data.schoolOpen ? (
    <div className="t-hero quiet rise">
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <Ic n="coffee" size={30} />
        <div>
          <strong style={{ fontSize: 20 }}><Bi en="No school today" hi="आज स्कूल बंद है" /></strong>
          <div className="t-heroMut">{tx(p("No register to take. Enjoy the day.", "आज कोई हाज़िरी नहीं। दिन अच्छा बीते।"))}</div>
        </div>
      </div>
    </div>
  ) : !data.myClass ? (
    <div className="t-hero quiet rise">
      <strong style={{ fontSize: 20 }}><Bi en="No class of your own" hi="आपकी अपनी कक्षा नहीं" /></strong>
      <div className="t-heroMut" style={{ marginTop: 4 }}>{tx(p("Class teachers take the register. Your periods are below.", "हाज़िरी कक्षा अध्यापक लेते हैं। आपके पीरियड नीचे हैं।"))}</div>
    </div>
  ) : later ? (
    <div className="t-hero done rise">
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <SuccessTick size={64} tone="#fff" soft="rgba(255,255,255,.18)" />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <strong className="serif" style={{ fontSize: 24 }}>{tx(p("You're all set for today", "आज का सब काम पूरा"))}</strong>
          <span className="t-heroMut">{sub(p("You're all set for today", "आज का सब काम पूरा"))}</span>
        </div>
      </div>
      <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <li style={{ display: "flex", gap: 8, alignItems: "center" }}><Ic n="checkCircle" size={18} /> {tx(p(`Attendance saved at ${reg?.submittedAt ? clock(reg.submittedAt) : "—"}`, `हाज़िरी ${reg?.submittedAt ? clock(reg.submittedAt) : "—"} बजे सहेजी`))}</li>
        <li style={{ display: "flex", gap: 8, alignItems: "center" }}><Ic n="checkCircle" size={18} /> {tx(p(`${data.periods.length} periods taught`, `${data.periods.length} पीरियड पढ़ाए`))}</li>
        <li style={{ display: "flex", gap: 8, alignItems: "center" }}><Ic n={data.followUpsDue ? "flag" : "checkCircle"} size={18} /> {data.followUpsDue ? tx(p(`${data.followUpsDue} follow-ups due`, `${data.followUpsDue} फ़ॉलो-अप बाकी`)) : tx(p("No follow-ups due", "कोई फ़ॉलो-अप बाकी नहीं"))}</li>
      </ul>
    </div>
  ) : reg ? (
    <div className="t-hero done rise">
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <SuccessTick size={56} tone="#fff" soft="rgba(255,255,255,.18)" />
        <div style={{ flex: 1, minWidth: 200 }}>
          <strong style={{ fontSize: 20 }}>{tx(p(`${data.myClass.classLabel} attendance saved`, `${data.myClass.classLabel} की हाज़िरी सहेजी गई`))}</strong>
          <div className="t-heroMut">{tx(p(`${reg.present} present · ${reg.absent} absent${reg.halfDay ? ` · ${reg.halfDay} half-day` : ""}`, `${reg.present} उपस्थित · ${reg.absent} अनुपस्थित`))}{reg.submittedAt ? ` · ${clock(reg.submittedAt)}` : ""}</div>
        </div>
        <Link href={`/teach/attendance?class=${data.myClass.classId}&day=${data.today}`} className="tap t-heroBtn" style={{ height: 48, fontSize: 15 }}>
          <Ic n="eye" size={18} /> {tx(p("See or change", "देखें या बदलें"))}
        </Link>
      </div>
    </div>
  ) : (
    <div className="t-hero rise">
      <div style={{ display: "flex", flexDirection: "column", gap: 6, position: "relative", zIndex: 1 }}>
        <Pill tone="warn" icon="clock" style={{ alignSelf: "flex-start" }}>{tx(p("Not marked yet", "अभी दर्ज नहीं"))}</Pill>
        <strong className="serif" style={{ fontSize: 26, lineHeight: 1.2 }}>{tx(p(`${data.myClass.total} children in ${data.myClass.classLabel} are waiting`, `${data.myClass.classLabel} के ${data.myClass.total} बच्चे इंतज़ार में`))}</strong>
        <span className="t-heroMut">{tx(p("Until you save, the office sees your class as Not marked.", "सहेजने तक ऑफ़िस को आपकी कक्षा 'दर्ज नहीं' दिखेगी।"))}</span>
        <Link href={`/teach/attendance?class=${data.myClass.classId}&day=${data.today}`} className="tap t-heroBtn" style={{ marginTop: 12, width: "100%", maxWidth: 420 }}>
          <Ic n="calCheck" size={22} />
          {tx(p("Mark attendance", "हाज़िरी लगाएँ"))}
          {sub(p("Mark attendance", "हाज़िरी लगाएँ")) ? <span className="hi">{sub(p("Mark attendance", "हाज़िरी लगाएँ"))}</span> : null}
        </Link>
      </div>
    </div>
  );

  /* -------------------------------------------------------- periods */
  const periods = (
    <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Head
        t={p("My periods today", "आज मेरे पीरियड")}
        action={data.periods.length ? <Pill tone="mut">{tx(p(`${data.periods.length} classes${data.covers.length ? ` · ${data.covers.length} cover` : ""}`, `${data.periods.length} कक्षाएँ`))}</Pill> : null}
      />
      {!data.published ? (
        <EmptyState icon="calendar" title={tx(p("The timetable is not published yet", "समय-सारणी अभी प्रकाशित नहीं"))} style={{ padding: 16 }} />
      ) : data.periods.length === 0 && data.covers.length === 0 ? (
        <EmptyState icon="coffee" title={tx(p("No periods today", "आज कोई पीरियड नहीं"))} style={{ padding: 16 }} />
      ) : (
        <div className="t-tl">
          {data.periods.map((per, i) => {
            const ph = phases[i];
            const left = ph === "now" ? Math.max(0, Number(per.ends.slice(0, 2)) * 60 + Number(per.ends.slice(3)) - data.nowMinutes) : 0;
            return (
              <div key={`${per.period}-${per.subjectCode}`} className="t-tlRow">
                <span className="t-tlTime"><b>P{per.number}</b>{per.starts}</span>
                <span className="t-tlRail"><span className={`t-tlDot${ph === "now" ? " now" : ""}`} /></span>
                <div className={`t-tlCard${ph === "done" ? " done" : ph === "now" ? " now" : ""}`}>
                  <Ic n="book" size={18} style={{ color: "var(--mut)" }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong className="clip" style={{ display: "block" }}>{per.classLabel} · {per.subjectCode}</strong>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{per.starts}–{per.ends}{per.combined ? ` · ${tx(p("combined", "संयुक्त"))}` : ""}</span>
                  </span>
                  {ph === "done" ? <Pill tone="mut" icon="check">{tx(p("Done", "हो गया"))}</Pill> : ph === "now" ? <Pill tone="acc">{tx(p(`Now · ${left} min left`, `अभी · ${left} मिनट बाकी`))}</Pill> : ph === "next" ? <Pill tone="info">{tx(p("Next", "अगला"))}</Pill> : null}
                  {per.classId ? (
                    <Link href={`/teach/class?class=${per.classId}`} className="tap icon-btn" aria-label={tx(p("Open class", "कक्षा खोलें"))}><Ic n="chevRight" /></Link>
                  ) : null}
                </div>
              </div>
            );
          })}
          {data.covers.map((c) => (
            <div key={c.id} className="t-tlRow">
              <span className="t-tlTime"><b>P{c.number}</b>{c.starts}</span>
              <span className="t-tlRail"><span className="t-tlDot cover" /></span>
              <div className="t-tlCard cover">
                <Ic n="swap" size={18} style={{ color: "var(--warnfg)" }} />
                <span style={{ flex: 1, minWidth: 160 }}>
                  <strong style={{ display: "block" }}>{c.classLabels} · {c.subjectCode}</strong>
                  <span style={{ fontSize: 12, color: "var(--warnfg)" }}>{tx(p(`Cover for ${c.forName}`, `${c.forName} की जगह`))}</span>
                </span>
                {c.acknowledged ? (
                  <Pill tone="ok" icon="check">{tx(p("You're covering", "आप ले रहे हैं"))}</Pill>
                ) : (
                  <div style={{ display: "flex", gap: 8, width: "100%" }}>
                    <Btn variant="pri" icon="check" disabled={pending} onClick={() => answer(c.id, "acknowledge")} style={{ flex: 1 }}>{tx(p("I'll take it", "मैं लूँगा/लूँगी"))}</Btn>
                    <Btn variant="sec" disabled={pending} onClick={() => answer(c.id, "cannot_cover")} style={{ flex: 1 }}>{tx(p("I can't", "नहीं ले सकता"))}</Btn>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  /* --------------------------------------------------- the office */
  const office = (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Head
        icon="megaphone"
        t={p("From the office", "कार्यालय से")}
        action={data.notices.length ? <button type="button" className="tap btn ghost" onClick={() => setSheet("news")} style={{ color: "var(--accfg)" }}>{tx(p("See all notices", "सभी सूचनाएँ"))} <Ic n="chevRight" size={16} /></button> : null}
      />
      {!pinned ? (
        <span style={{ color: "var(--mut)" }}>{tx(p("No notices from the office.", "ऑफ़िस से कोई सूचना नहीं।"))}</span>
      ) : (
        <div style={{ borderRadius: 16, background: "var(--accs)", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--accfg)", display: "flex", gap: 6, alignItems: "center" }}><Ic n="pin" size={14} /> {pinned.fromName} · {dayMonth(pinned.createdAt)} {clock(pinned.createdAt)}</span>
          <strong className="serif" style={{ fontSize: 19 }}>{pinned.title}</strong>
          <span style={{ color: "var(--mut)", fontSize: 14 }}>{tx({ en: pinned.bodyEn ?? pinned.bodyHi ?? "", hi: pinned.bodyHi ?? undefined })}</span>
          {seen.has(pinned.id) ? (
            <Pill tone="ok" icon="check" style={{ alignSelf: "flex-start" }}>{tx(p("Seen", "देखा"))}</Pill>
          ) : (
            <Btn variant="pri" big icon="check" disabled={pending} onClick={() => gotIt([pinned.id])} style={{ alignSelf: "flex-start" }}>{tx(p("Got it", "ठीक है"))}</Btn>
          )}
        </div>
      )}
      {data.notices.filter((n) => n.id !== pinned?.id).slice(0, 3).map((n) => (
        <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid var(--bd)", paddingTop: 10 }}>
          <span className="t-dot" style={{ background: seen.has(n.id) ? "var(--bds)" : "var(--acc)" }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="clip" style={{ display: "block", fontWeight: 600 }}>{n.title}</span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{shortDay(n.createdAt)}</span>
          </span>
          {seen.has(n.id) ? <Pill tone="ok">{tx(p("Seen", "देखा"))}</Pill> : <Pill tone="acc">{tx(p("New", "नया"))}</Pill>}
        </div>
      ))}
    </Card>
  );

  /* ----------------------------------------------------- quick actions */
  const quick = (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Head t={p("Quick actions", "जल्दी के काम")} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
        {[
          { href: data.myClass ? `/teach/attendance?class=${data.myClass.classId}&day=${data.today}` : "/teach/attendance", icon: "calCheck" as const, t: p("Mark attendance", "हाज़िरी लगाएँ") },
          { href: "/teach/marks", icon: "clipboard" as const, t: p("Enter marks", "अंक भरें") },
          { href: "/teach/notes?sheet=add", icon: "mic" as const, t: p("Speak a note", "नोट बोलें") },
          { onClick: () => setSheet("leave"), icon: "calMinus" as const, t: p("Apply leave", "छुट्टी लें") },
        ].map((a) => {
          const inner = (
            <>
              <span style={{ width: 44, height: 44, borderRadius: 13, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}><Ic n={a.icon} size={22} /></span>
              <Bi en={a.t.en} hi={a.t.hi} />
            </>
          );
          const st = { display: "flex", flexDirection: "column" as const, gap: 10, padding: 14, borderRadius: 16, border: "1px solid var(--bd)", background: "var(--card)", minHeight: 110, fontWeight: 700, color: "var(--fg)", textAlign: "left" as const, font: "inherit" };
          return a.href ? (
            <Link key={a.t.en} href={a.href} className="tap lift" style={st}>{inner}</Link>
          ) : (
            <button key={a.t.en} type="button" className="tap lift" style={st} onClick={a.onClick}>{inner}</button>
          );
        })}
      </div>
    </Card>
  );

  /* ------------------------------------------------- kids who need you */
  const kids = (
    <Card style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Head t={p("Children who need you", "जिन बच्चों को आपकी ज़रूरत है")} action={data.myClass ? <Link href="/teach/class" className="tap btn ghost" style={{ color: "var(--accfg)" }}>{tx(p("My class", "मेरी कक्षा"))}</Link> : null} />
      {data.kids.length === 0 && data.birthdays.length === 0 ? (
        <span style={{ color: "var(--mut)", padding: "8px 0" }}>{tx(p("Nobody needs special attention today.", "आज किसी बच्चे को विशेष ध्यान की ज़रूरत नहीं।"))}</span>
      ) : null}
      {data.kids.map((k) => (
        <Link key={k.id} href={`/teach/class?student=${k.id}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
          <Avatar text={initials(k.name)} seed={k.id} size={40} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong className="clip" style={{ display: "block" }}>{k.name}</strong>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{k.reasons.map((r) => tx(REASON_TEXT[r])).join(" · ")}{k.detail ? ` — ${k.detail}` : ""}</span>
          </span>
          <Ic n="chevRight" size={18} style={{ color: "var(--mut)" }} />
        </Link>
      ))}
      {data.birthdays.map((b) => (
        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
          <span style={{ width: 40, height: 40, borderRadius: 20, background: "var(--warns)", color: "var(--warnfg)", display: "flex", alignItems: "center", justifyContent: "center" }}><Ic n="cake" size={20} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong className="clip" style={{ display: "block" }}>{b.name}</strong>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{b.inDays === 0 ? tx(p(`Birthday today · turns ${b.turning}`, `आज जन्मदिन · ${b.turning} साल`)) : tx(p(`Birthday in ${b.inDays} days`, `${b.inDays} दिन में जन्मदिन`))}</span>
          </span>
          {b.inDays === 0 ? (
            <Btn variant="soft" icon="gift" onClick={() => { setWishFor(b.id); setSheet("wish"); }}>{tx(p("Send wish", "शुभकामना"))}</Btn>
          ) : null}
        </div>
      ))}
    </Card>
  );

  /* ------------------------------------------------------- marks links */
  const links = data.links.length ? (
    <Card style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Head t={p("Your marks links", "आपके अंक लिंक")} action={<Link href="/teach/more?view=links" className="tap btn ghost" style={{ color: "var(--accfg)" }}>{tx(p("All", "सभी"))}</Link>} />
      {data.links.slice(0, 3).map((l) => (
        <button key={l.paperId} type="button" className="row tap" onClick={() => setSheet("link")} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", border: 0, borderTop: "1px solid var(--bd)", background: "transparent", color: "inherit", font: "inherit", textAlign: "left" }}>
          <Ring value={l.entered} max={Math.max(1, l.total)} size={44} stroke={6}>{l.total ? Math.round((l.entered / l.total) * 100) : 0}</Ring>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong className="clip" style={{ display: "block" }}>{l.classLabel} · {l.subjectCode}</strong>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{l.exam} · {tx(p(`${l.entered} of ${l.total} entered`, `${l.total} में से ${l.entered} भरे`))}</span>
          </span>
        </button>
      ))}
    </Card>
  ) : null;

  return (
    <VxPage>
      <TopBar
        crumb={`${tx(p("Teacher", "अध्यापक"))} · ${name} · ${shortDay(data.today)}`}
        title={<Bi en="Today" hi="आज" />}
        actions={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <LangButton tone="page" />
            <Btn icon="help" onClick={() => setSheet("help")}>{tx(p("Help", "मदद"))}</Btn>
            <Btn variant="pri" icon="calMinus" onClick={() => setSheet("leave")}>{tx(p("Apply leave", "छुट्टी लें"))}</Btn>
          </div>
        }
        mTitle={`${tx(p("Today", "आज"))}${sub(p("Today", "आज")) ? ` · ${sub(p("Today", "आज"))}` : ""}`}
        mSub={`${shortDay(data.today)}${data.myClass ? ` · ${data.myClass.classLabel}` : ""}`}
        mAction={
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <LangButton tone="page" />
            <HelpIcon onClick={() => setSheet("help")} label={tx(p("Help", "मदद"))} />
          </div>
        }
      />
      <main>
        <Section>
          <div>
            <h1 className="serif" style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>{greeting()}, {firstName}</h1>
            <span style={{ color: "var(--mut)" }}>{context}</span>
          </div>
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              {hero}
              {periods}
              {kids}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              {office}
              {quick}
              {links}
              {data.otherHeld.length ? (
                <Card>
                  <Head t={p("Your other classes", "आपकी दूसरी कक्षाएँ")} />
                  {data.otherHeld.map((c) => (
                    <Link key={c.classId} href={`/teach/attendance?class=${c.classId}&day=${data.today}`} className="row tap" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
                      <Ic n="calCheck" /> <span style={{ flex: 1 }}>{c.classLabel}</span> <Ic n="chevRight" size={16} />
                    </Link>
                  ))}
                </Card>
              ) : null}
            </div>
          </div>
        </Section>
      </main>

      {/* ---------------------------------------------------- sheets */}
      <Sheet open={sheet === "news"} onClose={() => setSheet(null)} icon="megaphone" title={tx(p("Notices from the office", "ऑफ़िस की सूचनाएँ"))} footer={unseen.length ? <Btn variant="pri" big full icon="ticks" disabled={pending} onClick={() => gotIt(unseen.map((n) => n.id))}>{tx(p("Mark all as seen", "सब देखा गया"))}</Btn> : undefined}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.notices.length === 0 ? <EmptyState icon="megaphone" title={tx(p("No notices", "कोई सूचना नहीं"))} /> : null}
          {data.notices.map((n) => (
            <div key={n.id} className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{n.fromName} · {shortDay(n.createdAt)}</span>
              <strong>{n.title}</strong>
              <span style={{ color: "var(--mut)", fontSize: 14 }}>{tx({ en: n.bodyEn ?? n.bodyHi ?? "", hi: n.bodyHi ?? undefined })}</span>
              {seen.has(n.id) ? <Pill tone="ok" icon="check" style={{ alignSelf: "flex-start" }}>{tx(p("Seen", "देखा"))}</Pill> : <Btn variant="soft" icon="check" disabled={pending} onClick={() => gotIt([n.id])} style={{ alignSelf: "flex-start" }}>{tx(p("Got it", "ठीक है"))}</Btn>}
            </div>
          ))}
        </div>
      </Sheet>

      <LeaveSheet open={sheet === "leave"} onClose={() => setSheet(null)} today={data.today} />
      <HelpSheet open={sheet === "help"} onClose={() => setSheet(null)} title={p("How Today works", "आज का पेज कैसे काम करता है")} steps={HELP} />

      <Sheet open={sheet === "link"} onClose={() => setSheet(null)} icon="link" title={tx(p("Your marks links", "आपके अंक लिंक"))} sub={tx(p("Open a paper to enter marks for it.", "अंक भरने के लिए पेपर खोलें।"))}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.links.length === 0 ? <EmptyState icon="link" title={tx(p("No papers waiting for marks", "कोई पेपर बाकी नहीं"))} /> : null}
          {data.links.map((l) => (
            <div key={l.paperId} className="card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <Ring value={l.entered} max={Math.max(1, l.total)} size={48} stroke={6}>{l.total ? Math.round((l.entered / l.total) * 100) : 0}</Ring>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong className="clip" style={{ display: "block" }}>{l.classLabel} · {l.subjectCode}</strong>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{l.exam} · {tx(p(`${l.entered} of ${l.total}`, `${l.total} में से ${l.entered}`))}</span>
              </span>
              <Btn variant="pri" href={`/teach/marks?paper=${l.paperId}`} icon="edit">{tx(p("Open", "खोलें"))}</Btn>
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={sheet === "wish"}
        onClose={() => setSheet(null)}
        icon="cake"
        title={tx(p("Send a birthday wish", "जन्मदिन की शुभकामना"))}
        sub={tx(p("Queued for the parents. The office sends it after a look.", "माता-पिता के लिए कतार में। ऑफ़िस देखकर भेजेगा।"))}
        footer={wishKid ? <Btn variant="pri" big full icon="send" disabled={pending} onClick={sendWish}>{tx(p("Queue the wish", "शुभकामना कतार में डालें"))}</Btn> : undefined}
      >
        {wishKid && wishText ? (
          <WhatsAppPreview lines={[wishText.hi, "", wishText.en]} count={1} title={tx(p("WhatsApp preview", "व्हाट्सऐप पूर्वावलोकन"))} />
        ) : (
          <EmptyState icon="cake" title={tx(p("No birthdays today", "आज किसी का जन्मदिन नहीं"))} />
        )}
      </Sheet>

      <Sheet open={sheet === "subs"} onClose={() => setSheet(null)} icon="swap" title={tx(p("Cover duty", "सब्स्टिट्यूशन"))}>
        {data.covers.length === 0 ? (
          <EmptyState icon="swap" title={tx(p("No cover duty today", "आज कोई सब्स्टिट्यूशन नहीं"))} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.covers.map((c) => (
              <div key={c.id} className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                <strong>P{c.number} · {c.classLabels} · {c.subjectCode}</strong>
                <span style={{ color: "var(--mut)" }}>{c.starts}–{c.ends} · {tx(p(`Cover for ${c.forName}`, `${c.forName} की जगह`))}</span>
                {c.acknowledged ? <Pill tone="ok" icon="check">{tx(p("You're covering", "आप ले रहे हैं"))}</Pill> : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="pri" big icon="check" disabled={pending} onClick={() => answer(c.id, "acknowledge")} style={{ flex: 1 }}>{tx(p("I'll take it", "मैं लूँगा/लूँगी"))}</Btn>
                    <Btn variant="sec" big disabled={pending} onClick={() => answer(c.id, "cannot_cover")} style={{ flex: 1 }}>{tx(p("I can't", "नहीं ले सकता"))}</Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </VxPage>
  );
}
