"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cue } from "@/ui/feedback/cue";
import Link from "@/ui/link";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { ChatRowBody } from "@/vx/screens/chats/row";
import { ChatThread } from "@/vx/screens/chats/thread";
import type { ChatListItem, ChatThreadData } from "@/vx/screens/chats/view";
import { T } from "@/vx/screens/chats/words";
import { expiredLoginHref } from "@/vx/screens/system/logic";
import { p } from "@/vx/text";
import { ChildAvatar } from "@/vx/ui/child-avatar";
import { EmptyState, Pill } from "@/vx/ui/primitives";

import "@/vx/screens/chats/chats.css";
import "./chat-panel.css";

/*
 * The chat bubble's panel (D-641): the chats that are this person's to
 * answer, over whatever screen they are on, and a chat with its reply box
 * one tap further, so a teacher answers a parent without leaving attendance.
 * The rows and the chat are Chats' own (`screens/chats`), so it reads and
 * works exactly as the full screen does; "See all chats" goes there for the
 * tabs, filters and search.
 *
 * On a phone it is a sheet over the whole screen that rides the keyboard,
 * and the phone's Back goes from a chat to the list and then closes it, as
 * WhatsApp's does. On a computer it is a chat window in the bottom right
 * corner, and the page stays in reach beside it.
 *
 * An administrator seeing One as somebody else (D-544) reads that person's
 * chats; nothing is marked read and nothing can be sent.
 */

const PW = {
  close: p("Close chats", "चैट बंद करें"),
  seeAll: p("See all chats", "सभी चैट देखें"),
  more: (count: number) => p(`${count} more`, `${count} और`),
  waiting: (count: number) =>
    count === 0
      ? p("No parent is waiting", "कोई अभिभावक प्रतीक्षा में नहीं")
      : count === 1
        ? p("1 parent waiting for your reply", "1 अभिभावक आपके जवाब की प्रतीक्षा में")
        : p(`${count} parents waiting for your reply`, `${count} अभिभावक आपके जवाब की प्रतीक्षा में`),
  lookOnly: p(
    "You are seeing their chats as they see them. Nothing is marked read, and nothing can be sent.",
    "आप उनकी चैट वैसे ही देख रहे हैं जैसे वे देखते हैं। कुछ पढ़ा हुआ नहीं माना जाता, और कुछ भेजा नहीं जा सकता।",
  ),
  chatFailed: p("This chat could not be opened just now.", "यह बातचीत अभी नहीं खुल सकी।"),
};

const PHONE = "(max-width: 899px)";
/** The panel's own history entries on a phone, so Back closes it rather than leaving the page. */
const MARK = "__vxChats";
const LIST_MS = 20_000;
const CLOSE_MS = 200;
const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])";

let panelSeq = 0;

type Me = { name: string; previewing: boolean; canOpenChild: boolean; seesAll: boolean };
type ListBody =
  | { kind: "list"; enabled: boolean; items: ChatListItem[]; waiting: number; more: number; viewingTest: boolean; me: Me }
  | { kind: "signed_out" }
  | { kind: "error" };
type ThreadBody = { kind: "chat"; data: ChatThreadData; me: Me } | { kind: "moved"; to: string } | { kind: "none" } | { kind: "signed_out" } | { kind: "error" };
type ListState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "signed_out" }
  | { kind: "ready"; enabled: boolean; items: ChatListItem[]; waiting: number; more: number; viewingTest: boolean };
type ChatState =
  | { kind: "loading" | "failed" | "gone" | "signed_out"; id: string; item: ChatListItem | null }
  | { kind: "ready"; id: string; data: ChatThreadData; me: Me };
type Mark = { id: number; at: "list" | "chat" };

const noSubscribe = () => () => {};
const getLayer = () => document.getElementById("vx-layer");
const noLayer = () => null;
function subscribePhone(listener: () => void): () => void {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
const isPhone = () => window.matchMedia(PHONE).matches;
const phoneOnServer = () => true;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function markOf(state: unknown): Mark | null {
  const mark = (state as Record<string, unknown> | null)?.[MARK] as Partial<Mark> | undefined;
  return mark && typeof mark.id === "number" && (mark.at === "list" || mark.at === "chat") ? { id: mark.id, at: mark.at } : null;
}

function pushMark(mark: Mark): void {
  window.history.pushState({ ...(window.history.state ?? {}), [MARK]: mark }, "");
}

export function ChatPanel({
  start,
  since,
  lookOnly,
  onClose,
  onActivity,
}: {
  /** A chat to open straight away (the bubble's "Reply"), or null for the list. */
  start: string | null;
  /** When it opened (ISO): the clock until the first tick. */
  since: string;
  lookOnly: boolean;
  /** The panel has finished closing: take it away. */
  onClose: () => void;
  /** Something changed that the bubble's number may show. */
  onActivity: () => void;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const layer = useSyncExternalStore(noSubscribe, getLayer, noLayer);
  const phone = useSyncExternalStore(subscribePhone, isPhone, phoneOnServer);
  const titleId = useId();
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [chat, setChat] = useState<ChatState | null>(start ? { kind: "loading", id: start, item: null } : null);
  const [me, setMe] = useState<Me | null>(null);
  const [now, setNow] = useState(since);
  const [closing, setClosing] = useState(false);

  const box = useRef<HTMLDivElement>(null);
  const first = useRef(start);
  /** Our history entries on a phone: 0, 1 (the list) or 2 (a chat over it). */
  const depth = useRef(0);
  const markId = useRef(0);
  const shut = useRef(false);
  const chatSeq = useRef(0);
  const refreshList = useRef<() => void>(() => {});
  const refreshTimer = useRef<number | undefined>(undefined);
  const calls = useRef({ onClose, onActivity });
  useEffect(() => {
    calls.current = { onClose, onActivity };
  });

  /* ------------------------------------------------------------ actions */

  /** Closing has begun: the panel slides away, then the bubble takes it off. */
  const finish = () => {
    if (shut.current) return;
    shut.current = true;
    setClosing(true);
    window.setTimeout(() => calls.current.onClose(), reducedMotion() ? 0 : CLOSE_MS);
  };

  const close = () => {
    if (shut.current) return;
    const steps = depth.current;
    depth.current = 0;
    if (steps > 0) window.history.go(-steps);
    finish();
  };

  /** A link inside the panel on a phone: our history entries go first, then the page. */
  const leave = (href: string) => {
    const steps = depth.current;
    depth.current = 0;
    shut.current = true;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.removeEventListener("popstate", go);
      router.push(href);
    };
    if (steps > 0) {
      window.addEventListener("popstate", go);
      window.setTimeout(go, 700);
      window.history.go(-steps);
    } else {
      go();
    }
    calls.current.onClose();
  };

  const showList = () => {
    chatSeq.current += 1;
    setChat(null);
    refreshList.current();
  };

  const toList = () => {
    // On a phone the chat has its own history entry: Back takes it off, and its popstate shows the list.
    if (depth.current === 2) window.history.back();
    else showList();
  };

  const fetchChat = async (id: string, item: ChatListItem | null, hops = 0): Promise<void> => {
    chatSeq.current += 1;
    const seq = chatSeq.current;
    try {
      const response = await fetch(`/chats/thread?c=${encodeURIComponent(id)}&open=1`, { cache: "no-store", headers: { accept: "application/json" } });
      const body = (await response.json().catch(() => null)) as ThreadBody | null;
      if (seq !== chatSeq.current) return;
      if (response.status === 401 || body?.kind === "signed_out") setChat({ kind: "signed_out", id, item });
      else if (body?.kind === "moved" && hops < 3) {
        setChat({ kind: "loading", id: body.to, item });
        void fetchChat(body.to, item, hops + 1);
      } else if (response.status === 404 || body?.kind === "none") setChat({ kind: "gone", id, item });
      else if (response.ok && body?.kind === "chat") {
        setChat({ kind: "ready", id, data: body.data, me: body.me });
        setMe(body.me);
        // Opening it read the parent's lines: the list's marks and the bubble's number follow.
        refreshList.current();
        calls.current.onActivity();
      } else setChat({ kind: "failed", id, item });
    } catch {
      if (seq === chatSeq.current) setChat({ kind: "failed", id, item });
    }
  };

  const openChat = (item: ChatListItem) => {
    cue("tap");
    if (depth.current === 1) {
      pushMark({ id: markId.current, at: "chat" });
      depth.current = 2;
    }
    setChat({ kind: "loading", id: item.id, item });
    void fetchChat(item.id, item);
  };

  const moved = (to: string) => {
    setChat({ kind: "loading", id: to, item: null });
    void fetchChat(to, null);
  };

  const changed = () => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => refreshList.current(), 1_200);
    calls.current.onActivity();
  };

  const retryList = () => {
    setList({ kind: "loading" });
    refreshList.current();
  };

  const act = useRef({ finish, close, leave, showList, fetchChat });
  useEffect(() => {
    act.current = { finish, close, leave, showList, fetchChat };
  });

  /* ------------------------------------------------------------ effects */

  // The clock the rows and the chat read ("2 min", "Yesterday"), ticking.
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString());
    const soon = window.setTimeout(tick, 0);
    const every = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(soon);
      window.clearInterval(every);
    };
  }, []);

  // The list: at once, then every 20 seconds while the screen is in view.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let seq = 0;
    const load = async () => {
      window.clearTimeout(timer);
      if (!alive) return;
      seq += 1;
      const mine = seq;
      try {
        const response = await fetch("/chats/panel", { cache: "no-store", headers: { accept: "application/json" } });
        const body = (await response.json().catch(() => null)) as ListBody | null;
        if (!alive || mine !== seq) return;
        if (response.status === 401 || body?.kind === "signed_out") setList({ kind: "signed_out" });
        else if (response.ok && body?.kind === "list") {
          setList({ kind: "ready", enabled: body.enabled, items: body.items, waiting: body.waiting, more: body.more, viewingTest: body.viewingTest });
          setMe(body.me);
        } else setList((current) => (current.kind === "ready" ? current : { kind: "failed" }));
      } catch {
        if (alive && mine === seq) setList((current) => (current.kind === "ready" ? current : { kind: "failed" }));
      }
      if (alive && mine === seq) timer = window.setTimeout(tick, LIST_MS);
    };
    const tick = () => {
      if (document.visibilityState === "visible") void load();
      else timer = window.setTimeout(tick, LIST_MS);
    };
    const wake = () => {
      if (document.visibilityState === "visible") void load();
    };
    refreshList.current = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 0);
    };
    timer = window.setTimeout(() => void load(), 0);
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearTimeout(refreshTimer.current);
      refreshList.current = () => {};
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  // Opened on one chat (the bubble's Reply): fetch it straight away.
  useEffect(() => {
    const id = first.current;
    if (!id) return undefined;
    const timer = window.setTimeout(() => void act.current.fetchChat(id, null), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // A phone's Back: from a chat to the list, then closed. Our entries go when the panel does.
  useEffect(() => {
    if (!isPhone()) return undefined;
    panelSeq += 1;
    const id = panelSeq;
    markId.current = id;
    pushMark({ id, at: "list" });
    depth.current = 1;
    if (first.current) {
      pushMark({ id, at: "chat" });
      depth.current = 2;
    }
    const onPop = (event: PopStateEvent) => {
      const mark = markOf(event.state);
      if (mark?.id === id) {
        if (mark.at === "list" && depth.current === 2) {
          depth.current = 1;
          act.current.showList();
        } else {
          depth.current = mark.at === "chat" ? 2 : 1;
        }
        return;
      }
      depth.current = 0;
      act.current.finish();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      const steps = depth.current;
      depth.current = 0;
      if (steps > 0) window.history.go(-steps);
    };
  }, []);

  // A phone: the page underneath stays still while the panel is open.
  useEffect(() => {
    if (!isPhone()) return undefined;
    const body = document.body;
    const before = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = before;
    };
  }, []);

  // Focus comes into the panel, and goes back to the bubble after.
  useEffect(() => {
    const before = document.activeElement;
    const timer = window.setTimeout(() => {
      const el = box.current;
      if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    }, 60);
    return () => {
      window.clearTimeout(timer);
      if (before instanceof HTMLElement && before.isConnected && before !== document.body) before.focus({ preventScroll: true });
    };
  }, []);

  // Escape closes it; on a phone, Tab stays inside. A sheet or a photo opened over it answers first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = box.current;
      if (!el) return;
      const over = Array.from(document.querySelectorAll("#vx-layer [role='dialog']")).some((dialog) => dialog !== el && !el.contains(dialog));
      if (over) return;
      if (event.key === "Escape") {
        if (!el.contains(document.activeElement) && document.activeElement !== document.body) return;
        event.preventDefault();
        act.current.close();
        return;
      }
      if (event.key !== "Tab" || !isPhone()) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => !item.matches(":disabled") && item.offsetParent !== null);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === firstItem || document.activeElement === el)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      } else if (!el.contains(document.activeElement)) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A phone: a link inside (a child's page, See all chats) first takes our history entries off.
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const onClick = (event: MouseEvent) => {
      if (depth.current === 0 || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || !el.contains(link)) return;
      if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/chats/file/")) return;
      event.preventDefault();
      act.current.leave(`${url.pathname}${url.search}${url.hash}`);
    };
    el.addEventListener("click", onClick, true);
    return () => el.removeEventListener("click", onClick, true);
  }, [layer]);

  if (!layer) return null;

  /* ------------------------------------------------------------- drawing */

  const seesAll = me?.seesAll ?? false;
  const practice = list.kind === "ready" && list.viewingTest;
  const waitingCount = list.kind === "ready" && list.enabled ? list.waiting : null;

  let body: ReactNode;
  if (chat?.kind === "ready") {
    body = (
      <ChatThread
        data={chat.data}
        myName={chat.me.name}
        now={now}
        previewing={chat.me.previewing}
        canOpenChild={chat.me.canOpenChild}
        seesAll={chat.me.seesAll}
        onBack={toList}
        onLeave={toList}
        onMoved={moved}
        onChanged={changed}
      />
    );
  } else if (chat) {
    body = <ChatWait chat={chat} onBack={toList} onRetry={() => void fetchChat(chat.id, chat.item)} />;
  } else {
    body = (
      <ListPane
        list={list}
        now={now}
        seesAll={seesAll}
        lookOnly={lookOnly}
        onOpen={openChat}
        onRetry={retryList}
      />
    );
  }

  return createPortal(
    <div className={`vx-cp-root${closing ? " closing" : ""}`}>
      <button type="button" className="vx-cp-scrim" tabIndex={-1} aria-hidden="true" onClick={close} />
      <div
        ref={box}
        className="vx-cp"
        role="dialog"
        aria-modal={phone ? true : undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        data-view={chat ? "chat" : "list"}
      >
        <div className="vx-cp-bar">
          <span className="vx-cp-mark" aria-hidden="true">
            <Ic n="message" size={18} />
          </span>
          <span className="vx-cp-titles">
            <span id={titleId} className="vx-cp-title">
              {tx(T.title)}
            </span>
            {waitingCount !== null ? <span className={`vx-cp-sub${waitingCount > 0 ? " wait" : ""}`}>{tx(PW.waiting(waitingCount))}</span> : null}
          </span>
          {practice ? (
            <Pill tone="warn" icon="flask">
              {tx(T.practice)}
            </Pill>
          ) : null}
          <button type="button" className="vx-cp-x tap" aria-label={tx(PW.close)} onClick={close}>
            <Ic n="x" size={22} />
          </button>
        </div>
        <div key={chat ? `chat:${chat.id}` : "list"} className={chat ? "vx-cp-chat" : "vx-cp-list"}>
          {body}
        </div>
      </div>
    </div>,
    layer,
  );
}

/* --------------------------------------------------------------- the list */

function ListPane({
  list,
  now,
  seesAll,
  lookOnly,
  onOpen,
  onRetry,
}: {
  list: ListState;
  now: string;
  seesAll: boolean;
  lookOnly: boolean;
  onOpen: (item: ChatListItem) => void;
  onRetry: () => void;
}) {
  const { tx } = useVx();

  const row = (item: ChatListItem) => (
    <button key={item.id} type="button" className={`chat-row tap${item.status === "waiting" ? " wait" : ""}`} onClick={() => onOpen(item)}>
      <ChatRowBody item={item} selected={false} now={now} dues={0} seesAll={seesAll} />
    </button>
  );

  let content: ReactNode;
  if (list.kind === "loading") {
    content = (
      <div className="chat-list" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className="chat-row vx-cp-skel" aria-hidden="true">
            <span className="skel" style={{ width: 48, height: 48, borderRadius: 24, flex: "none" }} />
            <span className="chat-row-main">
              <span className="skel" style={{ height: 15, width: "55%" }} />
              <span className="skel" style={{ height: 12, width: "35%" }} />
              <span className="skel" style={{ height: 13, width: "85%" }} />
            </span>
          </div>
        ))}
      </div>
    );
  } else if (list.kind === "failed") {
    content = (
      <EmptyState
        icon="alert"
        title={tx(T.couldNotRead)}
        action={
          <button type="button" className="tap btn sec" onClick={onRetry}>
            <Ic n="refresh" size={18} />
            {tx(T.tryAgain)}
          </button>
        }
      />
    );
  } else if (list.kind === "signed_out") {
    content = (
      <EmptyState
        icon="key"
        title={tx(T.signedOut)}
        action={
          <a className="tap btn pri" href={expiredLoginHref("/chats")}>
            <Ic n="key" size={18} />
            {tx(T.signIn)}
          </a>
        }
      />
    );
  } else if (!list.enabled) {
    content = <EmptyState icon="message" title={tx(T.off)} body={tx(T.offBody)} />;
  } else if (list.items.length === 0) {
    content = <EmptyState icon="checkCircle" title={tx(T.emptyTitle)} body={tx(T.emptyBody)} />;
  } else {
    const waiting = list.items.filter((item) => item.status === "waiting");
    const others = list.items.filter((item) => item.status !== "waiting");
    content = (
      <>
        {waiting.length > 0 ? (
          <>
            <div className="chat-sec wait">
              <Ic n="clock" size={15} />
              <span>{tx(T.secWaiting)}</span>
              <span className="chat-sec-n">{waiting.length}</span>
            </div>
            <div className="chat-list">{waiting.map(row)}</div>
          </>
        ) : null}
        {others.length > 0 ? (
          <>
            <div className="chat-sec">
              <span>{tx(T.secOthers)}</span>
            </div>
            <div className="chat-list">{others.map(row)}</div>
          </>
        ) : null}
      </>
    );
  }

  const more = list.kind === "ready" ? list.more : 0;
  return (
    <>
      <div className="vx-cp-scroll">
        {lookOnly ? (
          <div className="vx-cp-look" role="note">
            <Ic n="eye" size={17} style={{ flex: "none", marginTop: 1 }} />
            <span>{tx(PW.lookOnly)}</span>
          </div>
        ) : null}
        {content}
      </div>
      <div className="vx-cp-foot">
        <Link href="/chats" className="tap btn sec vx-cp-all" onClick={() => cue("tap")}>
          <Ic n="inbox" size={19} />
          <span>{tx(PW.seeAll)}</span>
          {more > 0 ? <span className="vx-cp-more">{tx(PW.more(more))}</span> : null}
          <Ic n="chevRight" size={18} />
        </Link>
      </div>
    </>
  );
}

/* ------------------------------------------- a chat on its way, or not there */

function ChatWait({ chat, onBack, onRetry }: { chat: Exclude<ChatState, { kind: "ready" }>; onBack: () => void; onRetry: () => void }) {
  const { tx } = useVx();
  const item = chat.item;
  let middle: ReactNode;
  if (chat.kind === "loading") {
    middle = (
      <>
        <Ic n="refresh" size={28} className="spin" />
        <span>{tx(T.opening)}</span>
      </>
    );
  } else if (chat.kind === "failed") {
    middle = (
      <>
        <Ic n="alert" size={28} />
        <strong>{tx(PW.chatFailed)}</strong>
        <button type="button" className="tap btn sec" onClick={onRetry}>
          <Ic n="refresh" size={18} />
          {tx(T.tryAgain)}
        </button>
      </>
    );
  } else if (chat.kind === "gone") {
    middle = (
      <>
        <Ic n="info" size={28} />
        <strong>{tx(T.gone)}</strong>
        <button type="button" className="tap btn sec" onClick={onBack}>
          <Ic n="chevLeft" size={18} />
          {tx(T.goneBack)}
        </button>
      </>
    );
  } else {
    middle = (
      <>
        <Ic n="key" size={28} />
        <strong>{tx(T.signedOut)}</strong>
        <a className="tap btn pri" href={expiredLoginHref("/chats", `c=${chat.id}`)}>
          <Ic n="key" size={18} />
          {tx(T.signIn)}
        </a>
      </>
    );
  }
  return (
    <section className="chat-threadpane" aria-label={item?.name ?? tx(T.title)} aria-busy={chat.kind === "loading"}>
      <header className="chat-head">
        <button type="button" className="chat-back tap" onClick={onBack} aria-label={tx(T.back)}>
          <Ic n="chevLeft" size={26} />
        </button>
        {item ? <ChildAvatar text={item.initial} seed={item.id} size={44} student={item.studentId} /> : null}
        <div className="chat-head-who">
          <span className="chat-head-name">{item ? item.name : tx(T.title)}</span>
          {item ? <span className="chat-head-sub">{item.children ?? tx(item.deskLabel)}</span> : null}
        </div>
      </header>
      <div className="chat-pick" role="status">
        {middle}
      </div>
    </section>
  );
}
