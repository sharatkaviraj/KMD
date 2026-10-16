"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { TopBar } from "@/vx/ui/page";
import { Btn, Pill, toneColors, type Tone } from "@/vx/ui/primitives";
import { coverDayLabel, INBOX_TYPES, inboxCounts, whenLabel, type InboxType } from "@/vx/screens/admin/logic";
import { TO } from "@/vx/screens/admin/ops-text";
import { T } from "@/vx/screens/admin/text";
import type { CoverCandidate, InboxItem } from "@/vx/screens/admin/types";
import { readEarlierInboxDecisions, readInboxDecisions, removeInboxDecision, storeInboxDecision, type InboxBeacon, type InboxScope, type PendingInboxDecision } from "@/vx/screens/admin/inbox-outbox";

/*
 * Needs you (design F02/D03). A decision is held on this device for a few
 * seconds before it is sent, so Undo really undoes: nothing has reached the
 * server yet. Leaving the page sends whatever is still held.
 *
 * On a desk it is the design's two panes (the list, the selected item); on a
 * phone every item is a card with its actions on it, under a large title.
 */

const HOLD_MS = 6000;

const TYPE_LABEL: Record<"all" | InboxType, Pair> = {
  all: T.tAll,
  attendance: T.tAttendance,
  money: T.tMoney,
  timetable: T.tTimetable,
  students: T.tStudents,
  system: T.tSystem,
};

const LOOK: Record<InboxItem["kind"], { icon: IconName; tone: Tone }> = {
  not_marked: { icon: "calCheck", tone: "warn" },
  cover: { icon: "swap", tone: "info" },
  // The design tints a tag by its type: Students items are grey.
  submission: { icon: "alert", tone: "mut" },
  confirmations: { icon: "ticks", tone: "mut" },
  refund: { icon: "rupee", tone: "acc" },
  job: { icon: "alert", tone: "bad" },
};

/** What `/api/inbox` needs to send a held decision after the page has gone. */
type Beacon = InboxBeacon;
type Held = PendingInboxDecision & { timer: number; send: () => Promise<{ ok: boolean; message?: Pair }>; label: string; sending: boolean; flushing: boolean };

export function InboxScreen({ items, initial, previewing, unavailable, scope, taskPanel }: { items: InboxItem[]; initial: string | null; previewing: boolean; unavailable: boolean; scope: InboxScope; taskPanel?:ReactNode }) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | InboxType>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initial ?? items[0]?.id ?? null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<InboxItem | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [earlier, setEarlier] = useState<PendingInboxDecision[]>([]);
  const held = useRef(new Map<string, Held>());

  const live = items.filter((item) => !hidden.has(item.id));
  const counts = inboxCounts(live);
  const shown = filter === "all" ? live : live.filter((item) => item.type === filter);
  const selected = live.find((item) => item.id === selectedId) ?? shown[0] ?? null;

  function acknowledge(id: string, entry: Held) {
    if (held.current.get(id) !== entry) return;
    try { removeInboxDecision(entry); } catch { /* A replay remains safe with the same id. */ }
    held.current.delete(id); setPendingCount(held.current.size);
  }
  function stillStored(id: string, entry: Held): boolean {
    if (held.current.get(id) !== entry) return false;
    const saved = readInboxDecisions(entry.scope).find(d => d.itemId === id && d.beacon.commandId === entry.beacon.commandId);
    if (saved && JSON.stringify(saved.beacon) === JSON.stringify(entry.beacon)) return true;
    window.clearTimeout(entry.timer); held.current.delete(id); setPendingCount(held.current.size);
    setHidden(all => { const next = new Set(all); next.delete(id); return next; });
    return false;
  }
  async function deliver(id: string, entry: Held) {
    if (entry.sending || entry.flushing || previewing || (!entry.attempted && Date.now() < entry.readyAt)) return;
    try { if (!stillStored(id, entry)) return; }
    catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); return; }
    entry.attempted = true;
    try { storeInboxDecision(entry); } catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); return; }
    entry.sending = true;
    const result = await entry.send().catch(() => ({ ok: false, message: T.failed }));
    entry.sending = false;
    if (result.ok) acknowledge(id, entry);
    else {
      setHidden(all => { const next = new Set(all); next.delete(id); return next; });
      toast.show({ text: tx(result.message ?? T.failed), tone: "bad" });
    }
    router.refresh();
  }

  // Send anything still held when the page goes away; the person decided it.
  useEffect(() => {
    const pending = held.current;
    pending.clear();
    const post = async (entry: PendingInboxDecision, keepalive = false) => {
      const response = await fetch("/api/inbox", { method: "POST", keepalive, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...entry.beacon, scope: entry.scope }) });
      return { ok: response.ok && (await response.json()).ok === true };
    };
    const restore = () => {
      if (previewing) return;
      try {
        const saved = readInboxDecisions(scope);
        setEarlier(readEarlierInboxDecisions(scope));
        const ids = new Set(saved.map(d => d.itemId));
        for (const [id, entry] of pending) if (!ids.has(id) && !entry.sending) {
          window.clearTimeout(entry.timer); pending.delete(id);
          setHidden(all => { const next = new Set(all); next.delete(id); return next; });
        }
        for (const d of saved) if (!pending.has(d.itemId)) {
          const entry: Held = { ...d, timer: 0, label: "", send: () => post(d), sending: false, flushing: false };
          pending.set(d.itemId, entry);
          entry.timer = window.setTimeout(() => { void deliver(d.itemId, entry); }, Math.max(0, d.readyAt - Date.now()));
        }
        setPendingCount(pending.size);
      } catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); }
    };
    restore();
    // A server action started here is cancelled with the page, so the held
    // decision goes as a keepalive request that outlives it.
    const flush = () => {
      for (const [id, entry] of pending) {
        if (entry.flushing) continue;
        try { if (!stillStored(id, entry)) continue; } catch { continue; }
        entry.attempted = true;
        try { storeInboxDecision(entry); } catch { continue; }
        window.clearTimeout(entry.timer);
        entry.sending = true;
        entry.flushing = true;
        void post(entry, true)
          .then((response) => {
            if (response.ok) acknowledge(id, entry);
          })
          .catch(() => undefined)
          .finally(() => { entry.flushing = false; entry.sending = false; });
      }
    };
    window.addEventListener("pagehide", flush);
    const retry = () => { for (const [id, entry] of pending) void deliver(id, entry); };
    window.addEventListener("online", retry);
    window.addEventListener("storage", restore);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", retry);
      window.removeEventListener("storage", restore);
      flush();
    };
  // Scope comes from the authenticated server page; old-account work is never replayed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.accountId, scope.sessionLabel, scope.day, previewing]);

  function handleDecision(item: InboxItem, label: string, beacon: Beacon) {
    if (previewing) {
      toast.show({ text: tx(T.previewing), tone: "info" });
      return;
    }
    if (held.current.has(item.id)) { toast.show({ text: tx(T.inboxPending), tone: "info" }); return; }
    // Called only by Detail's click handlers; the forwarded actions object
    // prevents the compiler from recognizing this as an event-time timestamp.
    // eslint-disable-next-line react-hooks/purity
    const decision: PendingInboxDecision = { itemId: item.id, beacon, scope, readyAt: Date.now() + HOLD_MS, attempted: false };
    try { storeInboxDecision(decision); } catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); return; }
    setHidden((all) => new Set(all).add(item.id));
    const next = live.find((other) => other.id !== item.id && (filter === "all" || other.type === filter));
    setSelectedId(next?.id ?? null);

    const timer = window.setTimeout(async () => {
      const entry = held.current.get(item.id);
      if (!entry) return;
      await deliver(item.id, entry);
    }, HOLD_MS);
    const send = async () => {
      const response = await fetch("/api/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...beacon, scope }) });
      return { ok: response.ok && (await response.json()).ok === true };
    };
    held.current.set(item.id, { ...decision, timer, send, label, sending: false, flushing: false });
    setPendingCount(held.current.size);

    toast.show({
      text: label,
      undoLabel: tx(T.undo),
      ms: HOLD_MS,
      undo: () => {
        const entry = held.current.get(item.id);
        if (!entry || entry.sending || entry.attempted) return;
        try { removeInboxDecision(entry); } catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); return; }
        window.clearTimeout(entry.timer);
        held.current.delete(item.id);
        setPendingCount(held.current.size);
        setHidden((all) => {
          const copy = new Set(all);
          copy.delete(item.id);
          return copy;
        });
        setSelectedId(item.id);
      },
    });
  }

  function select(item: InboxItem) {
    setSelectedId(item.id);
  }

  const assign = (item: InboxItem, who: CoverCandidate) => {
    const commandId = crypto.randomUUID();
    const input = { commandId, needKey: item.needKey!, coveringStaffId: who.id, day: item.day!, dayRevision: item.dayRevision! };
    handleDecision(item, `${tx(T.assigned(who.name))}`, { kind: "cover", ...input });
  };

  const on: DetailActions = {
    remind: (item) =>
      handleDecision(item, tx(T.reminded(item.remindable ?? 0)), { kind: "remind", commandId: crypto.randomUUID(), classIds: item.classIds ?? [] }),
    assign,
    pick: (item) => setPicking(item),
    submissions: (item, accept) => {
      const commandId = crypto.randomUUID();
      handleDecision(item, `${tx(accept ? T.accepted : T.declined)} · ${tx(item.title)}`, { kind: "submissions", commandId, submissionIds: item.submissionIds ?? [], accept });
    },
  };

  const chips = (["all", ...INBOX_TYPES] as const)
    .filter((key) => key === "all" || counts[key] > 0)
    .map((key) => (
      <button key={key} type="button" className={`tap chip${filter === key ? " on" : ""}`} aria-pressed={filter === key ? "true" : "false"} onClick={() => setFilter(key)}>
        {tx(TYPE_LABEL[key])}
        <span className="num" style={{ opacity: 0.7 }}>{counts[key]}</span>
      </button>
    ));

  // Recovery notices: decisions kept on this device from an earlier visit, or still waiting for the server.
  const hasNotices = unavailable || (!previewing && earlier.length > 0) || pendingCount > 0;
  const notices = hasNotices ? (
    <>
      {unavailable ? <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--warnfg)", background: "var(--warns)", padding: "8px 12px", borderRadius: 12 }}>{tx(T.couldNotRead)}</p> : null}
      {!previewing && earlier.length > 0 ? (
        <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          <strong>{tx(T.inboxEarlier)} ({earlier.length})</strong>
          <span style={{ color: "var(--mut)" }}>{tx(T.inboxEarlierHint)}</span>
          <Btn variant="ghost" style={{ alignSelf: "flex-start" }} onClick={() => {
            try { for (const entry of earlier) removeInboxDecision(entry); setEarlier(readEarlierInboxDecisions(scope)); }
            catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); }
          }}>{tx(T.inboxClearReviewed)}</Btn>
        </div>
      ) : null}
      {pendingCount > 0 ? (
        <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          <span>{tx(T.inboxPending)}</span>
          <Btn variant="ghost" style={{ alignSelf: "flex-start" }} onClick={() => { for (const [id, entry] of held.current) void deliver(id, entry); }}>{tx(T.inboxRetry)}</Btn>
        </div>
      ) : null}
    </>
  ) : null;

  const oldest = live.reduce<string | null>((min, item) => (item.at && (!min || item.at < min) ? item.at : min), null);
  const waiting = tx(TO.waiting(live.length, oldest ? dayMonth(oldest) : null));

  /* ---- desk (D03): the list and the selected item side by side ---- */
  const desk = (
    <div className="only-d" style={{ display: "grid", gridTemplateColumns: "400px minmax(0, 1fr)", minHeight: "calc(100dvh - 64px)" }}>
      <div style={{ minWidth: 0, borderRight: "1px solid var(--bd)", display: "flex", flexDirection: "column" }}>
        <div className="glass" role="group" aria-label={tx(TO.filterByType)} style={{ position: "sticky", top: 64, zIndex: 2, padding: "16px 16px 12px", display: "flex", flexWrap: "wrap", gap: 6, borderBottom: "1px solid var(--bd)" }}>
          {chips}
        </div>
        {notices ? <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid var(--bd)" }}>{notices}</div> : null}
        {shown.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--mut)", fontSize: 14 }}>{tx(live.length === 0 ? TO.allClearSub : TO.nothingInFilter)}</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map((item, i) => {
              const sel = selected?.id === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => select(item)}
                    className="tap"
                    aria-current={sel ? "true" : undefined}
                    style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px", border: 0, borderBottom: "1px solid var(--bd)", background: sel ? "var(--accs)" : "transparent", boxShadow: sel ? "inset 0 0 0 1px var(--acc)" : "none", color: "var(--fg)", textAlign: "left", overflow: "hidden", animation: `xIn .4s var(--ease) ${Math.min(i * 40, 400)}ms both` }}
                  >
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
                      <Tag item={item} size="s" />
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{item.kind === "cover" && item.day ? tx(coverDayLabel(item.day)) : whenLabel(item.at)}</span>
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{tx(item.title)}</span>
                    <span className="clip" style={{ fontSize: 13, color: "var(--mut)", width: "100%" }}>{tx(item.sub)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div style={{ position: "sticky", top: 64, alignSelf: "start", height: "calc(100dvh - 64px)", overflowY: "auto", minWidth: 0 }}>
        {selected ? <Detail key={selected.id} item={selected} on={on} /> : <AllClear big />}
      </div>
    </div>
  );

  /* ---- phone (F02): the title over the chips, each item a card with its actions ---- */
  const phone = (
    <div className="only-m">
      <div className="glass" style={{ position: "sticky", top: 0, zIndex: 5, padding: "14px 18px 10px", display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid var(--bd)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <h1 className="serif" style={{ margin: 0, fontSize: 30, fontWeight: 600 }}>{tx(T.needsYou)}</h1>
          <span className="num clip" style={{ fontSize: 13, color: "var(--mut)" }}>{waiting}</span>
        </div>
        <div className="hs" role="group" aria-label={tx(TO.filterByType)} style={{ display: "flex", gap: 8, margin: "0 -18px", padding: "0 18px 2px" }}>
          {chips}
        </div>
      </div>
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {notices}
        {shown.length === 0 ? <AllClear /> : shown.map((item, i) => <PhoneCard key={item.id} item={item} on={on} delay={Math.min(i * 40, 400)} />)}
      </div>
    </div>
  );

  return (
    <>
      {/* The desk's bar; on a phone the design draws a large title instead (above). */}
      <div className="only-d" style={{ display: "contents" }}>
        <TopBar crumb={tx(T.inboxCrumb(live.length))} title={tx(T.needsYou)} />
      </div>
      <div className="vx-pmain">
        {taskPanel}
        {desk}
        {phone}
      </div>
      <Sheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        title={tx(T.pickAnother)}
        sub={picking ? tx(picking.title) : undefined}
        icon="users"
      >
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {(picking?.candidates ?? []).map((who) => (
            <li key={who.id}>
              <button
                type="button"
                className="row tap"
                disabled={!who.free}
                onClick={() => {
                  const item = picking!;
                  setPicking(null);
                  assign(item, who);
                }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", border: 0, borderTop: "1px solid var(--bd)", background: "transparent", color: "var(--fg)", textAlign: "left", opacity: who.free ? 1 : 0.55 }}
              >
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <strong>{who.name}</strong>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>{who.detail}</span>
                </span>
                {who.free ? <Ic n="chevRight" size={18} /> : <Pill tone="mut">{tx(T.busy)}</Pill>}
              </button>
            </li>
          ))}
        </ul>
        {picking && (picking.candidates ?? []).length === 0 ? <p style={{ color: "var(--mut)" }}>{tx(T.nobodyFree)}</p> : null}
      </Sheet>
    </>
  );
}

type DetailActions = {
  remind: (item: InboxItem) => void;
  assign: (item: InboxItem, who: CoverCandidate) => void;
  pick: (item: InboxItem) => void;
  submissions: (item: InboxItem, accept: boolean) => void;
};

/** "5 Oct", for the phone's "oldest" line. */
function dayMonth(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(new Date(iso));
}

/** The item's kind as the design's tag: tinted by type, with its icon. */
function Tag({ item, size }: { item: InboxItem; size: "s" | "m" | "l" }) {
  const { tx } = useVx();
  const look = LOOK[item.kind];
  const c = toneColors(look.tone);
  const d = size === "s" ? { h: 22, pad: "0 8px", fs: 11, ic: 13 } : size === "m" ? { h: 26, pad: "0 10px", fs: 12, ic: 14 } : { h: 28, pad: "0 12px", fs: 12, ic: 14 };
  return (
    <span className="pill" style={{ height: d.h, padding: d.pad, fontSize: d.fs, background: c.bg, color: c.fg }}>
      <Ic n={look.icon} size={d.ic} />
      {tx(item.badge)}
    </span>
  );
}

/** Nothing waiting: the design's drawn tick. */
function AllClear({ big }: { big?: boolean }) {
  const { tx } = useVx();
  const size = big ? 96 : 88;
  return (
    <div className="fadein" style={{ padding: big ? "0 20px" : "60px 20px", height: big ? "100%" : undefined, minHeight: big ? 420 : undefined, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center" }}>
      <svg width={size} height={size} viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r="40" style={{ fill: "var(--oks)" }} />
        <path d="M27 45l11 11 23-24" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: 56, strokeDasharray: 56, animation: "xDraw .5s .15s var(--ease) both" }} />
      </svg>
      <span className="serif" style={{ fontSize: big ? 28 : 24, fontWeight: 600 }}>{tx(TO.allClear)}</span>
      <span style={{ fontSize: big ? 15 : 14, color: "var(--mut)" }}>{tx(TO.allClearSub)}</span>
    </div>
  );
}

const DECLINE: React.CSSProperties = { color: "var(--bad)" };

/** One item on the phone: what it is, what it needs, and its actions on the card (F02). */
function PhoneCard({ item, on, delay }: { item: InboxItem; on: DetailActions; delay: number }) {
  const { tx } = useVx();
  const best = item.candidates?.find((c) => c.free) ?? null;
  const classes = item.kind === "not_marked" ? item.facts[0]?.value : undefined;
  const body = item.kind === "not_marked" && classes ? TO.notMarkedCard(classes) : (item.body ?? item.sub);

  let actions: React.ReactNode = null;
  switch (item.kind) {
    case "not_marked":
      actions = (item.remindable ?? 0) > 0 ? (
        <>
          <Btn variant="pri" onClick={() => on.remind(item)}>{tx(TO.remindOnWhatsApp)}</Btn>
          <Btn href={item.href}>{tx(TO.openBoard)}</Btn>
        </>
      ) : (
        <Btn variant="pri" href={item.href}>{tx(TO.openBoard)}</Btn>
      );
      break;
    case "cover":
      actions = (
        <>
          {best ? <Btn variant="pri" onClick={() => on.assign(item, best)}>{tx(T.assignName(best.name))}</Btn> : null}
          <Btn variant={best ? "sec" : "pri"} onClick={() => on.pick(item)}>{tx(TO.otherTeacher)}</Btn>
        </>
      );
      break;
    case "submission":
      actions = (
        <>
          <Btn variant="pri" onClick={() => on.submissions(item, true)}>{tx(T.accept)}</Btn>
          <Btn style={DECLINE} onClick={() => on.submissions(item, false)}>{tx(T.decline)}</Btn>
        </>
      );
      break;
    case "confirmations":
      actions = (
        <>
          <Btn variant="pri" onClick={() => on.submissions(item, true)}>{tx(T.accept)}</Btn>
          <Btn href={item.href}>{tx(T.openReview)}</Btn>
        </>
      );
      break;
    case "refund":
      actions = <Btn variant="pri" href={item.href}>{tx(T.review)}</Btn>;
      break;
    case "job":
      actions = <Btn variant="pri" href={item.href}>{tx(T.openJobs)}</Btn>;
      break;
  }

  return (
    <article className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, overflow: "hidden", animation: `xRise .44s var(--ease) ${delay}ms both` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Tag item={item} size="m" />
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{item.kind === "cover" && item.day ? tx(coverDayLabel(item.day)) : whenLabel(item.at)}</span>
      </div>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{tx(item.title)}</h2>
      <p style={{ margin: 0, fontSize: 14, color: "var(--mut)", lineHeight: 1.45 }}>{tx(body)}</p>
      {item.kind === "cover" && !best ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.nobodyFree)}</span> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>{actions}</div>
    </article>
  );
}

/** The desk's buttons are a size up from the kit's (D03). */
const BIG: React.CSSProperties = { height: 44, padding: "0 20px", fontSize: 15 };
const QUIET: React.CSSProperties = { height: 44, color: "var(--mut)" };

function Detail({ item, on }: { item: InboxItem; on: DetailActions }) {
  const onRemind = () => on.remind(item);
  const onAssign = (who: CoverCandidate) => on.assign(item, who);
  const onPick = () => on.pick(item);
  const onSubmissions = (accept: boolean) => on.submissions(item, accept);
  const { tx } = useVx();
  const best = item.candidates?.find((c) => c.free) ?? null;

  let actions: React.ReactNode = null;
  switch (item.kind) {
    case "not_marked":
      actions = (
        <>
          {(item.remindable ?? 0) > 0 ? (
            <Btn variant="pri" style={BIG} onClick={onRemind}>{tx(TO.remindNOnWhatsApp(item.remindable ?? 0))}</Btn>
          ) : (
            <span style={{ fontSize: 14, color: "var(--mut)" }}>{tx(T.nobodyToRemind)}</span>
          )}
          <Btn style={BIG} href={item.href}>{tx(TO.openAttendance)}</Btn>
        </>
      );
      break;
    case "cover":
      actions = (
        <>
          {best ? <Btn variant="pri" style={BIG} onClick={() => onAssign(best)}>{tx(T.assignName(best.name))}</Btn> : <span style={{ color: "var(--mut)" }}>{tx(T.nobodyFree)}</span>}
          <Btn style={BIG} onClick={onPick}>{tx(T.pickAnother)}</Btn>
          <Btn variant="ghost" icon="clock" style={QUIET} href={item.href}>{tx(T.openCover)}</Btn>
        </>
      );
      break;
    case "submission":
    case "confirmations":
      actions = (
        <>
          <Btn variant="pri" style={BIG} onClick={() => onSubmissions(true)}>{tx(T.accept)}</Btn>
          {item.kind === "submission" ? <Btn style={{ ...BIG, ...DECLINE }} onClick={() => onSubmissions(false)}>{tx(T.decline)}</Btn> : null}
          <Btn variant="ghost" style={QUIET} href={item.href}>{tx(T.openReview)}</Btn>
        </>
      );
      break;
    case "refund":
      actions = <Btn variant="pri" style={BIG} href={item.href}>{tx(T.review)}</Btn>;
      break;
    case "job":
      actions = <Btn variant="pri" style={BIG} href={item.href}>{tx(T.openJobs)}</Btn>;
      break;
  }

  return (
    <article style={{ maxWidth: 760, padding: "32px 40px 48px", display: "flex", flexDirection: "column", gap: 18, animation: "xIn .3s var(--ease) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Tag item={item} size="l" />
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{item.kind === "cover" && item.day ? tx(coverDayLabel(item.day)) : whenLabel(item.at)}</span>
      </div>
      <h2 className="serif" style={{ margin: 0, fontSize: 32, fontWeight: 600, lineHeight: 1.15 }}>{tx(item.title)}</h2>
      {item.body ? <p style={{ margin: 0, color: "var(--mut)", fontSize: 16, lineHeight: 1.6 }}>{tx(item.body)}</p> : null}
      {item.facts.length ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <dl style={{ margin: 0 }}>
            {item.facts.map((fact, i) => (
              <div key={`${fact.label.en}-${i}`} style={{ display: "grid", gridTemplateColumns: "160px minmax(0,1fr)", gap: 16, padding: "12px 18px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <dt style={{ color: "var(--mut)", fontSize: 13 }}>{tx(fact.label)}</dt>
                <dd style={{ margin: 0, fontWeight: 600, fontSize: 14, overflowWrap: "anywhere" }}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>{actions}</div>
      {item.footnote ? <span style={{ fontSize: 13, color: "var(--mut)", lineHeight: 1.55 }}>{tx(item.footnote)}</span> : null}
    </article>
  );
}
