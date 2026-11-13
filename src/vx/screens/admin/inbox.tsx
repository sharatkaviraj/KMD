"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode, type RefObject } from "react";

import { decideParentSuggestionsAction, undoParentSuggestionsAction } from "@/app/(app)/inbox/parent-actions";
import { decideLeaveAction } from "@/app/(app)/timetable/vx-actions";
import { SUGGESTION_WORDS as SW, type RegisterMark } from "@/modules/whatsapp/domain/parent-suggestion-words";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";

import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { TopBar } from "@/vx/ui/page";
import { Btn, Pill, toneColors, type Tone } from "@/vx/ui/primitives";
import { CouldNotRead } from "@/vx/ui/read-state";
import { SAVE_IDLE, SAVE_WORDS, SaveStatus, type SaveState } from "@/vx/ui/save-status";
import { InboxBatch } from "@/vx/screens/admin/inbox-batch";
import { ParentBody, ParentButtons, ParentMarkAll, type ParentDecide } from "@/vx/screens/admin/inbox-parent";
import { FeesRefundActions } from "@/vx/screens/receipts/office-command";
import { coverDayLabel, INBOX_TYPES, inboxCounts, whenLabelP, type InboxType } from "@/vx/screens/admin/logic";
import { TO } from "@/vx/screens/admin/ops-text";
import { T } from "@/vx/screens/admin/text";
import type { CoverCandidate, InboxItem } from "@/vx/screens/admin/types";
import { readEarlierInboxDecisions, readInboxDecisions, removeInboxDecision, storeInboxDecision, type InboxBeacon, type InboxScope, type PendingInboxDecision } from "@/vx/screens/admin/inbox-outbox";

/*
 * Needs you (design F02/D03). A decision is held on this device for a few
 * seconds before it is sent, so Undo really undoes: nothing has reached the
 * server yet. Leaving the page sends whatever is still held.
 *
 * It never looks done before the server says so (review N02): a held or
 * sending decision stays in the list, dimmed, with "Will send in a moment ·
 * Undo" and then "Sending…" in place of its buttons, and no tick. Only the
 * server's answer gives it the tick, and it leaves the list after that. A
 * failure keeps it with its buttons, the reason and Try again.
 *
 * On a desk it is the design's two panes (the list, the selected item); on a
 * phone every item is a card with its actions on it, under a large title.
 */

const HOLD_MS = 6000;
/** A confirmed decision shows its tick this long, then leaves the list in LEAVE_MS. */
const SAVED_MS = 900;
const LEAVE_MS = 450;

const W = {
  failedWhy: p("No answer, or the server did not take it. Nothing is assumed saved.", "जवाब नहीं मिला, या सर्वर ने नहीं लिया। कुछ भी सहेजा हुआ नहीं माना गया।"),
  failedNext: p("Try again sends the same decision once more, so it is never saved twice. Or reload to see where it stands.", "फिर कोशिश करने पर वही निर्णय दोबारा जाता है, इसलिए दो बार नहीं सहेजा जाता। या पेज फिर खोलकर देखें कि क्या हुआ।"),
};
/** A decision is sent, not saved, from the person's point of view. */
const SAVE_LINE = { saving: SAVE_WORDS.sending };

/** One item's save line; `retry` when Try again re-sends the same held decision. */
type ItemSave = { state: SaveState; retry?: boolean };

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
  leave: { icon: "calendar", tone: "info" },
  parent: { icon: "message", tone: "ok" },
};

/** What `/api/inbox` needs to send a held decision after the page has gone. */
type Beacon = InboxBeacon;
type Held = PendingInboxDecision & { timer: number; send: () => Promise<{ ok: boolean; message?: Pair }>; label: string; sending: boolean; flushing: boolean };

export function InboxScreen({ items, initial, previewing, unavailable, scope, taskPanel, taskActions, taskDetail, views }: {
  items: InboxItem[]; initial: string | null; previewing: boolean; unavailable: boolean; scope: InboxScope;
  /** The two halves of Needs you (D-520): decisions here, teachers' work beside them. */
  views?: ReactNode;
  /** Teacher work: below the queue, never above the title. */
  taskPanel?: ReactNode;
  /** The desk's top-bar buttons; the phone carries them in `taskPanel`. */
  taskActions?: ReactNode;
  /** A `?task=` opened over the page. */
  taskDetail?: ReactNode;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | InboxType>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initial ?? items[0]?.id ?? null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<InboxItem | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [earlier, setEarlier] = useState<PendingInboxDecision[]>([]);
  // What each decided item shows until the server answers (N02), and the ones leaving after it did.
  const [saves, setSaves] = useState<ReadonlyMap<string, ItemSave>>(new Map());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  // The item lines are drawn, not announced (a desk row is a button); this one line says each change aloud.
  const [announce, setAnnounce] = useState<SaveState>(SAVE_IDLE);
  const held = useRef(new Map<string, Held>());
  const test = isTestSessionLabel(scope.sessionLabel);
  // A decision flushed as the page goes is confirmed after it has gone: nothing is left to re-read then.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const live = items.filter((item) => !hidden.has(item.id));
  const counts = inboxCounts(live);
  const shown = filter === "all" ? live : live.filter((item) => item.type === filter);
  const selected = live.find((item) => item.id === selectedId) ?? shown[0] ?? null;

  function mark(id: string, next: ItemSave | null) {
    setSaves((all) => {
      const copy = new Map(all);
      if (next) copy.set(id, next);
      else copy.delete(id);
      return copy;
    });
  }
  const failed = (retry: boolean, message: Pair = W.failedWhy): ItemSave => {
    // The toast says it aloud; the live line must not go on reading "Sending…".
    setAnnounce(SAVE_IDLE);
    return { state: { kind: "failed", message, next: retry ? W.failedNext : undefined }, retry };
  };
  // The server has it: the tick, a moment to see it, then a gentle exit. Several at once re-read the page once.
  function confirmed(...ids: string[]) {
    for (const id of ids) mark(id, { state: { kind: "saved" } });
    setAnnounce({ kind: "saved" });
    window.setTimeout(() => setLeaving((all) => new Set([...all, ...ids])), SAVED_MS);
    window.setTimeout(() => {
      if (!alive.current) return;
      setHidden((all) => new Set([...all, ...ids]));
      setLeaving((all) => { const next = new Set(all); for (const id of ids) next.delete(id); return next; });
      for (const id of ids) mark(id, null);
      setAnnounce({ kind: "removed" });
      router.refresh();
    }, SAVED_MS + LEAVE_MS);
  }
  function markSending(id: string) {
    mark(id, { state: { kind: "saving" } });
    setAnnounce({ kind: "saving" });
  }

  function acknowledge(id: string, entry: Held) {
    if (held.current.get(id) !== entry) return;
    try { removeInboxDecision(entry); } catch { /* A replay remains safe with the same id. */ }
    held.current.delete(id); setPendingCount(held.current.size);
    confirmed(id);
  }
  function stillStored(id: string, entry: Held): boolean {
    if (held.current.get(id) !== entry) return false;
    const saved = readInboxDecisions(entry.scope).find(d => d.itemId === id && d.beacon.commandId === entry.beacon.commandId);
    if (saved && JSON.stringify(saved.beacon) === JSON.stringify(entry.beacon)) return true;
    window.clearTimeout(entry.timer); held.current.delete(id); setPendingCount(held.current.size);
    mark(id, null);
    return false;
  }
  async function deliver(id: string, entry: Held) {
    // Called from timers, events and the Try again button, never while rendering; like
    // handleDecision, the forwarded actions object hides that from the compiler.
    // eslint-disable-next-line react-hooks/purity
    if (entry.sending || entry.flushing || previewing || (!entry.attempted && Date.now() < entry.readyAt)) return;
    try { if (!stillStored(id, entry)) return; }
    catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); return; }
    entry.attempted = true;
    try { storeInboxDecision(entry); } catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); mark(id, failed(true, T.inboxStorageFailed)); return; }
    entry.sending = true;
    markSending(id);
    const result = await entry.send().catch(() => ({ ok: false, message: T.failed }));
    entry.sending = false;
    // Confirmed: the item leaves after its tick, and the page is re-read then.
    if (result.ok) { acknowledge(id, entry); return; }
    mark(id, failed(true));
    toast.show({ text: tx(result.message ?? T.failed), tone: "bad" });
    router.refresh();
  }
  function undoDecision(id: string) {
    const entry = held.current.get(id);
    if (!entry || entry.sending || entry.attempted) return;
    try { removeInboxDecision(entry); } catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); return; }
    window.clearTimeout(entry.timer);
    held.current.delete(id);
    setPendingCount(held.current.size);
    mark(id, null);
    setSelectedId(id);
  }
  // The same held decision, with the same command: the server replays it rather than deciding twice.
  function retryDecision(id: string) {
    const entry = held.current.get(id);
    if (entry) void deliver(id, entry);
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
          mark(id, null);
        }
        for (const d of saved) if (!pending.has(d.itemId)) {
          const entry: Held = { ...d, timer: 0, label: "", send: () => post(d), sending: false, flushing: false };
          pending.set(d.itemId, entry);
          // Kept from before: still waiting, never shown as done. Only an untried one can be undone.
          mark(d.itemId, { state: { kind: d.attempted ? "saving" : "held" } });
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
        mark(id, { state: { kind: "saving" } });
        void post(entry, true)
          .then((response) => {
            if (response.ok) acknowledge(id, entry);
            else mark(id, failed(true));
          })
          .catch(() => mark(id, failed(true)))
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
    // It stays in the list, waiting; the selection moves on so triage keeps its pace.
    mark(item.id, { state: { kind: "held" } });
    const next = shown.find((other) => other.id !== item.id && !saves.has(other.id) && !held.current.has(other.id));
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

    // Not a success toast: no tick, and it says the decision has not gone yet.
    toast.show({
      text: `${label} · ${tx(SAVE_WORDS.held)}`,
      tone: "info",
      undoLabel: tx(T.undo),
      ms: HOLD_MS,
      undo: () => undoDecision(item.id),
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

  const [deciding, startDeciding] = useTransition();
  // Leave is decided at once, not held: the answer says how many periods have a teacher.
  const decideLeave = (item: InboxItem, approve: boolean) => {
    if (previewing) {
      toast.show({ text: tx(T.previewing), tone: "info" });
      return;
    }
    if (!item.leaveId || deciding) return;
    const id = item.leaveId;
    startDeciding(async () => {
      markSending(item.id);
      try {
        const result = await decideLeaveAction({ id, approve });
        toast.show({ text: tx(result.message), tone: result.ok && !result.coverDay ? "ok" : "bad" });
        if (result.ok && result.coverDay) {
          setHidden((all) => new Set(all).add(item.id));
          mark(item.id, null);
          router.push(`/timetable?view=subs&day=${result.coverDay}`);
        } else if (result.ok) confirmed(item.id);
        // Refused: the buttons stay, with the server's reason; deciding again is the retry.
        else mark(item.id, failed(false, result.message));
      } catch {
        toast.show({ text: tx(T.failed), tone: "bad" });
        mark(item.id, failed(false));
      }
    });
  };

  // Undone, a suggestion waits again as a new item (its id carries when): the page shows it as the server has it now.
  const undoParent = async (ids: string[]) => {
    try {
      const result = await undoParentSuggestionsAction({ ids });
      toast.show({ text: tx(result.message), tone: result.ok ? "info" : "bad" });
    } catch {
      toast.show({ text: tx(T.failed), tone: "bad" });
    }
    router.refresh();
  };

  // A parent's suggestion is decided at once, like leave (D-598): nothing to hold, because the toast's Undo takes it back.
  const decideParent: ParentDecide = (chosen, decision, registerMark?: RegisterMark) => {
    if (previewing) {
      toast.show({ text: tx(T.previewing), tone: "info" });
      return;
    }
    const open = chosen.filter((item) => item.parent && (!saves.has(item.id) || saves.get(item.id)?.state.kind === "failed"));
    if (open.length === 0 || deciding) return;
    const ids = open.map((item) => item.parent!.suggestionId);
    const first = open[0].parent!;
    startDeciding(async () => {
      for (const item of open) markSending(item.id);
      try {
        const result = await decideParentSuggestionsAction({ ids, decision, mark: registerMark, via: "needs_you", kind: first.kind, childName: open.length === 1 ? first.childName : null });
        const decided = result.ok ? open.filter((item) => result.decided.includes(item.parent!.suggestionId)) : [];
        // Each one refused keeps its buttons, with the server's reason under them.
        const refused = new Map(result.refused.map((one) => [one.id, one.message]));
        for (const item of open) if (!decided.includes(item)) mark(item.id, failed(false, refused.get(item.parent!.suggestionId) ?? result.message));
        if (!result.ok) {
          toast.show({ text: tx(result.message), tone: "bad" });
          return;
        }
        confirmed(...decided.map((item) => item.id));
        if (selected && decided.includes(selected)) {
          const next = shown.find((other) => !open.includes(other) && !saves.has(other.id) && !held.current.has(other.id));
          setSelectedId(next?.id ?? null);
        }
        toast.show({ text: tx(result.message), tone: "ok", undoLabel: tx(SW.undo), ms: 8000, undo: () => undoParent(result.decided) });
      } catch {
        toast.show({ text: tx(T.failed), tone: "bad" });
        for (const item of open) mark(item.id, failed(false));
      }
    });
  };

  const on: DetailActions = {
    leave: decideLeave,
    parent: decideParent,
    busy: deciding,
    save: (item) => saves.get(item.id),
    leaving: (item) => leaving.has(item.id),
    undo: (item) => undoDecision(item.id),
    retry: (item) => retryDecision(item.id),
    test,
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
  // A decision waiting on its own item already says so there (N02), so the list does not jump for it;
  // the notice is for one this list cannot show (filtered out, or no longer in it).
  const pendingUnseen = pendingCount > 0 && (saves.size === 0 || [...saves.keys()].some((id) => !shown.some((item) => item.id === id)));
  const hasNotices = unavailable || (!previewing && earlier.length > 0) || pendingUnseen;
  const notices = hasNotices ? (
    <>
      {unavailable ? <CouldNotRead partial={live.length > 0} /> : null}
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
      {pendingUnseen ? (
        <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          <span>{tx(T.inboxPending)}</span>
          <Btn variant="ghost" style={{ alignSelf: "flex-start" }} onClick={() => { for (const [id, entry] of held.current) void deliver(id, entry); }}>{tx(T.inboxRetry)}</Btn>
        </div>
      ) : null}
    </>
  ) : null;

  // Several decisions at once, over what this list shows (review N01). Hidden when fewer than two can be batched.
  // An item already decided and waiting for the server is not offered again.
  const batch = <InboxBatch items={shown.filter((item) => !saves.has(item.id))} scope={scope} previewing={previewing} onSettled={(ids) => setHidden((all) => { const next = new Set(all); for (const id of ids) next.add(id); return next; })} />;

  // Every parent's absence shown, as Leave in one tap; one already on its way is not offered again.
  const markAll = <ParentMarkAll items={shown.filter((item) => item.kind === "parent" && (!saves.has(item.id) || saves.get(item.id)?.state.kind === "failed"))} decide={decideParent} busy={deciding} />;

  const oldest = live.reduce<string | null>((min, item) => (item.at && (!min || item.at < min) ? item.at : min), null);
  // With a source unread, "0 waiting" would read as "All clear": say what is known instead (T03).
  const waiting = unavailable && live.length === 0 ? tx(TO.notAllRead) : tx(TO.waiting(live.length, oldest ? dayMonth(oldest) : null));

  /* ---- desk (D03): the list and the selected item side by side ---- */
  const desk = (
    <div className="only-d" style={{ display: "grid", gridTemplateColumns: "400px minmax(0, 1fr)", minHeight: "calc(100dvh - 64px)" }}>
      <div style={{ minWidth: 0, borderRight: "1px solid var(--bd)", display: "flex", flexDirection: "column" }}>
        {views ? <div style={{ padding: "14px 16px 0" }}>{views}</div> : null}
        <div className="glass" role="group" aria-label={tx(TO.filterByType)} style={{ position: "sticky", top: 64, zIndex: 2, padding: "16px 16px 12px", display: "flex", flexWrap: "wrap", gap: 6, borderBottom: "1px solid var(--bd)" }}>
          {chips}
          <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 6 }}>{markAll}{batch}</span>
        </div>
        {notices ? <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid var(--bd)" }}>{notices}</div> : null}
        {shown.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--mut)", fontSize: 14 }}>{tx(live.length === 0 ? (unavailable ? TO.notAllRead : TO.allClearSub) : TO.nothingInFilter)}</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map((item, i) => {
              const sel = selected?.id === item.id;
              const save = saves.get(item.id);
              const waitingOn = save !== undefined && save.state.kind !== "failed";
              return (
                <li key={item.id} className={leaving.has(item.id) ? "vx-leave" : undefined}>
                  <button
                    type="button"
                    onClick={() => select(item)}
                    className={`tap${waitingOn ? " vx-held" : ""}`}
                    aria-current={sel ? "true" : undefined}
                    style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px", border: 0, borderBottom: "1px solid var(--bd)", background: sel ? "var(--accs)" : "transparent", boxShadow: sel ? "inset 0 0 0 1px var(--acc)" : "none", color: "var(--fg)", textAlign: "left", overflow: "hidden", animation: `xIn .4s var(--ease) ${Math.min(i * 40, 400)}ms both` }}
                  >
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
                      <Tag item={item} size="s" />
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{item.kind === "cover" && item.day ? tx(coverDayLabel(item.day)) : tx(whenLabelP(item.at))}</span>
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{tx(item.title)}</span>
                    {/* The waiting line takes the sub line's place, so the row does not grow; the page's live line says it aloud. */}
                    {save ? (
                      <SaveStatus state={save.state.kind === "failed" ? { kind: "failed" } : save.state} words={SAVE_LINE} test={test} live={false} reserve={false} style={{ width: "100%" }} />
                    ) : (
                      <span className="clip" style={{ fontSize: 13, color: "var(--mut)", width: "100%" }}>{tx(item.sub)}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {taskPanel ? <div style={{ padding: 16 }}>{taskPanel}</div> : null}
      </div>
      <div style={{ position: "sticky", top: 64, alignSelf: "start", height: "calc(100dvh - 64px)", overflowY: "auto", minWidth: 0 }}>
        {selected ? <Detail key={selected.id} item={selected} on={on} /> : unavailable ? null : <AllClear big />}
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
        {views}
        <div className="hs" role="group" aria-label={tx(TO.filterByType)} style={{ display: "flex", gap: 8, margin: "0 -18px", padding: "0 18px 2px" }}>
          {chips}
        </div>
      </div>
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {notices}
        <div style={{ alignSelf: "flex-start", display: "flex", flexWrap: "wrap", gap: 8 }}>{markAll}{batch}</div>
        {shown.length === 0 ? (unavailable ? null : <AllClear />) : shown.map((item, i) => <PhoneCard key={item.id} item={item} on={on} delay={Math.min(i * 40, 400)} />)}
        {taskPanel}
      </div>
    </div>
  );

  return (
    <>
      {/* The desk's bar; on a phone the design draws a large title instead (above). */}
      <div className="only-d" style={{ display: "contents" }}>
        <TopBar crumb={unavailable && live.length === 0 ? tx(TO.notAllRead) : tx(T.inboxCrumb(live.length))} title={tx(T.needsYou)} actions={taskActions ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}>{taskActions}</span> : undefined} />
      </div>
      <div className="vx-pmain">
        {desk}
        {phone}
        <SaveStatus state={announce} words={SAVE_LINE} test={test} reserve={false} className="sr" />
      </div>
      {taskDetail}
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
  /** Approve (or record as taken, for days gone) or decline a leave request here. */
  leave: (item: InboxItem, approve: boolean) => void;
  /** Decide a parent's suggestions at once (D-598). */
  parent: ParentDecide;
  busy: boolean;
  /** The item's decision while it waits for the server, or after it failed (N02). */
  save: (item: InboxItem) => ItemSave | undefined;
  /** Confirmed, and on its way out of the list. */
  leaving: (item: InboxItem) => boolean;
  undo: (item: InboxItem) => void;
  retry: (item: InboxItem) => void;
  /** A TEST session: the save line says so. */
  test: boolean;
};

/**
 * The item's buttons — or, while its decision waits for the server, the save
 * line in their place, at their height (N02). A failure keeps the buttons and
 * adds the reason under them, with Try again for a held decision.
 */
function Decided({ item, on, actions, height, gap, pad = 0 }: { item: InboxItem; on: DetailActions; actions: ReactNode; height: number; gap: number; pad?: number }) {
  const save = on.save(item);
  const waiting = save !== undefined && save.state.kind !== "failed";
  const row = useRef<HTMLDivElement>(null);
  useRefocus(waiting, row);
  if (save && waiting) {
    return <SaveStatus state={save.state} words={SAVE_LINE} test={on.test} live={false} reserve={height + pad} style={{ paddingTop: pad || undefined }} onUndo={save.state.kind === "held" ? () => on.undo(item) : undefined} />;
  }
  return (
    <>
      <div ref={row} style={{ display: "flex", flexWrap: "wrap", gap, alignItems: "center", paddingTop: pad || undefined }}>{actions}</div>
      {save ? <SaveStatus state={save.state} words={SAVE_LINE} test={on.test} live={false} reserve={false} onRetry={save.retry ? () => on.retry(item) : undefined} /> : null}
    </>
  );
}

/** After Undo the line gives way to the buttons again; focus that fell to the page goes to the first one, and nowhere else. */
function useRefocus(waiting: boolean, row: RefObject<HTMLDivElement | null>) {
  const was = useRef(waiting);
  useEffect(() => {
    const before = was.current;
    was.current = waiting;
    if (!before || waiting) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    row.current?.querySelector<HTMLElement>("button:not([disabled]), a[href]")?.focus({ preventScroll: true });
  }, [waiting, row]);
}

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
  // Which item matters first is said, not left to the order (smoke run, 20 Oct).
  const urgent = item.urgent ? toneColors("bad") : null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <span className="pill" style={{ height: d.h, padding: d.pad, fontSize: d.fs, background: c.bg, color: c.fg }}>
        <Ic n={look.icon} size={d.ic} />
        {tx(item.badge)}
      </span>
      {urgent ? (
        <span className="pill" style={{ height: d.h, padding: d.pad, fontSize: d.fs, background: urgent.bg, color: urgent.fg, fontWeight: 700 }}>
          {tx(p("Urgent", "ज़रूरी"))}
        </span>
      ) : null}
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
      actions = item.feesRefund?.actionable
        ? <><FeesRefundActions refundId={item.feesRefund.id} kind={item.feesRefund.kind} sessionLabel={item.feesRefund.sessionLabel} amount={item.feesRefund.amount} /><Btn variant="ghost" href={item.href}>{tx(T.review)}</Btn></>
        : <Btn variant="pri" href={item.href}>{tx(T.review)}</Btn>;
      break;
    case "job":
      actions = <Btn variant="pri" href={item.href}>{tx(T.openJobs)}</Btn>;
      break;
    case "leave":
      actions = <LeaveButtons item={item} on={on} />;
      break;
    case "parent":
      actions = <ParentButtons item={item} decide={on.parent} busy={on.busy} />;
      break;
  }

  const save = on.save(item);
  const waiting = save !== undefined && save.state.kind !== "failed";
  const leaving = on.leaving(item);
  return (
    // While leaving, the class's animation replaces the entrance one.
    <article className={`card${waiting ? " vx-held" : ""}${leaving ? " vx-leave" : ""}`} style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, overflow: "hidden", animation: leaving ? undefined : `xRise .44s var(--ease) ${delay}ms both` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Tag item={item} size="m" />
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{item.kind === "cover" && item.day ? tx(coverDayLabel(item.day)) : tx(whenLabelP(item.at))}</span>
      </div>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{tx(item.title)}</h2>
      {item.parent ? <ParentBody item={item} /> : <p style={{ margin: 0, fontSize: 14, color: "var(--mut)", lineHeight: 1.45 }}>{tx(body)}</p>}
      {item.kind === "cover" && !best ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.nobodyFree)}</span> : null}
      <Decided item={item} on={on} actions={actions} height={44} gap={8} pad={4} />
      {/* What a parent's buttons do is said on the phone too: nothing here may surprise. */}
      {item.parent && item.footnote ? <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.5 }}>{tx(item.footnote)}</span> : null}
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
      actions = item.feesRefund?.actionable
        ? <><FeesRefundActions refundId={item.feesRefund.id} kind={item.feesRefund.kind} sessionLabel={item.feesRefund.sessionLabel} amount={item.feesRefund.amount} big /><Btn variant="ghost" style={QUIET} href={item.href}>{tx(T.review)}</Btn></>
        : <Btn variant="pri" style={BIG} href={item.href}>{tx(T.review)}</Btn>;
      break;
    case "job":
      actions = <Btn variant="pri" style={BIG} href={item.href}>{tx(T.openJobs)}</Btn>;
      break;
    case "leave":
      actions = <LeaveButtons item={item} on={on} big />;
      break;
    case "parent":
      actions = <ParentButtons item={item} decide={on.parent} busy={on.busy} big />;
      break;
  }

  const save = on.save(item);
  const waiting = save !== undefined && save.state.kind !== "failed";
  return (
    <article className={waiting ? "vx-held" : undefined} style={{ maxWidth: 760, padding: "32px 40px 48px", display: "flex", flexDirection: "column", gap: 18, animation: "xIn .3s var(--ease) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Tag item={item} size="l" />
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{item.kind === "cover" && item.day ? tx(coverDayLabel(item.day)) : tx(whenLabelP(item.at))}</span>
      </div>
      <h2 className="serif" style={{ margin: 0, fontSize: 32, fontWeight: 600, lineHeight: 1.15 }}>{tx(item.title)}</h2>
      {item.parent ? <ParentBody item={item} big /> : item.body ? <p style={{ margin: 0, color: "var(--mut)", fontSize: 16, lineHeight: 1.6 }}>{tx(item.body)}</p> : null}
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
      <Decided item={item} on={on} actions={actions} height={44} gap={10} />
      {item.footnote ? <span style={{ fontSize: 13, color: "var(--mut)", lineHeight: 1.55 }}>{tx(item.footnote)}</span> : null}
    </article>
  );
}

/** Approve or decline in place; days already gone are recorded as taken instead of approved for cover. */
function LeaveButtons({ item, on, big }: { item: InboxItem; on: DetailActions; big?: boolean }) {
  const { tx } = useVx();
  const style = big ? BIG : undefined;
  return (
    <>
      <Btn variant="pri" icon="check" style={style} disabled={on.busy} onClick={() => on.leave(item, true)}>
        {item.leavePast ? tx(p("Record as taken", "ली गई दर्ज करें")) : tx(p("Approve", "स्वीकार करें"))}
      </Btn>
      <Btn style={{ ...style, ...DECLINE }} disabled={on.busy} onClick={() => on.leave(item, false)}>
        {item.leavePast ? tx(p("Decline as past", "बीत गई, अस्वीकार करें")) : tx(T.decline)}
      </Btn>
      <Btn variant="ghost" style={big ? QUIET : undefined} href={item.href}>{tx(p("Open the leave tab", "छुट्टी टैब खोलें"))}</Btn>
    </>
  );
}
