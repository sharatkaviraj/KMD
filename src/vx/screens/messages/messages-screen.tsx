"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

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
import { agoP, clock, dateLabel, dayMonth, initials, rupees } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";
import { Chip, ChipRow, Field, Input, RadioCard, Seg, SearchBox, Select, Textarea } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, Grid, Section, Split, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, Btn, Card, CardHead, EmptyState, IconTile, Kpi, Pill, Progress, Ring, SecHead, SuccessTick } from "@/vx/ui/primitives";

import type { CampaignView, MessagesData, RecipientView, ReplyView, TemplateView } from "./data";
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

export type MessagesView = "sent" | "replies" | "templates";
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

export function MessagesScreen({ data, state }: { data: MessagesData; state: MessagesState }) {
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
      label="Messages view"
      value={state.view}
      onChange={(v) => go({ view: v })}
      options={[
        { value: "sent", label: tx(p("Sent", "भेजे गए")) },
        { value: "replies", label: `${tx(p("Replies", "जवाब"))}${openReplies ? ` · ${openReplies}` : ""}` },
        { value: "templates", label: tx(p("Templates", "टेम्पलेट")) },
      ]}
      style={{ minWidth: 320 }}
    />
  );

  if (state.compose) {
    return <Compose data={data} preview={state.step === "preview"} onStep={(step) => go({ compose: true, step })} pending={pending} start={start} onQueued={(id) => router.push(href({ id, done: true }))} />;
  }

  const detail = state.id ? data.detail : null;
  if (detail && (state.done || state.progress)) {
    return <Outcome campaign={detail.campaign} done={state.done} parentDispatchOn={data.parentDispatchOn} pending={pending} onStop={() => start(async () => done(await cancelNoticeAction(detail.campaign.id)))} />;
  }
  if (detail) {
    return <Detail campaign={detail.campaign} recipients={detail.recipients} pending={pending} onResend={() => start(async () => done(await resendFailedAction(detail.campaign.id)))} onStop={() => start(async () => done(await cancelNoticeAction(detail.campaign.id)))} />;
  }

  const header = (
    <TopBar
      crumb="System · WhatsApp (AiSensy)"
      title={tx(p("Messages", "संदेश"))}
      mSub={state.view === "replies" ? `${openReplies} open` : state.view === "templates" ? `${data.templates.length} templates` : `${data.campaigns.length} notices`}
      mBack="/menu"
      actions={
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {tabs}
          <Btn variant="pri" icon="plus" href={href({ compose: true })}>New notice</Btn>
          <HelpButton
            title="Messages"
            steps={[
              { icon: "megaphone", title: "Write once", body: "Every family gets its own copy with their name and child filled in. Siblings share one message." },
              { icon: "clock", title: "Queued, not sent", body: "Family messages wait in the queue until WhatsApp sending to parents is switched on. Nothing reaches a parent by accident." },
              { icon: "rupee", title: "Cost", body: "AiSensy charges about ₹0.88 a message. The cost is shown before you queue." },
            ]}
          />
        </span>
      }
      mAction={<Btn variant="soft" icon="plus" href={href({ compose: true })} ariaLabel="New notice" />}
    />
  );

  return (
    <VxPage>
      {header}
      <main>
        {state.view === "sent" ? <SentLog data={data} tabs={tabs} /> : null}
        {state.view === "templates" ? (
          <Templates templates={data.templates} tabs={tabs} onNew={() => go({ view: "templates", sheet: "template-new" })} />
        ) : null}
        {state.view === "replies" ? (
          <Replies
            replies={data.replies}
            staff={data.staffChoices}
            tabs={tabs}
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

function SentLog({ data, tabs }: { data: MessagesData; tabs: React.ReactNode }) {
  const { tx } = useVx();
  const [kind, setKind] = useState<NoticeKind | "all">("all");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = data.campaigns.filter((c) => (kind === "all" || c.kind === kind) && (!q || c.title.toLowerCase().includes(q) || c.audienceLabel.toLowerCase().includes(q)));
  const week = shown.filter((c) => logBucket(c.createdAt) === "week");
  const earlier = shown.filter((c) => logBucket(c.createdAt) === "earlier");

  return (
    <Section>
      <div className="only-m">{tabs}</div>
      {!data.parentDispatchOn ? (
        <Banner tone="info">
          {tx(p("Family messages are queued, not sent: WhatsApp sending to parents is off. They go out when the school switches it on.", "अभिभावकों को संदेश अभी कतार में रहते हैं — व्हाट्सऐप भेजना बंद है।"))}
        </Banner>
      ) : null}
      <Grid cols={4}>
        <Kpi label="Queued this month" value={data.month.count.toLocaleString("en-IN")} sub="one per family" />
        <Kpi label="Waiting to go" value={data.month.queued.toLocaleString("en-IN")} tone="var(--warn)" sub="in the WhatsApp queue" />
        <Kpi label="Cost this month" value={rupees(paiseToRupees(data.month.costPaise))} sub="₹0.88 a message" />
        <Kpi label="Parent sending" value={data.parentDispatchOn ? "On" : "Off"} tone={data.parentDispatchOn ? "var(--ok)" : "var(--mut)"} sub={data.parentDispatchOn ? "pressed by a person" : "held in the queue"} />
      </Grid>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <ChipRow label="Kind" style={{ flex: 1, minWidth: 0 }}>
          <Chip on={kind === "all"} onClick={() => setKind("all")} count={data.campaigns.length}>All</Chip>
          {NOTICE_KINDS.map((k) => (
            <Chip key={k} on={kind === k} onClick={() => setKind(k)} count={data.campaigns.filter((c) => c.kind === k).length}>
              {tx(KIND_LABELS[k])}
            </Chip>
          ))}
        </ChipRow>
        <SearchBox value={query} onChange={setQuery} placeholder="Search messages" style={{ width: 260 }} />
      </div>
      {shown.length === 0 ? (
        <EmptyState icon="megaphone" title={data.campaigns.length ? "Nothing matches" : "No notices yet"} body="Write one with New notice. It is queued for every family in one go." action={<Btn variant="pri" icon="plus" href={href({ compose: true })}>New notice</Btn>} />
      ) : null}
      {week.length ? <LogGroup title="This week" rows={week} /> : null}
      {earlier.length ? <LogGroup title="Earlier" rows={earlier} /> : null}
    </Section>
  );
}

function LogGroup({ title, rows }: { title: string; rows: CampaignView[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SecHead action={<span style={{ fontSize: 12, color: "var(--mut)" }}>{rows.length} {rows.length === 1 ? "message" : "messages"}</span>}>{title}</SecHead>
      <Card pad={false} style={{ overflow: "hidden" }}>
        {rows.map((c, i) => (
          <CampaignRow key={c.id} c={c} first={i === 0} />
        ))}
      </Card>
    </div>
  );
}

function statusLine(c: CampaignView): { text: string; tone: string } {
  if (c.status === "cancelled") return { text: "Stopped", tone: "var(--mut)" };
  if (c.counts.failed) return { text: `${c.counts.failed} failed`, tone: "var(--bad)" };
  if (c.counts.queued) return { text: `${c.counts.queued} queued`, tone: "var(--warnfg)" };
  return { text: "All sent", tone: "var(--ok)" };
}

function CampaignRow({ c, first }: { c: CampaignView; first: boolean }) {
  const { tx } = useVx();
  const status = statusLine(c);
  return (
    <Link href={href({ id: c.id })} className="row tap" style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 16px", borderTop: first ? 0 : "1px solid var(--bd)", color: "inherit", textDecoration: "none" }}>
      <IconTile icon={KIND_ICONS[c.kind]} tone={KIND_TONES[c.kind]} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span className="clip" style={{ fontWeight: 600 }}>{c.title}</span>
        <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{c.audienceLabel} · {dateLabel(c.createdAt)}, {clock(c.createdAt)}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 360 }}>
          <Progress value={c.counts.sent} max={Math.max(1, c.counts.total)} height={6} style={{ flex: 1 }} tone="var(--ok)" />
          <span className="num" style={{ fontSize: 12, color: "var(--mut)", flex: "none" }}>{c.counts.sent} sent</span>
        </span>
      </span>
      <span className="hide-m"><Pill tone={KIND_TONES[c.kind]}>{tx(KIND_LABELS[c.kind])}</Pill></span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flex: "none" }}>
        <span className="num" style={{ fontWeight: 700 }}>{rupees(paiseToRupees(c.costPaise))}</span>
        <span style={{ fontSize: 12, color: status.tone }}>{status.text}</span>
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
  const lines = [c.bodyHi, c.bodyEn].filter(Boolean);
  const total = Math.max(1, c.counts.total);

  return (
    <VxPage>
      <TopBar crumb="Messages" title={c.title} mTitle="Delivery" mSub={c.title} mBack="/messages" actions={<Btn variant="ghost" icon="chevLeft" href="/messages">Back to messages</Btn>} />
      <main>
        <Section>
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", gap: 16, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Card>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <Pill tone={KIND_TONES[c.kind]} icon={KIND_ICONS[c.kind]}>{tx(KIND_LABELS[c.kind])}</Pill>
                  <Pill tone="mut">{dateLabel(c.createdAt)}, {clock(c.createdAt)}</Pill>
                  {c.status === "cancelled" ? <Pill tone="bad">Stopped</Pill> : null}
                </div>
                <h2 className="serif" style={{ margin: "4px 0", fontSize: 24 }}>{c.title}</h2>
                <div style={{ color: "var(--mut)", marginBottom: 12 }}>{c.audienceLabel}{c.createdBy ? ` · by ${c.createdBy}` : ""}</div>
                <WaBubble title={c.title} lines={lines} />
              </Card>
              <Card>
                <CardHead title="Delivery" sub={`${rupees(paiseToRupees(c.costPaise))} · ₹0.88 each`} />
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                  <Progress label={<Row l="Queued" r={`${c.counts.queued} · ${Math.round((c.counts.queued / total) * 100)}%`} />} value={c.counts.queued} max={total} tone="var(--warn)" />
                  <Progress label={<Row l="Sent" r={`${c.counts.sent} · ${Math.round((c.counts.sent / total) * 100)}%`} />} value={c.counts.sent} max={total} tone="var(--ok)" />
                  <Progress label={<Row l="Not delivered" r={`${c.counts.failed}`} />} value={c.counts.failed} max={total} tone="var(--bad)" />
                  {c.counts.cancelled ? <Progress label={<Row l="Stopped" r={`${c.counts.cancelled}`} />} value={c.counts.cancelled} max={total} tone="var(--mut)" /> : null}
                </div>
                <p style={{ fontSize: 13, color: "var(--mut)", margin: "12px 0 0" }}>Read receipts are not tracked yet: WhatsApp reports them only once sending is live.</p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                  <Btn variant="danger" icon="refresh" disabled={pending || c.counts.failed === 0} onClick={onResend}>Resend to {c.counts.failed} not delivered</Btn>
                  {c.counts.queued > 0 && c.status !== "cancelled" ? <Btn variant="sec" icon="x" disabled={pending} onClick={onStop}>Stop {c.counts.queued} queued</Btn> : null}
                  <Btn variant="soft" icon="clock" href={href({ id: c.id, progress: true })}>Progress</Btn>
                </div>
              </Card>
            </div>
            <Card pad={false} style={{ overflow: "hidden" }}>
              <div style={{ padding: "16px 18px 10px" }}>
                <CardHead title="Who got it" sub={`Showing ${Math.min(limit, shown.length)} of ${shown.length}`} />
                <ChipRow label="Delivery filter" style={{ marginTop: 8 }}>
                  <Chip on={filter === "all"} onClick={() => setFilter("all")} count={recipients.length}>All</Chip>
                  <Chip on={filter === "sent"} icon="ticks" onClick={() => setFilter("sent")} count={c.counts.sent}>Sent</Chip>
                  <Chip on={filter === "queued"} icon="clock" onClick={() => setFilter("queued")} count={c.counts.queued}>Queued</Chip>
                  <Chip on={filter === "failed"} icon="alert" onClick={() => setFilter("failed")} count={c.counts.failed}>Not delivered</Chip>
                </ChipRow>
              </div>
              {shown.length === 0 ? <EmptyState icon="inbox" title="Nobody here" body="Pick another filter." /> : null}
              {shown.slice(0, limit).map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderTop: "1px solid var(--bd)" }}>
                  <Avatar text={initials(r.name)} seed={r.name} size={36} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span className="clip" style={{ fontWeight: 600 }}>{r.name}</span>
                    <span className="clip num" style={{ fontSize: 12, color: "var(--mut)" }}>{[r.about, r.phone].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 12 }}>
                    {r.status === "sent" ? <Ic n="ticks" size={18} style={{ color: "var(--info)" }} /> : r.status === "failed" ? <Ic n="alert" size={18} style={{ color: "var(--bad)" }} /> : r.status === "cancelled" ? <Ic n="x" size={18} style={{ color: "var(--mut)" }} /> : <Ic n="clock" size={18} style={{ color: "var(--mut)" }} />}
                    <span style={{ color: r.status === "failed" ? "var(--bad)" : "var(--mut)" }}>{r.status === "failed" ? (r.error ?? "Not delivered") : r.status === "sent" ? clock(r.at) : r.status === "cancelled" ? "Stopped" : "Queued"}</span>
                  </span>
                </div>
              ))}
              {shown.length > limit ? (
                <div style={{ padding: 12, display: "flex", justifyContent: "center", borderTop: "1px solid var(--bd)" }}>
                  <Btn variant="ghost" onClick={() => setLimit((n) => n + 100)}>Show more</Btn>
                </div>
              ) : null}
              <div style={{ padding: "10px 18px", borderTop: "1px solid var(--bd)", fontSize: 12, color: "var(--mut)" }}>clock queued · ✓✓ sent · ! not delivered</div>
            </Card>
          </div>
        </Section>
      </main>
    </VxPage>
  );
}

function Row({ l, r }: { l: string; r: string }) {
  return (
    <span style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
      <span>{l}</span>
      <span className="num" style={{ fontSize: 13 }}>{r}</span>
    </span>
  );
}

function WaBubble({ title, lines, time = "10:00" }: { title?: string; lines: string[]; time?: string }) {
  return (
    <div style={{ background: "var(--wabg)", borderRadius: 16, padding: 14 }} aria-label="WhatsApp preview">
      <div style={{ maxWidth: "94%", background: "var(--wab)", color: "var(--wafg)", borderRadius: "4px 14px 14px 14px", padding: "10px 12px 6px", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", boxShadow: "0 1px 1px rgba(0,0,0,.12)" }}>
        {title ? <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div> : null}
        {lines.map((l, i) => (
          <div key={i} style={{ marginTop: i ? 8 : 0 }}>{l.replace(/^\*[^*]+\*\n/, "")}</div>
        ))}
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>— श्री वीर पत्ता सी. सै. स्कूल</div>
        <div style={{ textAlign: "right", fontSize: 11, opacity: 0.6 }}>{time}</div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- after queuing */

function Outcome({ campaign: c, done, parentDispatchOn, pending, onStop }: { campaign: CampaignView; done: boolean; parentDispatchOn: boolean; pending: boolean; onStop: () => void }) {
  const total = Math.max(1, c.counts.total);
  const sentPct = Math.round((c.counts.sent / total) * 100);
  const family = c.audience !== "staff";
  return (
    <VxPage>
      <TopBar crumb="Messages" title={done ? "Queued" : "Sending"} mSub={done ? c.title : `${sentPct}% sent`} mBack="/messages" />
      <main>
        <Section style={{ alignItems: "center" }}>
          <Card style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center", padding: 28 }}>
            {done ? (
              <>
                <SuccessTick />
                <h2 className="serif" style={{ margin: 0, fontSize: 24 }}>Queued for {c.recipientCount} {family ? "families" : "staff"}</h2>
                <div style={{ color: "var(--mut)" }}>{c.title} · about {rupees(paiseToRupees(c.costPaise))}</div>
              </>
            ) : (
              <Ring value={c.counts.sent} max={total} size={150} stroke={14}>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span className="num" style={{ fontSize: 32, fontWeight: 700 }}>{sentPct}%</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>sent</span>
                </span>
              </Ring>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: c.counts.queued ? "var(--warn)" : "var(--ok)" }} />
              {c.status === "cancelled" ? "Stopped" : c.counts.queued ? (family && !parentDispatchOn ? "Waiting: parent sending is off" : "In the WhatsApp queue") : "Done"}
            </div>
            <Grid cols={3} style={{ width: "100%", borderTop: "1px solid var(--bd)", paddingTop: 14 }}>
              <Stat n={c.counts.queued} label="Queued" />
              <Stat n={c.counts.sent} label="Sent" tone="var(--ok)" />
              <Stat n={c.counts.failed} label="Failed" tone="var(--bad)" />
            </Grid>
            <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
              {family && !parentDispatchOn
                ? "Nothing has gone to a parent. Each message waits in the queue until WhatsApp sending to parents is switched on."
                : "You can leave this screen — the queue carries on."}
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              {c.counts.queued > 0 && c.status !== "cancelled" ? <Btn variant="ghost" disabled={pending} onClick={onStop} style={{ color: "var(--bad)" }}>Stop sending</Btn> : null}
              <Btn variant="sec" href={href({ id: c.id })}>See delivery</Btn>
              <Btn variant="pri" href="/messages">Back to messages</Btn>
            </div>
          </Card>
        </Section>
      </main>
    </VxPage>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <span className="num" style={{ fontSize: 24, fontWeight: 700, color: tone }}>{n}</span>
      <span style={{ fontSize: 12, color: "var(--mut)" }}>{label}</span>
    </span>
  );
}

/* ----------------------------------------------------------------- compose */

function Compose({
  data,
  preview,
  onStep,
  pending,
  start,
  onQueued,
}: {
  data: MessagesData;
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
  const [title, setTitle] = useState("");
  const [hi, setHi] = useState("");
  const [en, setEn] = useState("");
  const [focus, setFocus] = useState<"hi" | "en">("hi");

  const count = countFamilies(data.classSets, audience, classIds, data.staffCount);
  const cost = paiseToRupees(costPaise(count));
  const input = { kind: audience === "staff" ? ("staff" as const) : kind, title, hi, en, language, audience, classIds };
  const problems = composeProblems(input);
  const sample = audience === "staff" ? { parent: "Staff member", student: "", className: "" } : (data.sample ?? { parent: "Parent", student: "Student", className: "Class" });
  const rendered = composeText(input, { ...sample, date: dayMonth(new Date()) });
  const who = audience === "staff" ? `${count} staff` : audience === "school" ? `${count} parents · Whole school` : `${count} parents · ${classIds.length} ${classIds.length === 1 ? "class" : "classes"}`;

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

  const previewCard = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SecHead>{preview ? "What parents will see" : "Live preview"}</SecHead>
      <Card pad={false} style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "var(--nav, var(--pri))", color: "#fff" }}>
          <Avatar text="VP" seed="VP" size={32} bg="#fff" />
          <span style={{ display: "flex", flexDirection: "column" }}>
            <b>Shri Veer Patta School</b>
            <span style={{ fontSize: 12, opacity: 0.8 }}>Business account</span>
          </span>
        </div>
        <div style={{ padding: 12 }}>
          <WaBubble title={title || "Title"} lines={[rendered.hi, rendered.en].filter(Boolean).length ? [rendered.hi, rendered.en].filter(Boolean) : ["Your message appears here."]} />
        </div>
      </Card>
      <div style={{ fontSize: 12, color: "var(--mut)", textAlign: "center" }}>
        Shown as {sample.parent} sees it. Everyone gets their own name.
      </div>
    </div>
  );

  if (preview) {
    return (
      <VxPage>
        <TopBar crumb="Messages · New notice" title="Preview" mSub="Check, then queue" mBack={href({ compose: true })} actions={<Btn variant="ghost" icon="chevLeft" onClick={() => onStep("write")}>Back to edit</Btn>} />
        <main>
          <Section>
            {problems.length ? <Banner tone="warn">{tx(COMPOSE_PROBLEMS[problems[0]])}</Banner> : null}
            <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
              {previewCard}
              <Card>
                <CardHead title="Check before sending" />
                {[
                  ["Who", who],
                  ["Language", language === "both" ? "हिंदी + English" : language === "hi" ? "हिंदी" : "English"],
                  ["Kind", tx(KIND_LABELS[input.kind])],
                  ["Cost", `about ${rupees(cost)} · ₹0.88 a message`],
                  ["When", data.parentDispatchOn || audience === "staff" ? "Queued now" : "Queued now · goes out when parent sending is on"],
                ].map(([l, v]) => (
                  <div key={l} style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
                    <span style={{ width: 90, color: "var(--mut)" }}>{l}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
                {data.noPhone && audience !== "staff" ? <p style={{ fontSize: 13, color: "var(--mut)" }}>{data.noPhone} children have no usable WhatsApp number and are left out.</p> : null}
                <Btn variant="pri" big full icon="send" disabled={pending || problems.length > 0 || count === 0} onClick={queue} style={{ marginTop: 12 }}>
                  {pending ? "Queuing…" : `Queue for ${count} · ${rupees(cost)}`}
                </Btn>
              </Card>
            </div>
          </Section>
        </main>
      </VxPage>
    );
  }

  return (
    <VxPage>
      <TopBar crumb="Messages" title="New notice" mBack="/messages" actions={<Btn variant="ghost" icon="chevLeft" href="/messages">Back</Btn>} />
      <main>
        <Section>
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 20, alignItems: "start" }}>
            <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Who gets it">
                <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }} role="radiogroup">
                  <RadioCard checked={audience === "school"} onSelect={() => setAudience("school")} icon="home" title="Whole school" sub={`${data.classSets.length} parents`} />
                  <RadioCard checked={audience === "classes"} onSelect={() => setAudience("classes")} icon="grad" title="Classes" sub="Pick classes" />
                  <RadioCard checked={audience === "staff"} onSelect={() => setAudience("staff")} icon="briefcase" title="Staff" sub={`${data.staffCount} people`} />
                </div>
              </Field>
              {audience === "classes" ? (
                <ChipRow label="Classes" style={{ flexWrap: "wrap" }}>
                  {data.classes.map((c) => (
                    <Chip key={c.id} on={classIds.includes(c.id)} count={c.families} onClick={() => setClassIds((ids) => (ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id]))}>
                      {c.label}
                    </Chip>
                  ))}
                </ChipRow>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderRadius: 12, background: "var(--accs)", color: "var(--accfg)", fontWeight: 600 }}>
                <span><Ic n="users" size={16} /> {who}</span>
                <span className="num">about {rupees(cost)}</span>
              </div>
              {audience !== "staff" ? (
                <Field label="Kind">
                  <ChipRow label="Kind">
                    {NOTICE_KINDS.filter((k) => k !== "staff").map((k) => (
                      <Chip key={k} on={kind === k} icon={KIND_ICONS[k]} onClick={() => setKind(k)}>{tx(KIND_LABELS[k])}</Chip>
                    ))}
                  </ChipRow>
                </Field>
              ) : null}
              <Field label="Language">
                <Seg<NoticeLanguage>
                  label="Language"
                  value={language}
                  onChange={setLanguage}
                  options={[
                    { value: "both", label: "हिंदी + English" },
                    { value: "hi", label: "हिंदी" },
                    { value: "en", label: "English" },
                  ]}
                />
              </Field>
              <Field label="Title (bold first line)">
                <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Unit Test 2 datesheet" />
              </Field>
              {language !== "en" ? (
                <Field label={<Bi en="Message in Hindi" hi="हिंदी में संदेश" />} hint={`${hi.length} / ${MAX_BODY}`}>
                  <Textarea rows={4} value={hi} maxLength={MAX_BODY} lang="hi" onFocus={() => setFocus("hi")} onChange={(e) => setHi(e.target.value)} placeholder="प्रिय {parent}, …" />
                </Field>
              ) : null}
              {language !== "hi" ? (
                <Field label="Message in English" hint={`${en.length} / ${MAX_BODY}`}>
                  <Textarea rows={4} value={en} maxLength={MAX_BODY} onFocus={() => setFocus("en")} onChange={(e) => setEn(e.target.value)} placeholder="Dear {parent}, …" />
                </Field>
              ) : null}
              <Field label="Fills in for each parent">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {PLACEHOLDERS.map((t) => (
                    <button key={t} type="button" className="tap chip" onClick={() => insert(t)} style={{ fontFamily: "ui-monospace, monospace" }}>{t}</button>
                  ))}
                </div>
              </Field>
              <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>Attachments are not supported yet — put a link in the message instead.</p>
            </Card>
            <div className="unstick" style={{ position: "sticky", top: 84, display: "flex", flexDirection: "column", gap: 14 }}>
              {previewCard}
              {problems.length ? <div style={{ fontSize: 13, color: "var(--warnfg)" }}>{tx(COMPOSE_PROBLEMS[problems[0]])}</div> : null}
              <Btn variant="pri" big full icon="eye" disabled={problems.length > 0 || count === 0} onClick={() => onStep("preview")}>Preview and send</Btn>
            </div>
          </div>
        </Section>
      </main>
    </VxPage>
  );
}

/* --------------------------------------------------------------- templates */

function Templates({ templates, tabs, onNew }: { templates: TemplateView[]; tabs: React.ReactNode; onNew: () => void }) {
  const { tx } = useVx();
  return (
    <Section>
      <div className="only-m">{tabs}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--mut)" }}>WhatsApp checks every template once. After that it can be used any time.</span>
        <Btn variant="sec" icon="plus" onClick={onNew}>New template</Btn>
      </div>
      {templates.length === 0 ? <EmptyState icon="file" title="No templates" body="Add one to send notices through AiSensy." /> : null}
      <Grid cols={2}>
        {templates.map((t) => {
          const state = templateState(t);
          return (
            <Card key={t.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <b className="clip">{t.label}</b>
                  <span className="clip" style={{ fontSize: 12, color: "var(--mut)", fontFamily: "ui-monospace, monospace" }}>{t.code}</span>
                </span>
                <Pill tone={state === "approved" ? "ok" : state === "waiting" ? "warn" : "mut"}>{tx(TEMPLATE_STATE_LABELS[state])}</Pill>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Pill tone="mut">{t.audience === "parent" ? "Parents" : "Staff"}</Pill>
                {t.waCategory ? <Pill tone="info">{t.waCategory === "marketing" ? "Marketing" : "Utility"}</Pill> : null}
              </div>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap", color: "var(--fg2, var(--fg))" }} lang="hi">{t.bodyHi}</div>
              {t.bodyEn !== t.bodyHi ? <div style={{ fontSize: 13, whiteSpace: "pre-wrap", color: "var(--mut)" }}>{t.bodyEn}</div> : null}
            </Card>
          );
        })}
      </Grid>
    </Section>
  );
}

function TemplateSheet({ open, onClose, pending, onSave }: { open: boolean; onClose: () => void; pending: boolean; onSave: (input: { name: string; category: string; hi: string; en: string }) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"utility" | "marketing">("utility");
  const [hi, setHi] = useState("");
  const [en, setEn] = useState("");
  const [focus, setFocus] = useState<"hi" | "en">("hi");
  const slug = templateSlug(name);
  const insert = (token: string) => (focus === "hi" ? setHi((t) => `${t}${token}`) : setEn((t) => `${t}${token}`));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New template"
      sub="WhatsApp checks every template once. After that you can use it any time."
      icon="file"
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <Btn variant="sec" full onClick={onClose}>Cancel</Btn>
          <Btn variant="pri" full icon="upload" disabled={pending || !slug || (!hi.trim() && !en.trim())} onClick={() => onSave({ name, category, hi, en })}>Send for approval</Btn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label={`Name · ${slug || "template_name"}`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Unit test datesheet" />
        </Field>
        <Field label="Category">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="radiogroup">
            <RadioCard checked={category === "utility"} onSelect={() => setCategory("utility")} title="Utility" sub="Holidays, fees, results, PTMs. Approved faster — usually within an hour." />
            <RadioCard checked={category === "marketing"} onSelect={() => setCategory("marketing")} title="Marketing" sub="Greetings and admissions. Slower to approve." />
          </div>
        </Field>
        <Field label="Hindi text">
          <Textarea rows={3} lang="hi" value={hi} onFocus={() => setFocus("hi")} onChange={(e) => setHi(e.target.value)} placeholder="प्रिय {parent}, …" />
        </Field>
        <Field label="English text">
          <Textarea rows={3} value={en} onFocus={() => setFocus("en")} onChange={(e) => setEn(e.target.value)} placeholder="Dear {parent}, …" />
        </Field>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>Insert:</span>
          {["{parent}", "{student}", "{class}", "{date}", "{amount}"].map((t) => (
            <button key={t} type="button" className="tap chip" onClick={() => insert(t)} style={{ fontFamily: "ui-monospace, monospace" }}>{t}</button>
          ))}
        </div>
        <Banner tone="info">Tips for a quick yes: say who it is from, keep it to one purpose, and avoid offers or links in a Utility template.</Banner>
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
  tabs: React.ReactNode;
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
  const selected = replies.find((r) => r.id === selectedId) ?? null;
  const nameOf = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);

  const list = (
    <Section>
      <div className="only-m">{tabs}</div>
      <ChipRow label="Replies filter">
        {(["open", "unassigned", "done"] as ReplyFilter[]).map((f) => (
          <Chip key={f} on={filter === f} onClick={() => setFilter(f)} count={replies.filter((r) => matchesReply(r, f)).length}>
            {f === "open" ? "Open" : f === "unassigned" ? "Not assigned" : "Done"}
          </Chip>
        ))}
      </ChipRow>
      {shown.length === 0 ? <EmptyState icon="inbox" title="Nothing here" body="Replies from parents to a notice land here." /> : null}
      <Card pad={false} style={{ overflow: "hidden" }}>
        {shown.map((r, i) => (
          <div key={r.id} className={`row${r.id === selectedId ? " sel" : ""}`} style={{ display: "flex", gap: 12, padding: "14px 16px", borderTop: i ? "1px solid var(--bd)" : 0, alignItems: "flex-start" }}>
            <button type="button" className="tap" onClick={() => onSelect(r.id)} style={{ flex: 1, minWidth: 0, display: "flex", gap: 12, textAlign: "left", background: "none", border: 0, color: "inherit", padding: 0 }}>
              <Avatar text={initials(r.fromName)} seed={r.fromName} size={36} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <b className="clip">{r.fromName}</b>
                  <span style={{ fontSize: 12, color: "var(--mut)", flex: "none" }}>{tx(agoP(r.receivedAt))}</span>
                </span>
                {r.studentLabel ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{r.studentLabel}</span> : null}
                <span style={{ fontSize: 14 }}>{r.body}</span>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {r.regarding ? <Pill tone="mut">Re: {r.regarding}</Pill> : null}
                  {r.assignedStaffId ? <Pill tone="acc">{nameOf.get(r.assignedStaffId) ?? "Assigned"}</Pill> : <Pill tone="warn">Not assigned</Pill>}
                </span>
              </span>
            </button>
            <button type="button" className="tap icon-btn" aria-label={r.status === "done" ? "Open again" : "Mark done"} disabled={pending} onClick={() => onDone(r.id, r.status !== "done")} style={{ width: 40, height: 40, borderRadius: 20 }}>
              <Ic n={r.status === "done" ? "undo" : "checkCircle"} size={20} />
            </button>
          </div>
        ))}
      </Card>
    </Section>
  );

  const panel = selected ? (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Avatar text={initials(selected.fromName)} seed={selected.fromName} size={40} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <b>{selected.fromName}</b>
          <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{[selected.studentLabel, selected.phone].filter(Boolean).join(" · ")}</span>
        </span>
        {selected.studentId ? <Btn variant="ghost" href={`/students/${selected.studentId}`}>Open student</Btn> : null}
        <button type="button" className="tap icon-btn" aria-label="Close" onClick={() => onSelect(null)} style={{ width: 40, height: 40, borderRadius: 20 }}>
          <Ic n="x" size={18} />
        </button>
      </div>
      <Field label="Assigned to">
        <Select value={selected.assignedStaffId ?? ""} disabled={pending} onChange={(e) => onAssign(selected.id, e.target.value || null)}>
          <option value="">Not assigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </Field>
      <div style={{ background: "var(--wabg)", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {selected.campaignBody ? (
          <div style={{ alignSelf: "flex-end", maxWidth: "88%", background: "var(--wab)", color: "var(--wafg)", borderRadius: "14px 4px 14px 14px", padding: "8px 12px", fontSize: 13, whiteSpace: "pre-wrap" }}>
            <b>{selected.campaignTitle}</b>
            <div className="clip2">{selected.campaignBody.slice(0, 160)}{selected.campaignBody.length > 160 ? "…" : ""}</div>
          </div>
        ) : null}
        <div style={{ alignSelf: "flex-start", maxWidth: "88%", background: "var(--card)", borderRadius: "4px 14px 14px 14px", padding: "8px 12px", fontSize: 14 }}>
          {selected.body}
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--mut)" }}>{clock(selected.receivedAt)}</div>
        </div>
        {selected.answers.map((a) => (
          <div key={a.id} style={{ alignSelf: "flex-end", maxWidth: "88%", background: "var(--wab)", color: "var(--wafg)", borderRadius: "14px 4px 14px 14px", padding: "8px 12px", fontSize: 14, whiteSpace: "pre-wrap" }}>
            {a.body}
            <div style={{ textAlign: "right", fontSize: 11, opacity: 0.7 }}>{a.by ? `${a.by} · ` : ""}{clock(a.at)} · queued</div>
          </div>
        ))}
      </div>
      <SecHead>Quick replies</SecHead>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {QUICK_REPLIES.map((q) => (
          <button key={q.en} type="button" className="tap card" onClick={() => setDraft(quickReplyText(q))} style={{ textAlign: "left", padding: "10px 12px", fontSize: 13, border: "1px solid var(--bd)", color: "var(--fg)" }}>
            {q.hi} · {tx(q.en)}
          </button>
        ))}
      </div>
      <Field label="Your reply">
        <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a reply — Hindi first is best" />
      </Field>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn variant="pri" full icon="send" disabled={pending || !draft.trim()} onClick={() => onAnswer(selected.id, draft, () => setDraft(""))}>Queue reply · free</Btn>
        <Btn variant="sec" full icon={selected.status === "done" ? "undo" : "check"} disabled={pending} onClick={() => onDone(selected.id, selected.status !== "done")}>{selected.status === "done" ? "Open again" : "Mark done"}</Btn>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>A reply within 24 hours of their message is free on WhatsApp. It waits in the queue like every family message.</p>
    </div>
  ) : null;

  return <Split list={list} detail={panel} detailWidth={420} />;
}
