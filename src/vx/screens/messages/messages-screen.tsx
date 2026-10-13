"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";

import {
  answerReplyAction,
  assignReplyAction,
  cancelNoticeAction,
  createTemplateAction,
  queueNoticeAction,
  resendFailedAction,
  setReplyDoneAction,
  type MessageResult,
} from "@/app/(app)/messages/actions";
import { dayMonth, initials, rupees, schoolToday, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Chip, Input, Seg, Textarea } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { TopBar, VxPage } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";

import type { CampaignView, MessagesData, RecipientView, ReplyView, TemplateView } from "./data";
import { Outbox } from "./outbox";
import type { OutboxData } from "./outbox-data";
import {
  COMPOSE_PROBLEMS,
  composeProblems,
  composeText,
  costPaise,
  countFamilies,
  KIND_ICONS,
  KIND_LABELS,
  KIND_TONES,
  logBucket,
  matchesReply,
  MAX_BODY,
  NOTICE_KINDS,
  paiseToRupees,
  PLACEHOLDERS,
  QUICK_REPLIES,
  quickReplyText,
  TEMPLATE_STATE_LABELS,
  templateSlug,
  templateState,
  type Audience,
  type NoticeKind,
  type NoticeLanguage,
  type ReplyFilter,
} from "./domain/messages";

/*
 * Messages & notices (design `Messages`). Notices are queued one row per
 * family; a family message is never sent by the app — it waits in To send
 * until a person sends it from their own WhatsApp (UI-71, D-10). Drawn as the
 * design: the sent log, delivery, compose with a live phone preview, the
 * outcome, AiSensy templates and parent replies.
 */

export type MessagesView = "sent" | "outbox" | "replies" | "templates";
export type MessagesState = {
  view: MessagesView;
  compose: boolean;
  step: "write" | "preview";
  id: string | null;
  progress: boolean;
  done: boolean;
  sheet: "template-new" | null;
  replyId: string | null;
};

const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000".replace(/0/g, () => Math.floor(Math.random() * 16).toString(16));

function href(next: Partial<MessagesState>): string {
  const qs = new URLSearchParams();
  if (next.view && next.view !== "sent") qs.set("view", next.view);
  if (next.compose) qs.set("compose", "1");
  if (next.compose && next.step === "preview") qs.set("step", "preview");
  if (next.id) qs.set("id", next.id);
  if (next.progress) qs.set("progress", "1");
  if (next.done) qs.set("done", "1");
  if (next.sheet) qs.set("sheet", next.sheet);
  if (next.replyId) qs.set("reply", next.replyId);
  return `/messages${qs.size ? `?${qs}` : ""}`;
}

/* ------------------------------------------------------------- the look */

type Tone = "acc" | "info" | "ok" | "warn" | "mut" | "bad" | "fg";
const TONE: Record<Tone, { bg: string; fg: string }> = {
  acc: { bg: "var(--accs)", fg: "var(--accfg)" },
  info: { bg: "var(--infos)", fg: "var(--info)" },
  ok: { bg: "var(--oks)", fg: "var(--ok)" },
  warn: { bg: "var(--warns)", fg: "var(--warnfg)" },
  mut: { bg: "var(--s3)", fg: "var(--mut)" },
  bad: { bg: "var(--bads)", fg: "var(--bad)" },
  fg: { bg: "var(--s3)", fg: "var(--fg)" },
};
const kindTone = (k: NoticeKind) => TONE[k === "staff" ? "fg" : KIND_TONES[k]];
const AVATAR_TONES: Tone[] = ["acc", "info", "ok", "warn"];
const avatarTone = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TONE[AVATAR_TONES[h % AVATAR_TONES.length]];
};

const CSS = `
.vx .mx-pg{padding:22px 28px 32px}
.vx .mx-kv{font-size:22px;font-weight:700;letter-spacing:-.01em}
.vx .mx-row{width:100%;display:flex;align-items:center;gap:12px;padding:12px 16px;border:0;border-top:1px solid var(--bd);background:transparent;color:var(--fg);text-align:left;animation:xIn .32s var(--ease) both}
.vx .mx-wa{background:var(--wabg);border-radius:16px;padding:14px 12px;display:flex;flex-direction:column;gap:8px}
.vx .mx-bu{max-width:92%;margin-left:auto;background:var(--wab);color:var(--wafg);border-radius:14px 4px 14px 14px;padding:9px 11px 5px;font-size:13.5px;line-height:1.5;box-shadow:0 1px 1px rgba(0,0,0,.1);animation:xIn .3s var(--ease) both;white-space:pre-line;overflow-wrap:anywhere}
.vx .mx-bu>*+*{margin-top:7px}
.vx .mx-in{margin-left:0;margin-right:auto;background:var(--card);color:var(--fg);border-radius:4px 14px 14px 14px}
.vx .mx-tm{display:flex;justify-content:flex-end;align-items:center;gap:3px;font-size:11px;opacity:.75;margin-top:2px!important}
.vx .mx-ph{width:320px;margin:0 auto;border-radius:34px;border:8px solid var(--fg);overflow:hidden;background:var(--wabg);box-shadow:var(--shh)}
:where(.vx,.vxt) .mx-sw{display:flex;align-items:center;gap:12px;min-height:54px;width:100%;padding:8px 14px;border-radius:14px;border:1px solid var(--bd);background:var(--card);color:var(--fg);text-align:left}
.vx .mx-row.sel{background:var(--accs)}
.vx-layer .mx-tsheet{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:16px;align-items:start}
.vx-layer .mx-cat{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@media (max-width:899px){.vx-layer .mx-tsheet,.vx-layer .mx-cat{grid-template-columns:minmax(0,1fr)}.vx-layer .mx-tips{order:2}}
.vx .mx-bar{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--s3);max-width:240px}
.vx .mx-bar>span{height:6px;transform-origin:left;animation:xGrowX .6s var(--ease) both}
.vx .mx-sb{position:sticky;bottom:0;z-index:3;padding:10px 16px;border-top:1px solid var(--bd)}
@container vx (max-width:899px){
 .vx .mx-pg{padding-top:16px}.vx .mx-kv{font-size:19px}.vx .mx-row{padding:12px 14px}
 .vx .mx-ph{width:100%;border-width:0;border-radius:18px;box-shadow:none}
 .vx .mx-sb{bottom:calc(76px + env(safe-area-inset-bottom));z-index:45}
 .vx .mx-first{order:-1}
 .vx .mx-tabs .seg>button{white-space:nowrap;padding:0 4px!important;font-size:12.5px;letter-spacing:-.01em}
}
`;

const m12: CSSProperties = { fontSize: 12, color: "var(--mut)" };
const m13: CSSProperties = { fontSize: 13, color: "var(--mut)" };
const t14: CSSProperties = { fontSize: 14, fontWeight: 600 };
const h15: CSSProperties = { fontSize: 15, fontWeight: 700 };
const serif22: CSSProperties = { fontFamily: "var(--font-display),'Source Serif 4',Georgia,serif", fontSize: 22, fontWeight: 600, lineHeight: 1.2 };
const card: CSSProperties = { background: "var(--card)", border: "1px solid var(--bd)", borderRadius: 18, boxShadow: "var(--sh)" };
const box: CSSProperties = { ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 };

/** "Tue 6 Oct", as the design writes a day. */
const day3 = (value: string | Date) => shortDay(value).replace(",", "");
/** "10:00 am", as the design writes a time. */
const ampm = (value: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value)).toLowerCase();
const when = (value: string) => `${day3(value)}, ${ampm(value)}`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const SIGNATURE = "— श्री वीर पत्ता सी. सै. स्कूल, आमेट";

function Tile({ icon, tone, size = 40, radius = 12 }: { icon: IconName; tone: { bg: string; fg: string }; size?: number; radius?: number }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size, height: size, borderRadius: radius, background: tone.bg, color: tone.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Ic n={icon} size={18} />
    </span>
  );
}

function Face({ name, size = 38 }: { name: string; size?: number }) {
  const tone = avatarTone(name);
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size, height: size, borderRadius: size / 2, background: tone.bg, color: tone.fg, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {initials(name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, ""))}
    </span>
  );
}

const sech = (left: ReactNode, right?: ReactNode) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
    <span className="sech">{left}</span>
    {right}
  </div>
);

/** The school's outgoing WhatsApp bubble: Hindi first, then English, the signature and the time. */
function Bubble({ title, lines, time, ticks = true, style }: { title?: string; lines: string[]; time?: string; ticks?: boolean; style?: CSSProperties }) {
  return (
    <div className="mx-bu" style={style}>
      {title ? <b style={{ display: "block" }}>{title}</b> : null}
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      <div style={{ fontSize: 12, opacity: 0.75 }}>{SIGNATURE}</div>
      {time ? (
        <div className="mx-tm">
          {time}
          {ticks ? <Ic n="ticks" size={15} style={{ color: "var(--info)" }} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The design's phone: a business-account header, the chat, the Okay reply. */
function PhonePreview({ title, lines }: { title: string; lines: string[] }) {
  const { tx } = useVx();
  return (
    <div className="mx-ph" aria-label={tx(p("WhatsApp preview", "व्हाट्सऐप झलक"))}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--pri)", color: "var(--prifg)" }}>
        <span className="serif" aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 16, background: "var(--prifg)", color: "var(--pri)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>VP</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Shri Veer Patta School</span>
          <span style={{ fontSize: 11, opacity: 0.8 }}>Business account</span>
        </span>
      </div>
      <div className="mx-wa" style={{ borderRadius: 0, minHeight: 300, padding: "16px 10px" }}>
        <span className="pill" style={{ alignSelf: "center", background: "var(--card)", color: "var(--mut)" }}>{tx(p("Today", "आज"))}</span>
        <Bubble title={title} lines={lines} time={ampm(new Date().toISOString())} ticks={false} style={{ maxWidth: "96%" }} />
        <span className="pill" style={{ alignSelf: "flex-end", height: 34, padding: "0 16px", fontSize: 13, background: "var(--card)", color: "var(--acc)" }}>ठीक है · Okay</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ screen */

export function MessagesScreen({ data, state, outbox, outboxCount, draft }: { data: MessagesData; state: MessagesState; outbox: OutboxData | null; outboxCount: number; /** A filled-in notice, for the design fixture only; the page never passes it. */ draft?: { title: string; hi: string; en: string } }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const go = (next: Partial<MessagesState>) => router.push(href(next), { scroll: true });
  const done = (result: MessageResult, after?: () => void) => {
    toast.show({ text: tx(result.message), tone: result.ok ? "ok" : "bad" });
    if (result.ok) {
      after?.();
      router.refresh();
    }
  };

  const openReplies = data.replies.filter((r) => r.status === "open").length;

  const tabs = (
    <Seg<MessagesView>
      label={tx(p("Messages view", "संदेश"))}
      value={state.view}
      onChange={(v) => go({ view: v })}
      options={[
        { value: "sent", label: tx(p("Sent", "भेजे गए")) },
        { value: "outbox", label: `${tx(p("To send", "भेजने को"))}${outboxCount ? ` · ${outboxCount}` : ""}` },
        { value: "replies", label: `${tx(p("Replies", "जवाब"))}${openReplies ? ` · ${openReplies}` : ""}` },
        { value: "templates", label: tx(p("Templates", "टेम्पलेट")) },
      ]}
    />
  );

  if (state.compose) {
    return <Compose data={data} draft={draft} preview={state.step === "preview"} onStep={(step) => go({ compose: true, step })} pending={pending} start={start} onQueued={(id) => router.push(href({ id, done: true }))} />;
  }

  const detail = state.id ? data.detail : null;
  if (detail && (state.done || state.progress)) {
    return <Outcome campaign={detail.campaign} done={state.done} parentDispatchOn={data.parentDispatchOn} pending={pending} onStop={() => start(async () => done(await cancelNoticeAction(detail.campaign.id)))} />;
  }
  if (detail) {
    return <Detail campaign={detail.campaign} recipients={detail.recipients} pending={pending} onResend={() => start(async () => done(await resendFailedAction(detail.campaign.id)))} onStop={() => start(async () => done(await cancelNoticeAction(detail.campaign.id)))} />;
  }

  const mSub =
    state.view === "replies"
      ? tx(p(`${openReplies} waiting`, `${openReplies} प्रतीक्षा में`))
      : state.view === "templates"
        ? tx(p("AiSensy · WhatsApp approval", "AiSensy · व्हाट्सऐप स्वीकृति"))
        : state.view === "outbox"
          ? tx(p("Sent by hand from your WhatsApp", "आपके व्हाट्सऐप से हाथ से भेजे जाते हैं"))
          : tx(p("WhatsApp through AiSensy", "AiSensy से व्हाट्सऐप"));

  const header = (
    <TopBar
      crumb={tx(p("System · WhatsApp (AiSensy)", "सिस्टम · व्हाट्सऐप (AiSensy)"))}
      title={tx(p("Messages", "संदेश"))}
      mSub={mSub}
      mBack="/menu"
      actions={
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 460 }}>{tabs}</div>
          <Btn variant="pri" icon="plus" href={href({ compose: true })}>{tx(p("New notice", "नई सूचना"))}</Btn>
          <HelpButton
            title={tx(p("Messages", "संदेश"))}
            steps={[
              { icon: "megaphone", title: tx(p("Write once", "एक बार लिखें")), body: tx(p("Every family gets its own copy with their name and child filled in. Siblings share one message.", "हर परिवार को अपने नाम और बच्चे के साथ अपनी प्रति मिलती है। भाई-बहनों का एक संदेश।")) },
              { icon: "send", title: tx(p("You press send", "भेजते आप हैं")), body: tx(p("Family messages wait in To send. Each one opens your WhatsApp with the text filled in, and is marked sent by you. Nothing reaches a parent by accident.", "परिवारों के संदेश ‘भेजने को’ में रहते हैं। हर एक आपके व्हाट्सऐप में भरा हुआ खुलता है और आप उसे भेजा हुआ दर्ज करते हैं।")) },
              { icon: "rupee", title: tx(p("Cost", "ख़र्च")), body: tx(p("AiSensy charges about ₹0.88 a message. The cost is shown before you queue.", "AiSensy लगभग ₹0.88 प्रति संदेश लेता है। कतार से पहले ख़र्च दिखता है।")) },
            ]}
          />
        </span>
      }
      mAction={
        <Link href={href({ compose: true })} className="tap btn pri" aria-label={tx(p("New notice", "नई सूचना"))} style={{ width: 44, height: 44, padding: 0, borderRadius: 22 }}>
          <Ic n="plus" size={22} />
        </Link>
      }
    />
  );

  const phoneTabs = <div className="only-m mx-tabs" style={{ padding: "14px 16px 0" }}>{tabs}</div>;

  return (
    <VxPage>
      <style>{CSS}</style>
      {header}
      <main>
        {state.view === "sent" ? (
          <>
            {phoneTabs}
            <SentLog data={data} outboxCount={outboxCount} />
          </>
        ) : null}
        {state.view === "outbox" && outbox ? <Outbox data={outbox} tabs={tabs} /> : null}
        {state.view === "templates" ? (
          <Templates templates={data.templates} tabs={phoneTabs} onNew={() => go({ view: "templates", sheet: "template-new" })} />
        ) : null}
        {state.view === "replies" ? (
          <Replies
            replies={data.replies}
            staff={data.staffChoices}
            tabs={phoneTabs}
            selectedId={state.replyId}
            pending={pending}
            onSelect={(id) => router.replace(href({ view: "replies", replyId: id }), { scroll: false })}
            onAnswer={(replyId, body, after) => start(async () => done(await answerReplyAction({ replyId, body }), after))}
            onAssign={(replyId, staffId) => start(async () => done(await assignReplyAction({ replyId, staffId })))}
            onDone={(replyId, isDone) => start(async () => done(await setReplyDoneAction({ replyId, done: isDone })))}
          />
        ) : null}
      </main>
      <TemplateSheet
        open={state.sheet === "template-new"}
        onClose={() => go({ view: "templates" })}
        pending={pending}
        onSave={(input) => start(async () => done(await createTemplateAction(input), () => go({ view: "templates" })))}
      />
    </VxPage>
  );
}

/* ------------------------------------------------------------ the sent log */

function SentLog({ data, outboxCount }: { data: MessagesData; outboxCount: number }) {
  const { tx } = useVx();
  const [kind, setKind] = useState<NoticeKind | "all">("all");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = data.campaigns.filter((c) => (kind === "all" || c.kind === kind) && (!q || c.title.toLowerCase().includes(q) || c.audienceLabel.toLowerCase().includes(q)));
  const week = shown.filter((c) => logBucket(c.createdAt) === "week");
  const earlier = shown.filter((c) => logBucket(c.createdAt) === "earlier");

  const kpis: { label: Pair; value: string; sub: ReactNode; color?: string }[] = [
    { label: p("Sent this month", "इस महीने भेजे"), value: data.month.sent.toLocaleString("en-IN"), sub: tx(p(`of ${data.month.count.toLocaleString("en-IN")} queued · one per family`, `${data.month.count.toLocaleString("en-IN")} में से · हर परिवार को एक`)) },
    {
      label: p("Waiting to send", "भेजने बाकी"),
      value: data.month.queued.toLocaleString("en-IN"),
      color: data.month.queued ? "var(--warnfg)" : "var(--ok)",
      sub: (
        <>
          <span className="clip" style={m12}>{tx(data.parentDispatchOn ? p("in the WhatsApp queue", "व्हाट्सऐप कतार में") : p("sent by hand from To send", "‘भेजने को’ से हाथ से"))}</span>
          {outboxCount ? <Link href={href({ view: "outbox" })} style={{ color: "var(--acc)", fontSize: 12, fontWeight: 700, flex: "none" }}>{tx(p("Open", "खोलें"))}</Link> : null}
        </>
      ),
    },
    { label: p("Cost this month", "इस महीने का ख़र्च"), value: rupees(Math.round(paiseToRupees(data.month.costPaise))), sub: tx(p("₹0.88 a message", "₹0.88 प्रति संदेश")) },
    { label: p("Parent sending", "अभिभावकों को भेजना"), value: tx(data.parentDispatchOn ? p("On", "चालू") : p("By hand", "हाथ से")), color: "var(--acc)", sub: tx(data.parentDispatchOn ? p("pressed by a person", "कोई व्यक्ति दबाता है") : p("nothing goes by itself", "अपने-आप कुछ नहीं जाता")) },
  ];

  return (
    <div className="pad mx-pg" style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
        {kpis.map((k, i) => (
          <div key={k.label.en} className="card rise" style={{ padding: "14px 16px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2, animationDelay: `${i * 40}ms` }}>
            <span style={{ ...m12, fontWeight: 600 }}>{tx(k.label)}</span>
            <span className="num mx-kv" style={{ color: k.color ?? "var(--fg)" }}>{k.value}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>{typeof k.sub === "string" ? <span className="clip" style={m12}>{k.sub}</span> : k.sub}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="hs" role="group" aria-label={tx(p("Kind", "प्रकार"))} style={{ flex: 1, minWidth: 0, display: "flex", gap: 6 }}>
          <button type="button" className={`tap chip${kind === "all" ? " on" : ""}`} aria-pressed={kind === "all"} onClick={() => setKind("all")}>
            {tx(p("All", "सब"))}
            <span className="num" style={{ opacity: 0.65, fontSize: 11 }}>{data.campaigns.length}</span>
          </button>
          {NOTICE_KINDS.map((k) => (
            <button key={k} type="button" className={`tap chip${kind === k ? " on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {tx(KIND_LABELS[k])}
              <span className="num" style={{ opacity: 0.65, fontSize: 11 }}>{data.campaigns.filter((c) => c.kind === k).length}</span>
            </button>
          ))}
        </div>
        <label className="only-d" style={{ display: "flex", alignItems: "center", gap: 8, height: 38, width: 240, borderRadius: 12, border: "1px solid var(--bd)", background: "var(--card)", padding: "0 12px", color: "var(--mut)" }}>
          <Ic n="search" size={18} />
          <span className="sr">{tx(p("Search messages", "संदेश खोजें"))}</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx(p("Search messages", "संदेश खोजें"))} style={{ flex: 1, minWidth: 0, height: 34, border: 0, outline: "none", background: "transparent", fontSize: 14 }} />
        </label>
      </div>
      {week.length ? <LogGroup title={p("This week", "इस हफ़्ते")} rows={week} /> : null}
      {earlier.length ? <LogGroup title={p("Earlier", "पहले")} rows={earlier} /> : null}
      {shown.length === 0 ? (
        <div className="card fadein" style={{ padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span style={h15}>{data.campaigns.length ? tx(p("No messages match", "कोई संदेश नहीं मिला")) : tx(p("No notices yet", "अभी कोई सूचना नहीं"))}</span>
          {data.campaigns.length ? (
            <Btn variant="sec" onClick={() => { setKind("all"); setQuery(""); }}>{tx(p("Show all", "सब दिखाएँ"))}</Btn>
          ) : (
            <Btn variant="pri" icon="plus" href={href({ compose: true })}>{tx(p("New notice", "नई सूचना"))}</Btn>
          )}
        </div>
      ) : null}
    </div>
  );
}

function LogGroup({ title, rows }: { title: Pair; rows: CampaignView[] }) {
  const { tx } = useVx();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {sech(tx(title), <span className="num" style={{ ...m12, fontWeight: 700 }}>{tx(p(`${rows.length} ${rows.length === 1 ? "message" : "messages"}`, `${rows.length} संदेश`))}</span>)}
      <div className="card" style={{ overflow: "hidden" }}>
        {rows.map((c, i) => (
          <CampaignRow key={c.id} c={c} first={i === 0} delay={i * 28} />
        ))}
      </div>
    </div>
  );
}

function statusLine(c: CampaignView): { text: Pair; tone: string } {
  if (c.status === "cancelled") return { text: p("Stopped", "रोका गया"), tone: "var(--mut)" };
  if (c.counts.failed) return { text: p(`${c.counts.failed} failed`, `${c.counts.failed} नहीं पहुँचे`), tone: "var(--bad)" };
  if (c.counts.queued) return { text: p(`${c.counts.queued} to send`, `${c.counts.queued} भेजने बाकी`), tone: "var(--warnfg)" };
  return { text: p("All sent", "सब भेजे गए"), tone: "var(--ok)" };
}

function CampaignRow({ c, first, delay }: { c: CampaignView; first: boolean; delay: number }) {
  const { tx } = useVx();
  const status = statusLine(c);
  const tone = kindTone(c.kind);
  const total = Math.max(1, c.counts.total);
  return (
    <Link href={href({ id: c.id })} className="tap row mx-row" style={{ borderTop: first ? 0 : "1px solid var(--bd)", animationDelay: `${delay}ms` }}>
      <Tile icon={KIND_ICONS[c.kind]} tone={tone} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="clip" style={t14}>{c.title}</span>
        <span className="clip" style={m12}>{c.audienceLabel} · {c.recipientCount} · {when(c.createdAt)}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mx-bar" style={{ flex: 1 }}>
            <span style={{ width: `${(c.counts.sent / total) * 100}%`, background: "var(--ok)" }} />
            <span style={{ width: `${(c.counts.queued / total) * 100}%`, background: "var(--okm)", animationDelay: ".1s" }} />
            <span style={{ width: `${(c.counts.failed / total) * 100}%`, background: "var(--bad)", animationDelay: ".2s" }} />
          </span>
          <span className="num" style={{ ...m12, flex: "none" }}>{tx(p(`${pct(c.counts.sent, c.counts.total)}% sent`, `${pct(c.counts.sent, c.counts.total)}% भेजे`))}</span>
        </span>
      </span>
      <span className="pill hide-m" style={{ background: tone.bg, color: tone.fg }}>{tx(KIND_LABELS[c.kind])}</span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flex: "none" }}>
        <span className="num" style={t14}>{rupees(Math.round(paiseToRupees(c.costPaise)))}</span>
        <span style={{ fontSize: 12, color: status.tone }}>{tx(status.text)}</span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ detail */

type RecipientFilter = "all" | "sent" | "queued" | "failed";

function Detail({ campaign: c, recipients, pending, onResend, onStop }: { campaign: CampaignView; recipients: RecipientView[]; pending: boolean; onResend: () => void; onStop: () => void }) {
  const { tx } = useVx();
  const [filter, setFilter] = useState<RecipientFilter>("all");
  const [limit, setLimit] = useState(50);
  const match = (r: RecipientView) => filter === "all" || (filter === "queued" ? r.status === "queued" || r.status === "draft" : r.status === filter);
  const shown = recipients.filter(match);
  const lines = [c.bodyHi, c.bodyEn].filter(Boolean).map((l) => l.replace(/^\*[^*]+\*\n/, ""));
  const total = Math.max(1, c.counts.total);
  const tone = kindTone(c.kind);
  const funnel: [Pair, number, string][] = [
    [p("Queued", "कतार में डाले"), c.counts.total, "var(--pri)"],
    [p("Sent", "भेजे गए"), c.counts.sent, "var(--ok)"],
    [p("Waiting to send", "भेजने बाकी"), c.counts.queued, "var(--c3)"],
    [p("Not delivered", "नहीं पहुँचे"), c.counts.failed, "var(--bad)"],
    ...(c.counts.cancelled ? ([[p("Stopped", "रोके गए"), c.counts.cancelled, "var(--mut)"]] as [Pair, number, string][]) : []),
  ];
  const chips: { key: RecipientFilter; icon: IconName; color: string; label: Pair; n: number }[] = [
    { key: "all", icon: "users", color: "inherit", label: p("All", "सब"), n: recipients.length },
    { key: "sent", icon: "check", color: "var(--ok)", label: p("Sent", "भेजे"), n: c.counts.sent },
    { key: "queued", icon: "clock", color: "var(--warn)", label: p("Waiting", "बाकी"), n: c.counts.queued },
    { key: "failed", icon: "alert", color: "var(--bad)", label: p("Not delivered", "नहीं पहुँचे"), n: c.counts.failed },
  ];

  return (
    <VxPage>
      <style>{CSS}</style>
      <TopBar crumb={tx(p("Messages", "संदेश"))} title={c.title} mSub={when(c.createdAt)} mBack="/messages" actions={<Btn variant="ghost" icon="chevLeft" href="/messages">{tx(p("Back to messages", "संदेशों पर वापस"))}</Btn>} />
      <main>
        <div className="pad mx-pg">
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", gap: 18, alignItems: "start", maxWidth: 1180 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <div style={box}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: tone.bg, color: tone.fg }}>
                    <Ic n={KIND_ICONS[c.kind]} size={14} />
                    {tx(KIND_LABELS[c.kind])}
                  </span>
                  <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--s3)", color: "var(--mut)" }}>{when(c.createdAt)}</span>
                  {c.status === "cancelled" ? <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--bads)", color: "var(--bad)" }}>{tx(p("Stopped", "रोका गया"))}</span> : null}
                </div>
                <span style={{ ...serif22, fontSize: 24 }}>{c.title}</span>
                <span style={m13}>{c.audienceLabel} · {c.recipientCount} {tx(p("people", "लोग"))}{c.createdBy ? ` · ${tx(p("by", "द्वारा"))} ${c.createdBy}` : ""}</span>
                <div className="mx-wa">
                  <Bubble lines={lines} time={ampm(c.createdAt)} ticks={false} />
                </div>
              </div>
              <div style={box}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={h15}>{tx(p("Delivery", "पहुँच"))}</span>
                  <span style={m12}>{rupees(Math.round(paiseToRupees(c.costPaise)))} · ₹0.88 {tx(p("each", "हर एक"))}</span>
                </div>
                {funnel.map(([label, n, color], i) => (
                  <div key={label.en} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={t14}>{tx(label)}</span>
                      <span className="num"><b>{n}</b><span style={m12}> · {pct(n, total)}%</span></span>
                    </div>
                    <div style={{ height: 10, borderRadius: 5, background: "var(--s3)", overflow: "hidden" }}>
                      <div style={{ height: 10, width: `${pct(n, total)}%`, background: color, borderRadius: 5, transformOrigin: "left", animation: `xGrowX .7s var(--ease) ${i * 80}ms both` }} />
                    </div>
                  </div>
                ))}
                <span style={m12}>{tx(p("Read receipts are not tracked: family messages are sent by hand from To send.", "पढ़ने की जानकारी नहीं रखी जाती: परिवारों के संदेश ‘भेजने को’ से हाथ से भेजे जाते हैं।"))}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                  {c.counts.failed > 0 ? (
                    <button type="button" className="tap btn sec mfull" disabled={pending} onClick={onResend} style={{ color: "var(--bad)" }}>
                      <Ic n="refresh" size={18} />
                      {tx(p(`Resend to ${c.counts.failed} not delivered`, `${c.counts.failed} को फिर भेजें`))}
                    </button>
                  ) : null}
                  {c.counts.queued > 0 && c.status !== "cancelled" ? (
                    <Btn variant="soft" icon="x" disabled={pending} onClick={onStop}>{tx(p(`Stop ${c.counts.queued} waiting`, `${c.counts.queued} रोकें`))}</Btn>
                  ) : null}
                  <Btn variant="soft" icon="activity" href={href({ id: c.id, progress: true })}>{tx(p("Progress", "प्रगति"))}</Btn>
                </div>
              </div>
            </div>
            <div className="card" style={{ overflow: "hidden", minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={h15}>{tx(p("Who got it", "किसे मिला"))}</span>
                  <span style={m12}>{tx(p(`Showing ${Math.min(limit, shown.length)} of ${shown.length}`, `${shown.length} में से ${Math.min(limit, shown.length)}`))}</span>
                </div>
                <div className="hs" role="group" aria-label={tx(p("Delivery filter", "पहुँच"))} style={{ display: "flex", gap: 6 }}>
                  {chips.map((ch) => (
                    <button key={ch.key} type="button" className={`tap chip${filter === ch.key ? " on" : ""}`} aria-pressed={filter === ch.key} onClick={() => setFilter(ch.key)}>
                      <Ic n={ch.icon} size={15} style={{ color: filter === ch.key ? "inherit" : ch.color }} />
                      {tx(ch.label)}
                      <span className="num" style={{ opacity: 0.7, fontSize: 11 }}>{ch.n}</span>
                    </button>
                  ))}
                </div>
              </div>
              {shown.length === 0 ? <div style={{ padding: "24px 16px", borderTop: "1px solid var(--bd)", ...m13 }}>{tx(p("Nobody here. Pick another filter.", "यहाँ कोई नहीं। दूसरा चुनें।"))}</div> : null}
              {shown.slice(0, limit).map((r, i) => (
                <div key={r.id} className="mx-row" style={{ cursor: "default", animationDelay: `${Math.min(i, 14) * 28}ms` }}>
                  <Face name={r.name} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span className="clip" style={t14}>{r.name}</span>
                    <span className="clip num" style={m12}>{[r.about, r.phone].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flex: "none" }}>
                    {r.status === "sent" ? <Ic n="check" size={18} style={{ color: "var(--ok)" }} /> : r.status === "failed" ? <Ic n="alert" size={18} style={{ color: "var(--bad)" }} /> : r.status === "cancelled" ? <Ic n="x" size={18} style={{ color: "var(--mut)" }} /> : <Ic n="clock" size={18} style={{ color: "var(--mut)" }} />}
                    <span style={{ ...m12, color: r.status === "failed" ? "var(--bad)" : "var(--mut)" }}>{r.status === "failed" ? (r.error ?? tx(p("Not delivered", "नहीं पहुँचा"))) : r.status === "sent" ? ampm(r.at) : r.status === "cancelled" ? tx(p("Stopped", "रोका")) : tx(p("Waiting", "बाकी"))}</span>
                  </span>
                </div>
              ))}
              {shown.length > limit ? (
                <div style={{ padding: 12, display: "flex", justifyContent: "center", borderTop: "1px solid var(--bd)" }}>
                  <Btn variant="ghost" onClick={() => setLimit((n) => n + 100)}>{tx(p("Show more", "और दिखाएँ"))}</Btn>
                </div>
              ) : null}
              <div style={{ ...m12, padding: "12px 16px", borderTop: "1px solid var(--bd)" }}>
                {tx(p("clock waiting · ✓ sent · ", "घड़ी बाकी · ✓ भेजा · "))}
                <span style={{ color: "var(--bad)", fontWeight: 700 }}>!</span>
                {tx(p(" not delivered", " नहीं पहुँचा"))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </VxPage>
  );
}

/* ----------------------------------------------------------- after queuing */

function Outcome({ campaign: c, done, parentDispatchOn, pending, onStop }: { campaign: CampaignView; done: boolean; parentDispatchOn: boolean; pending: boolean; onStop: () => void }) {
  const { tx } = useVx();
  const total = Math.max(1, c.counts.total);
  const sentPct = pct(c.counts.sent, total);
  const family = c.audience !== "staff";
  const waitingByHand = family && !parentDispatchOn;
  const line = c.status === "cancelled" ? p("Stopped", "रोका गया") : c.counts.queued ? (waitingByHand ? p("Waiting in To send", "‘भेजने को’ में प्रतीक्षा") : p("Sending through AiSensy", "AiSensy से जा रहा है")) : p("Done", "पूरा");
  const counts: [Pair, number, string][] = [
    [p(`Sent of ${c.counts.total}`, `${c.counts.total} में से भेजे`), c.counts.sent, "var(--fg)"],
    [p("Waiting", "बाकी"), c.counts.queued, "var(--ok)"],
    [p("Failed", "नहीं पहुँचे"), c.counts.failed, "var(--bad)"],
  ];
  const audience = tx(family ? p("families", "परिवार") : p("staff", "स्टाफ़"));
  const r = 70;
  const circ = 2 * Math.PI * r;
  return (
    <VxPage>
      <style>{CSS}</style>
      <TopBar crumb={tx(p("Messages", "संदेश"))} title={tx(done ? p("Queued", "कतार में") : p("Sending", "भेजा जा रहा है"))} mSub={done ? `${c.recipientCount} ${audience}` : tx(p(`${sentPct}% done`, `${sentPct}% पूरा`))} mBack="/messages" />
      <main>
        <div className="pad mx-pg">
          {done ? (
            <div className="card fadein" style={{ maxWidth: 580, margin: "10px auto 0", padding: "32px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
              <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" style={{ animation: "xPopIn .5s var(--spring) both" }}>
                <circle cx="48" cy="48" r="44" style={{ fill: "var(--oks)" }} />
                <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: "276.5", strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
                <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: "60", strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
              </svg>
              <span style={{ ...serif22, fontSize: 26 }}>{tx(p(`Queued for ${c.recipientCount} ${family ? "families" : "staff"}`, `${c.recipientCount} ${family ? "परिवारों" : "स्टाफ़"} के लिए कतार में`))}</span>
              <span style={m13}>{waitingByHand ? tx(p("Nothing has gone to a parent. Each message waits in To send until a person sends it.", "किसी अभिभावक को कुछ नहीं गया। हर संदेश ‘भेजने को’ में रहता है जब तक कोई व्यक्ति न भेजे।")) : tx(p("You can leave this screen — the queue carries on.", "आप यह स्क्रीन छोड़ सकते हैं — कतार चलती रहेगी।"))}</span>
              <div style={{ width: "100%", borderTop: "1px solid var(--bd)", display: "flex", flexDirection: "column" }}>
                {([[p("Notice", "सूचना"), c.title], [p("Who", "किसे"), `${c.audienceLabel} · ${c.recipientCount}`], [p("Cost", "ख़र्च"), `about ${rupees(Math.round(paiseToRupees(c.costPaise)))}`]] as [Pair, string][]).map(([k, v]) => (
                  <div key={k.en} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 2px", borderBottom: "1px solid var(--bd)", fontSize: 14 }}>
                    <span style={{ color: "var(--mut)" }}>{tx(k)}</span>
                    <span className="num clip" style={{ fontWeight: 700 }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                <Btn variant="pri" icon="activity" href={href({ id: c.id })}>{tx(p("Track delivery", "पहुँच देखें"))}</Btn>
                {waitingByHand ? <Btn variant="sec" icon="send" href={href({ view: "outbox" })}>{tx(p("Open To send", "‘भेजने को’ खोलें"))}</Btn> : null}
                <Btn variant="sec" href="/messages">{tx(p("Back to messages", "संदेशों पर वापस"))}</Btn>
              </div>
            </div>
          ) : (
            <div className="card fadein" style={{ maxWidth: 560, margin: "10px auto 0", padding: "32px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
              <div style={{ position: "relative", width: 168, height: 168 }}>
                <svg width="168" height="168" viewBox="0 0 168 168" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="84" cy="84" r={r} style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 12 }} />
                  <circle cx="84" cy="84" r={r} style={{ fill: "none", stroke: "var(--acc)", strokeWidth: 12, strokeLinecap: "round", strokeDasharray: circ, strokeDashoffset: circ * (1 - sentPct / 100), transition: "stroke-dashoffset .25s linear" }} />
                </svg>
                <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <span className="num" style={{ fontSize: 34, fontWeight: 700 }}>{sentPct}%</span>
                  <span style={m12}>{tx(p("sent", "भेजे"))}</span>
                </span>
              </div>
              <span style={{ ...h15, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: c.counts.queued ? "var(--acc)" : "var(--ok)", animation: c.counts.queued ? "xPulse 1.6s infinite" : undefined }} />
                {tx(line)}
              </span>
              <div style={{ width: "100%", display: "flex", borderTop: "1px solid var(--bd)", paddingTop: 12 }}>
                {counts.map(([k, v, color]) => (
                  <span key={k.en} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span className="num" style={{ fontSize: 22, fontWeight: 700, color }}>{v}</span>
                    <span style={m12}>{tx(k)}</span>
                  </span>
                ))}
              </div>
              <span style={m13}>{waitingByHand ? tx(p("Nothing goes to a parent by itself — send each one from To send.", "अभिभावकों को अपने-आप कुछ नहीं जाता — ‘भेजने को’ से हर एक भेजें।")) : tx(p("You can leave this screen — sending carries on.", "आप यह स्क्रीन छोड़ सकते हैं — भेजना चलता रहेगा।"))}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {c.counts.queued > 0 && c.status !== "cancelled" ? (
                  <button type="button" className="tap btn ghost" disabled={pending} onClick={onStop} style={{ color: "var(--bad)" }}>{tx(p("Stop sending", "भेजना रोकें"))}</button>
                ) : null}
                <Btn variant="sec" href="/messages">{tx(p("Back to messages", "संदेशों पर वापस"))}</Btn>
              </div>
            </div>
          )}
        </div>
      </main>
    </VxPage>
  );
}

/* ----------------------------------------------------------------- compose */

function Compose({
  data,
  draft,
  preview,
  onStep,
  pending,
  start,
  onQueued,
}: {
  data: MessagesData;
  draft?: { title: string; hi: string; en: string };
  preview: boolean;
  onStep: (step: "write" | "preview") => void;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
  onQueued: (id: string) => void;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const [requestId, setRequestId] = useState(newRequestId);
  const [audience, setAudience] = useState<Audience>("school");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [kind, setKind] = useState<NoticeKind>("notice");
  const [language, setLanguage] = useState<NoticeLanguage>("both");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [hi, setHi] = useState(draft?.hi ?? "");
  const [en, setEn] = useState(draft?.en ?? "");
  const [focus, setFocus] = useState<"hi" | "en">("hi");

  const count = countFamilies(data.classSets, audience, classIds, data.staffCount);
  const cost = Math.round(paiseToRupees(costPaise(count)));
  const input = { kind: audience === "staff" ? ("staff" as const) : kind, title, hi, en, language, audience, classIds };
  const problems = composeProblems(input);
  const sample = audience === "staff" ? { parent: "Staff member", student: "", className: "" } : (data.sample ?? { parent: "Parent", student: "Student", className: "Class" });
  const rendered = composeText(input, { ...sample, date: dayMonth(new Date()) });
  const audienceName = audience === "staff" ? tx(p("Staff", "स्टाफ़")) : audience === "school" ? tx(p("Whole school", "पूरा विद्यालय")) : tx(p(`${classIds.length} ${classIds.length === 1 ? "class" : "classes"}`, `${classIds.length} कक्षाएँ`));
  const who = `${count} ${audience === "staff" ? tx(p("staff", "स्टाफ़")) : tx(p("parents", "अभिभावक"))} · ${audienceName}`;
  const costLine = tx(p(`about ${rupees(cost)}`, `लगभग ${rupees(cost)}`));
  // The title is drawn in bold above the text, so its WhatsApp *bold* line is not repeated.
  const lines = [rendered.hi, rendered.en].filter(Boolean).map((l) => l.replace(/^\*[^*]+\*\n/, ""));

  const insert = (token: string) => {
    if (focus === "hi") setHi((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${token}`);
    else setEn((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}${token}`);
  };

  const queue = () =>
    start(async () => {
      const result = await queueNoticeAction({ clientRequestId: requestId, ...input });
      toast.show({ text: tx(result.message), tone: result.ok ? "ok" : "bad" });
      if (result.ok && result.campaignId) {
        setRequestId(newRequestId());
        onQueued(result.campaignId);
      }
    });

  const queueLabel = pending ? tx(p("Queuing…", "कतार में डाल रहे हैं…")) : tx(p(`Queue for ${count} · ${rupees(cost)}`, `${count} के लिए कतार · ${rupees(cost)}`));
  const canQueue = !pending && problems.length === 0 && count > 0;
  const previewNote = tx(p(`Shown as ${sample.parent} sees it. Every parent gets their own name.`, `${sample.parent} को ऐसा दिखेगा। हर अभिभावक को अपना नाम मिलता है।`));

  const previewColumn = (
    <div className={`unstick${preview ? " mx-first" : ""}`} style={{ position: "sticky", top: 86, display: "flex", flexDirection: "column", gap: 12, borderTop: 0 }}>
      <span className="sech">{tx(preview ? p("What parents will see", "अभिभावकों को क्या दिखेगा") : p("Live preview", "तुरंत झलक"))}</span>
      <PhonePreview title={title || tx(p("Title", "शीर्षक"))} lines={lines.length ? lines : [tx(p("Your message appears here.", "आपका संदेश यहाँ दिखेगा।"))]} />
      <span style={{ ...m12, textAlign: "center" }}>{previewNote}</span>
      {!preview ? (
        <>
          {problems.length ? <span style={{ fontSize: 13, color: "var(--warnfg)" }}>{tx(COMPOSE_PROBLEMS[problems[0]])}</span> : null}
          <button type="button" className="tap btn pri only-d" disabled={problems.length > 0 || count === 0} onClick={() => onStep("preview")} style={{ height: 46 }}>
            <Ic n="eye" size={18} />
            {tx(p("Preview and send", "झलक देखें और भेजें"))}
          </button>
        </>
      ) : null}
    </div>
  );

  if (preview) {
    const rows: [IconName, Pair, string][] = [
      ["users", p("Who", "किसे"), who],
      ["globe", p("Language", "भाषा"), language === "both" ? "हिंदी + English" : language === "hi" ? "हिंदी" : "English"],
      ["tag", p("Kind", "प्रकार"), tx(KIND_LABELS[input.kind])],
      ["rupee", p("Cost", "ख़र्च"), tx(p(`about ${rupees(cost)} · ₹0.88 a message`, `लगभग ${rupees(cost)} · ₹0.88 प्रति संदेश`))],
      ["clock", p("When", "कब"), data.parentDispatchOn || audience === "staff" ? tx(p("Queued now", "अभी कतार में")) : tx(p("Queued now · sent by hand from To send", "अभी कतार में · ‘भेजने को’ से हाथ से"))],
    ];
    return (
      <VxPage>
        <style>{CSS}</style>
        <TopBar crumb={tx(p("Messages · New notice", "संदेश · नई सूचना"))} title={tx(p("Preview and send", "झलक और भेजना"))} mTitle={tx(p("Preview", "झलक"))} mSub={tx(p("Check, then send", "जाँचें, फिर भेजें"))} mBack={href({ compose: true })} actions={<Btn variant="ghost" icon="chevLeft" onClick={() => onStep("write")}>{tx(p("Back to edit", "बदलने के लिए वापस"))}</Btn>} />
        <main>
          <div className="pad mx-pg">
            <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 22, alignItems: "start", maxWidth: 1180 }}>
              <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={box}>
                  <span style={h15}>{tx(p("Check before sending", "भेजने से पहले जाँचें"))}</span>
                  {rows.map(([icon, k, v]) => (
                    <div key={k.en} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
                      <Ic n={icon} size={18} style={{ color: "var(--mut)" }} />
                      <span style={{ ...m13, width: 96, flex: "none" }}>{tx(k)}</span>
                      <span className="num" style={{ ...t14, flex: 1, minWidth: 0 }}>{v}</span>
                    </div>
                  ))}
                  {data.noPhone && audience !== "staff" ? <span style={m13}>{tx(p(`${data.noPhone} children have no usable WhatsApp number and are left out.`, `${data.noPhone} बच्चों का व्हाट्सऐप नंबर नहीं है, वे छूट जाएँगे।`))}</span> : null}
                  {problems.length ? <span style={{ fontSize: 13, color: "var(--warnfg)", fontWeight: 600 }}>{tx(COMPOSE_PROBLEMS[problems[0]])}</span> : null}
                </div>
                <div className="only-d" style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="tap btn sec" onClick={() => onStep("write")} style={{ flex: 1, height: 48 }}>
                    <Ic n="edit" size={18} />
                    {tx(p("Edit", "बदलें"))}
                  </button>
                  <button type="button" className="tap btn pri" disabled={!canQueue} onClick={queue} style={{ flex: 2, height: 48 }}>
                    <Ic n="send" size={18} />
                    {queueLabel}
                  </button>
                </div>
              </div>
              {previewColumn}
            </div>
          </div>
          <div className="only-m glass mx-sb">
            <button type="button" className="tap btn pri" disabled={!canQueue} onClick={queue} style={{ width: "100%", height: 48 }}>
              <Ic n="send" size={18} />
              {queueLabel}
            </button>
          </div>
        </main>
      </VxPage>
    );
  }

  const audienceCard = (value: Audience, icon: IconName, label: Pair, sub: string) => {
    const on = audience === value;
    return (
      <button type="button" role="radio" aria-checked={on} className="tap mx-sw" onClick={() => setAudience(value)} style={{ minHeight: 58, border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)" }}>
        <span aria-hidden="true" style={{ flex: "none", width: 34, height: 34, borderRadius: 12, background: "var(--card)", color: "var(--acc)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Ic n={icon} size={18} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={t14}>{tx(label)}</span>
          <span style={m12}>{sub}</span>
        </span>
      </button>
    );
  };

  return (
    <VxPage>
      <style>{CSS}</style>
      <TopBar crumb={tx(p("Messages", "संदेश"))} title={tx(p("New notice", "नई सूचना"))} mSub={`${who.split(" · ")[0]} · ${rupees(cost)}`} mBack="/messages" actions={<Btn variant="ghost" icon="chevLeft" href="/messages">{tx(p("Back", "वापस"))}</Btn>} />
      <main>
        <div className="pad mx-pg">
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 22, alignItems: "start", maxWidth: 1180 }}>
            <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <div className="field">
                <span>{tx(p("Who gets it", "किसे मिलेगा"))}</span>
                <div role="radiogroup" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                  {audienceCard("school", "home", p("Whole school", "पूरा विद्यालय"), tx(p(`${data.classSets.length} parents`, `${data.classSets.length} अभिभावक`)))}
                  {audienceCard("classes", "grad", p("Classes", "कक्षाएँ"), tx(p("Pick classes", "कक्षाएँ चुनें")))}
                  {audienceCard("staff", "briefcase", p("Staff", "स्टाफ़"), tx(p(`${data.staffCount} people`, `${data.staffCount} लोग`)))}
                </div>
              </div>
              {audience === "classes" ? (
                <div className="fadein" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {data.classes.map((c) => (
                    <Chip key={c.id} on={classIds.includes(c.id)} count={c.families} onClick={() => setClassIds((ids) => (ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id]))}>
                      {c.label}
                    </Chip>
                  ))}
                </div>
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: "var(--accs)", color: "var(--accfg)" }}>
                <Ic n="users" size={18} />
                <span className="num" style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700 }}>{who}</span>
                <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>{costLine}</span>
              </div>
              <div className="field mx-tabs">
                <span>{tx(p("Language", "भाषा"))}</span>
                <Seg<NoticeLanguage>
                  label={tx(p("Language", "भाषा"))}
                  value={language}
                  onChange={setLanguage}
                  options={[
                    { value: "both", label: "हिंदी + English" },
                    { value: "hi", label: "हिंदी" },
                    { value: "en", label: "English" },
                  ]}
                />
              </div>
              <label className="field">
                <span>{tx(p("Title (bold first line)", "शीर्षक (पहली मोटी पंक्ति)"))}</span>
                <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={tx(p("For example: Unit Test 2 datesheet", "जैसे: इकाई परीक्षा 2 की समय-सारणी"))} />
              </label>
              {language !== "en" ? (
                <label className="field">
                  <span>{tx(p("Message in Hindi", "हिंदी में संदेश"))}</span>
                  <Textarea value={hi} maxLength={MAX_BODY} lang="hi" onFocus={() => setFocus("hi")} onChange={(e) => setHi(e.target.value)} placeholder="प्रिय {parent}, ..." />
                  <span className="num" style={{ fontSize: 11, color: "var(--sub)", textAlign: "right", marginTop: -2 }}>{hi.length} / {MAX_BODY}</span>
                </label>
              ) : null}
              {language !== "hi" ? (
                <label className="field">
                  <span>{tx(p("Message in English", "अंग्रेज़ी में संदेश"))}</span>
                  <Textarea value={en} maxLength={MAX_BODY} onFocus={() => setFocus("en")} onChange={(e) => setEn(e.target.value)} placeholder="Dear {parent}, ..." />
                  <span className="num" style={{ fontSize: 11, color: "var(--sub)", textAlign: "right", marginTop: -2 }}>{en.length} / {MAX_BODY}</span>
                </label>
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ ...m12, fontWeight: 700 }}>{tx(p("Fills in for each parent", "हर अभिभावक के लिए भरता है"))}</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {PLACEHOLDERS.map((t) => (
                    <button key={t} type="button" className="tap chip" onClick={() => insert(t)} style={{ height: 32, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{t}</button>
                  ))}
                </div>
              </div>
              {audience !== "staff" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ ...m12, fontWeight: 700 }}>{tx(p("Kind of notice", "सूचना का प्रकार"))}</span>
                  <div className="hs" style={{ display: "flex", gap: 6 }}>
                    {NOTICE_KINDS.filter((k) => k !== "staff").map((k) => (
                      <Chip key={k} on={kind === k} icon={KIND_ICONS[k]} onClick={() => setKind(k)}>{tx(KIND_LABELS[k])}</Chip>
                    ))}
                  </div>
                </div>
              ) : null}
              <span style={m12}>{tx(p("Attachments and scheduling are not supported yet — put a link in the message instead.", "फ़ाइल जोड़ना और समय तय करना अभी नहीं है — संदेश में लिंक डालें।"))}</span>
            </div>
            {previewColumn}
          </div>
        </div>
        <div className="only-m glass mx-sb" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span className="num clip" style={t14}>{who}</span>
            <span className="num" style={m12}>{costLine}</span>
          </span>
          <button type="button" className="tap btn pri" disabled={problems.length > 0 || count === 0} onClick={() => onStep("preview")} style={{ height: 48 }}>
            {tx(p("Preview", "झलक"))}
            <Ic n="arrowRight" size={18} />
          </button>
        </div>
      </main>
    </VxPage>
  );
}

/* --------------------------------------------------------------- templates */

function Templates({ templates, tabs, onNew }: { templates: TemplateView[]; tabs: ReactNode; onNew: () => void }) {
  const { tx } = useVx();
  const [picked, setPicked] = useState<string | null>(templates[0]?.id ?? null);
  const sel = templates.find((t) => t.id === picked) ?? null;
  const stateTone = (t: TemplateView) => {
    const s = templateState(t);
    return s === "approved" ? TONE.ok : s === "waiting" ? TONE.warn : TONE.mut;
  };
  const cat = (t: TemplateView) => (t.waCategory === "marketing" ? tx(p("Marketing", "मार्केटिंग")) : tx(p("Utility", "यूटिलिटी")));
  const lang = (t: TemplateView) => (t.bodyHi && t.bodyEn && t.bodyHi !== t.bodyEn ? "हिंदी + English" : t.bodyHi ? "हिंदी" : "English");
  return (
    <>
      {tabs}
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 400px", alignItems: "start", alignContent: "start", minHeight: "100%" }}>
        <section className="pad mx-pg" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column" }}>
              <span style={h15}>{tx(p("AiSensy templates", "AiSensy टेम्पलेट"))}</span>
              <span style={m12}>{tx(p("WhatsApp must approve a template before it can go to parents.", "अभिभावकों को भेजने से पहले व्हाट्सऐप टेम्पलेट को मंज़ूर करता है।"))}</span>
            </span>
            <Btn variant="soft" icon="plus" onClick={onNew}>{tx(p("New template", "नया टेम्पलेट"))}</Btn>
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {templates.length === 0 ? <div style={{ padding: "24px 16px", ...m13 }}>{tx(p("No templates yet. Add one to send notices through AiSensy.", "अभी कोई टेम्पलेट नहीं। AiSensy से सूचना भेजने के लिए एक जोड़ें।"))}</div> : null}
            {templates.map((t, i) => {
              const tone = stateTone(t);
              return (
                <button key={t.id} type="button" className={`tap row mx-row${t.id === picked ? " sel" : ""}`} onClick={() => setPicked(t.id)} style={{ borderTop: i ? "1px solid var(--bd)" : 0, animationDelay: `${Math.min(i, 14) * 28}ms` }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span className="clip" style={t14}>{t.label}</span>
                    <span className="clip" style={{ ...m12, fontFamily: "ui-monospace, monospace" }}>{t.code}</span>
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 3 }}>
                      <span className="pill" style={{ background: "var(--s3)", color: "var(--mut)" }}>{cat(t)}</span>
                      <span className="pill" style={{ background: "var(--s3)", color: "var(--mut)" }}>{lang(t)}</span>
                      <span className="pill" style={{ background: "var(--s3)", color: "var(--mut)" }}>{t.audience === "parent" ? tx(p("Parents", "अभिभावक")) : tx(p("Staff", "स्टाफ़"))}</span>
                    </span>
                  </span>
                  <span className="pill" style={{ background: tone.bg, color: tone.fg }}>{tx(TEMPLATE_STATE_LABELS[templateState(t)])}</span>
                </button>
              );
            })}
          </div>
        </section>
        <aside className="unstick" style={{ position: "sticky", top: 64, maxHeight: "calc(100dvh - 64px)", overflowY: "auto", borderLeft: "1px solid var(--bd)", background: "var(--bg)", alignSelf: "stretch" }}>
          {sel ? (
            <div className="pad fadein" style={{ padding: "20px 22px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: stateTone(sel).bg, color: stateTone(sel).fg }}>{tx(TEMPLATE_STATE_LABELS[templateState(sel)])}</span>
              </div>
              <span style={serif22}>{sel.label}</span>
              <span style={{ ...m12, fontFamily: "ui-monospace, monospace" }}>{sel.code} · {cat(sel)} · {lang(sel)}</span>
              <div className="mx-wa">
                <Bubble lines={[sel.bodyHi, sel.bodyEn !== sel.bodyHi ? sel.bodyEn : ""].filter(Boolean)} />
              </div>
              <span style={m12}>{tx(p("Words in {curly brackets} fill in for each parent.", "{कोष्ठक} के शब्द हर अभिभावक के लिए भरते हैं।"))}</span>
              {templateState(sel) === "waiting" ? <span style={{ ...m13, padding: "10px 12px", borderRadius: 14, background: "var(--s2)" }}>{tx(p("Waiting for WhatsApp. Utility: about an hour. Marketing: up to a day.", "व्हाट्सऐप की प्रतीक्षा। यूटिलिटी: लगभग एक घंटा। मार्केटिंग: एक दिन तक।"))}</span> : null}
              {templateState(sel) === "approved" ? <Btn variant="pri" icon="send" href={href({ compose: true })} style={{ height: 44 }}>{tx(p("Write a new notice", "नई सूचना लिखें"))}</Btn> : null}
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function TemplateSheet({ open, onClose, pending, onSave }: { open: boolean; onClose: () => void; pending: boolean; onSave: (input: { name: string; category: string; hi: string; en: string }) => void }) {
  const { tx } = useVx();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"utility" | "marketing">("utility");
  const [hi, setHi] = useState("");
  const [en, setEn] = useState("");
  const [focus, setFocus] = useState<"hi" | "en">("hi");
  const slug = templateSlug(name);
  const insert = (token: string) => (focus === "hi" ? setHi((t) => `${t}${token}`) : setEn((t) => `${t}${token}`));
  const cats: { key: "utility" | "marketing"; label: Pair; sub: Pair }[] = [
    { key: "utility", label: p("Utility", "यूटिलिटी"), sub: p("Holidays, fees, results, PTMs. Approved faster — usually within an hour.", "छुट्टी, फीस, परिणाम, PTM। जल्दी मंज़ूर — आमतौर पर एक घंटे में।") },
    { key: "marketing", label: p("Marketing", "मार्केटिंग"), sub: p("Greetings and admissions. Slower to approve.", "शुभकामनाएँ और प्रवेश। मंज़ूरी में देर।") },
  ];
  const tips: Pair[] = [
    p("Say who it is from in the first line.", "पहली पंक्ति में बताएँ कि संदेश किसका है।"),
    p("Keep it to one purpose.", "एक संदेश, एक काम।"),
    p("No offers or links in a Utility template.", "यूटिलिटी टेम्पलेट में ऑफ़र या लिंक नहीं।"),
  ];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title={tx(p("New template", "नया टेम्पलेट"))}
      sub={tx(p("WhatsApp checks every template once. After that you can use it any time.", "व्हाट्सऐप हर टेम्पलेट एक बार जाँचता है। फिर आप उसे कभी भी इस्तेमाल कर सकते हैं।"))}
      footer={
        <>
          <Btn variant="sec" style={{ flex: 1 }} onClick={onClose}>{tx(p("Cancel", "रद्द करें"))}</Btn>
          <Btn variant="pri" icon="upload" style={{ flex: 1.7 }} disabled={pending || !slug || (!hi.trim() && !en.trim())} onClick={() => onSave({ name, category, hi, en })}>{tx(p("Send for approval", "मंज़ूरी के लिए भेजें"))}</Btn>
        </>
      }
    >
      <div className="mx-tsheet" style={{ paddingTop: 4 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <label className="field">
            <span>{tx(p("Name", "नाम"))} · {slug || "template_name"}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tx(p("For example: Unit test datesheet", "जैसे: इकाई परीक्षा समय-सारणी"))} />
          </label>
          <div className="field">
            <span>{tx(p("Category", "श्रेणी"))}</span>
            <div className="mx-cat" role="radiogroup">
              {cats.map((c) => {
                const on = category === c.key;
                return (
                  <button key={c.key} type="button" role="radio" aria-checked={on} className="tap mx-sw" onClick={() => setCategory(c.key)} style={{ flexDirection: "column", gap: 2, justifyContent: "center", textAlign: "center", border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)" }}>
                    <span style={t14}>{tx(c.label)}</span>
                    <span style={m12}>{tx(c.sub)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <label className="field">
            <span>{tx(p("Hindi text", "हिंदी पाठ"))}</span>
            <Textarea lang="hi" value={hi} onFocus={() => setFocus("hi")} onChange={(e) => setHi(e.target.value)} placeholder="प्रिय {parent}, ..." style={{ minHeight: 84 }} />
          </label>
          <label className="field">
            <span>{tx(p("English text", "अंग्रेज़ी पाठ"))}</span>
            <Textarea value={en} onFocus={() => setFocus("en")} onChange={(e) => setEn(e.target.value)} placeholder="Dear {parent}, ..." style={{ minHeight: 84 }} />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span style={{ ...m12, fontWeight: 700 }}>{tx(p("Insert:", "जोड़ें:"))}</span>
            {["{parent}", "{student}", "{class}", "{date}", "{amount}"].map((t) => (
              <button key={t} type="button" className="tap chip" onClick={() => insert(t)} style={{ height: 30, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{t}</button>
            ))}
          </div>
        </div>
        <div className="mx-tips" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, borderRadius: 14, background: "var(--s2)", fontSize: 13, lineHeight: 1.45 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
            <Ic n="help" size={15} style={{ color: "var(--acc)" }} />
            {tx(p("Tips for a quick yes", "जल्दी मंज़ूरी के लिए"))}
          </span>
          {tips.map((t) => (
            <span key={t.en} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <Ic n="check" size={15} style={{ color: "var(--ok)", marginTop: 2 }} />
              <span>{tx(t)}</span>
            </span>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------- replies */

function Replies({
  replies,
  staff,
  tabs,
  selectedId,
  pending,
  onSelect,
  onAnswer,
  onAssign,
  onDone,
}: {
  replies: ReplyView[];
  staff: { id: string; name: string }[];
  tabs: ReactNode;
  selectedId: string | null;
  pending: boolean;
  onSelect: (id: string | null) => void;
  onAnswer: (replyId: string, body: string, after: () => void) => void;
  onAssign: (replyId: string, staffId: string | null) => void;
  onDone: (replyId: string, done: boolean) => void;
}) {
  const { tx } = useVx();
  const [filter, setFilter] = useState<ReplyFilter>("open");
  const [draft, setDraft] = useState("");
  const shown = replies.filter((r) => matchesReply(r, filter));
  const chosen = replies.find((r) => r.id === selectedId) ?? null;
  // On a desk the first reply is open beside the list, as drawn; a phone opens one on tap.
  const selected = chosen ?? shown[0] ?? null;
  const nameOf = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);
  const labels: Record<ReplyFilter, Pair> = { open: p("Open", "खुले"), unassigned: p("Not assigned", "किसी को नहीं दिया"), done: p("Done", "पूरे") };
  // "10:42 am" today, "Yesterday", then the day — as the design lists replies.
  const replyWhen = (iso: string) => {
    const day = schoolToday(new Date(iso));
    const today = schoolToday();
    if (day === today) return ampm(iso);
    const yesterday = new Date(`${today}T12:00:00+05:30`);
    yesterday.setDate(yesterday.getDate() - 1);
    return day === schoolToday(yesterday) ? tx(p("Yesterday", "कल")) : day3(iso);
  };
  const assigned = (r: ReplyView) => (r.assignedStaffId ? { text: nameOf.get(r.assignedStaffId) ?? tx(p("Assigned", "दिया गया")), ...TONE.acc } : { text: tx(p("Not assigned", "किसी को नहीं दिया")), ...TONE.warn });

  const list = (
    <section className={`pad mx-pg${chosen ? " hide-m" : ""}`} style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(["open", "unassigned", "done"] as ReplyFilter[]).map((f) => (
          <button key={f} type="button" className={`tap chip${filter === f ? " on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {tx(labels[f])}
            <span className="num" style={{ opacity: 0.7, fontSize: 11 }}>{replies.filter((r) => matchesReply(r, f)).length}</span>
          </button>
        ))}
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        {shown.length === 0 ? (
          <div style={{ padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
            <Ic n="checkCircle" size={32} style={{ color: "var(--ok)" }} />
            <span style={h15}>{tx(p("All caught up", "सब निपट गया"))}</span>
            <span style={m13}>{tx(p("No replies waiting here.", "यहाँ कोई जवाब प्रतीक्षा में नहीं।"))}</span>
          </div>
        ) : null}
        {shown.map((r, i) => {
          const as = assigned(r);
          return (
            <div key={r.id} style={{ display: "flex", alignItems: "center", borderTop: i ? "1px solid var(--bd)" : 0, animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 28}ms both` }}>
              <button type="button" className={`tap row mx-row${r.id === selected?.id ? " sel" : ""}`} onClick={() => onSelect(r.id)} style={{ flex: 1, minWidth: 0, border: 0, alignItems: "flex-start", animation: "none" }}>
                <Face name={r.fromName} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="clip" style={{ ...t14, flex: 1, minWidth: 0 }}>{r.fromName}</span>
                    <span style={{ ...m12, flex: "none" }}>{replyWhen(r.receivedAt)}</span>
                  </span>
                  {r.studentLabel ? <span className="clip" style={m12}>{r.studentLabel}</span> : null}
                  <span className="clip" style={{ fontSize: 13 }}>{r.body}</span>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {r.regarding ? <span className="pill" style={{ background: "var(--s3)", color: "var(--mut)" }}>Re: {r.regarding}</span> : null}
                    <span className="pill" style={{ background: as.bg, color: as.fg }}>{as.text}</span>
                  </span>
                </span>
              </button>
              <button type="button" className="tap btn ghost" aria-label={tx(r.status === "done" ? p("Open again", "फिर खोलें") : p("Mark done", "पूरा करें"))} disabled={pending} onClick={() => onDone(r.id, r.status !== "done")} style={{ width: 40, height: 40, padding: 0, marginRight: 10, color: "var(--ok)", flex: "none" }}>
                <Ic n={r.status === "done" ? "undo" : "checkCircle"} size={20} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );

  const as = selected ? assigned(selected) : null;
  const panel = selected ? (
    <div className="pad fadein" style={{ padding: "18px 22px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {chosen ? (
          <button type="button" className="tap btn ghost only-m" aria-label={tx(p("Back to replies", "जवाबों पर वापस"))} onClick={() => onSelect(null)} style={{ width: 40, height: 40, padding: 0 }}>
            <Ic n="chevLeft" size={20} />
          </button>
        ) : null}
        <Face name={selected.fromName} size={44} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={h15}>{selected.fromName}</span>
          <span className="num" style={m12}>{[selected.studentLabel, selected.phone].filter(Boolean).join(" · ")}</span>
        </span>
        {selected.studentId ? <Btn variant="ghost" href={`/students/${selected.studentId}`} style={{ height: 36, padding: "0 11px", fontSize: 13 }}>{tx(p("Open student", "विद्यार्थी खोलें"))}</Btn> : null}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={m12}>{tx(p("Assigned to", "किसे दिया"))}</span>
        <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <select
            value={selected.assignedStaffId ?? ""}
            disabled={pending}
            onChange={(e) => onAssign(selected.id, e.target.value || null)}
            className="tap"
            style={{ appearance: "none", height: 32, padding: "0 30px 0 13px", borderRadius: 16, border: "1px solid var(--bd)", background: as?.bg, color: as?.fg, fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
          >
            <option value="">{tx(p("Not assigned", "किसी को नहीं दिया"))}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <Ic n="chevDown" size={15} style={{ position: "absolute", right: 10, pointerEvents: "none", color: as?.fg }} />
        </span>
      </label>
      <div className="mx-wa" style={{ padding: "14px 10px" }}>
        {selected.campaignBody ? (
          <div className="mx-bu" style={{ fontSize: 12.5, opacity: 0.9 }}>
            <b style={{ display: "block" }}>{selected.campaignTitle}</b>
            <div>{selected.campaignBody.slice(0, 110)}{selected.campaignBody.length > 110 ? "…" : ""}</div>
          </div>
        ) : null}
        <div className="mx-bu mx-in">
          <div>{selected.body}</div>
          <div className="mx-tm">{ampm(selected.receivedAt)}</div>
        </div>
        {selected.answers.map((a) => (
          <div key={a.id} className="mx-bu">
            <div>{a.body}</div>
            <div className="mx-tm">{a.by ? `${a.by} · ` : ""}{ampm(a.at)} · {tx(p("waiting in To send", "‘भेजने को’ में"))}</div>
          </div>
        ))}
      </div>
      <span className="sech">{tx(p("Quick replies", "तैयार जवाब"))}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {QUICK_REPLIES.map((q) => (
          <button key={q.en} type="button" className="tap mx-sw" onClick={() => setDraft(quickReplyText(q))} style={{ minHeight: 44, padding: "8px 12px", fontSize: 13 }}>
            <span style={{ flex: 1, minWidth: 0 }}>{q.hi} · {q.en}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>{tx(p("Your reply", "आपका जवाब"))}</span>
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tx(p("Type a reply — Hindi first is best", "जवाब लिखें — पहले हिंदी बेहतर"))} style={{ minHeight: 80 }} />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="tap btn pri" disabled={pending || !draft.trim()} onClick={() => onAnswer(selected.id, draft, () => setDraft(""))} style={{ flex: 1.4, opacity: draft.trim() ? 1 : 0.55 }}>
          <Ic n="send" size={18} />
          {tx(p("Queue reply · free", "जवाब कतार में · मुफ़्त"))}
        </button>
        <Btn variant="sec" icon={selected.status === "done" ? "undo" : "check"} disabled={pending} style={{ flex: 1 }} onClick={() => onDone(selected.id, selected.status !== "done")}>
          {tx(selected.status === "done" ? p("Open again", "फिर खोलें") : p("Mark done", "पूरा करें"))}
        </Btn>
      </div>
      <span style={m12}>{tx(p("1 parent · free, because it is a reply within 24 hours of their message. It waits in To send like every family message.", "1 अभिभावक · मुफ़्त, क्योंकि यह उनके संदेश के 24 घंटे में जवाब है। हर पारिवारिक संदेश की तरह यह ‘भेजने को’ में रहता है।"))}</span>
    </div>
  ) : null;

  return (
    <>
      {chosen ? null : tabs}
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 440px", alignItems: "start", alignContent: "start", minHeight: "100%" }}>
        {list}
        <aside className={`unstick${chosen ? "" : " only-d"}`} style={{ position: "sticky", top: 64, maxHeight: "calc(100dvh - 64px)", overflowY: "auto", borderLeft: "1px solid var(--bd)", background: "var(--bg)" }}>
          {panel}
        </aside>
      </div>
    </>
  );
}
