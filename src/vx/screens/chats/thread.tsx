"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cue } from "@/ui/feedback/cue";
import Link from "@/ui/link";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { expiredLoginHref } from "@/vx/screens/system/logic";
import { ChildAvatar } from "@/vx/ui/child-avatar";
import { useToast } from "@/vx/ui/overlays";
import { PhotoViewer } from "@/vx/ui/photo-viewer";

import { manageChatAction, resendChatAction } from "@/app/(app)/chats/actions";

import { Composer } from "./composer";
import { ChatLine, DayLine } from "./lines";
import { drawLines, isLocal, mergeLines, newRef, telHref } from "./logic";
import { PassSheet } from "./pass-sheet";
import type { ChatFileView, ChatHeadView, ChatMessageView, ChatThreadData } from "./view";
import { T } from "./words";

/*
 * One chat (D-616), the way WhatsApp draws one: who it is at the top with a
 * Call button, the messages, and the box to write in at the bottom. Above the
 * messages, the few things a person can do with the chat, each a plainly
 * named button: Finished, Give to someone else (D-617), the child's page.
 *
 * New messages come on their own: the screen asks every few seconds while it
 * is in view (slower when nothing happens, never while the phone is locked),
 * and a parent's new message rings softly. Scrolled up to read? A "New
 * messages" button says so instead of pulling the page away.
 */

type Step = "take" | "give_back" | "finish" | "reopen";

type PollBody =
  | { kind: "update"; messages: ChatMessageView[]; head: ChatHeadView | null; stamp: string; cursor: string }
  | { kind: "moved"; to: string }
  | { kind: "none" }
  | { kind: "signed_out" }
  | { kind: "error" };

type EarlierBody = { kind: "earlier"; messages: ChatMessageView[]; more: boolean } | { kind: "none" } | { kind: "error" } | { kind: "signed_out" };

/** How often the screen asks for new messages: often while a talk is going on, less once it has gone quiet. */
const FAST_MS = 4_000;
const SLOW_MS = 10_000;
const QUIET_POLLS = 15;
const MAX_BACKOFF_MS = 30_000;
/** How close to the bottom still counts as "reading the newest". */
const NEAR_BOTTOM_PX = 120;
/** An action waits this long at most for the chat to show its result. */
const SETTLE_MS = 4_000;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function ChatThread({
  data,
  myName,
  now,
  previewing,
  canOpenChild,
  seesAll,
  onBack,
  onLeave,
  onMoved,
  onChanged,
}: {
  data: ChatThreadData;
  myName: string;
  /** The screen's clock (ISO), ticking: day lines and whether the parent gets a message now. */
  now: string;
  previewing: boolean;
  /** The person may open a child's page (`students:view`). */
  canOpenChild: boolean;
  seesAll: boolean;
  /** The phone's "All chats" arrow. */
  onBack: () => void;
  /** Back to the list for good: the chat was passed away, or is no longer this person's. */
  onLeave: () => void;
  /** The chat was joined with the family's other chat: open that one. */
  onMoved: (to: string) => void;
  /** Something changed that the list shows (a new line, a finished chat). */
  onChanged: () => void;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const chatId = data.head.id;

  const [seen, setSeen] = useState(data);
  const [head, setHead] = useState(data.head);
  const [lines, setLines] = useState(data.messages);
  const [more, setMore] = useState(data.more);
  const [earlierBusy, setEarlierBusy] = useState(false);
  const [photo, setPhoto] = useState<ChatFileView | null>(null);
  const [passOpen, setPassOpen] = useState(false);
  const [acting, setActing] = useState<Step | null>(null);
  const [state, setState] = useState<"live" | "gone" | "signed_out">("live");
  const [newBelow, setNewBelow] = useState(0);
  const [againId, setAgainId] = useState<string | null>(null);

  // A fresh render of the page (after an action, or the list's own refresh)
  // brings this chat again: take its heading, and any lines it has that the
  // screen has not.
  if (data !== seen) {
    setSeen(data);
    setHead(data.head);
    setLines((current) => mergeLines(current, data.messages));
  }

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  /** What the next drawing of the lines does with the scroll: the bottom (opening, sending), or keep the reader's place (earlier lines above). */
  const pending = useRef<"bottom" | { height: number; top: number } | null>("bottom");
  const linesRef = useRef(lines);
  const cursorRef = useRef(data.cursor);
  const stampRef = useRef(data.stamp);
  const pollNow = useRef<() => Promise<void>>(() => Promise.resolve());
  // The latest callbacks, read by the polling without starting it again (tests/vx-ui-effect-deps.test.ts).
  const callbacks = useRef({ onMoved, onChanged });
  useEffect(() => {
    callbacks.current = { onMoved, onChanged };
  });
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  useEffect(() => {
    stampRef.current = seen.stamp;
  }, [seen]);

  // Opening, sending, and earlier lines above; otherwise a reader at the bottom stays at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const want = pending.current;
    pending.current = null;
    if (want && want !== "bottom") el.scrollTop = want.top + (el.scrollHeight - want.height);
    else if (want === "bottom" || atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines, head]);

  // The box growing, a banner coming, the phone's keyboard opening: the newest line stays in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // New lines, ticks that moved and a heading that changed, every few seconds while the chat is in view.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let busy = false;
    let again = false;
    let quiet = 0;
    let failures = 0;
    let waiting: Array<() => void> = [];
    let current: Array<() => void> = [];

    const release = (list: Array<() => void>) => {
      for (const resolve of list) resolve();
    };
    const stop = () => {
      alive = false;
      window.clearTimeout(timer);
      release(waiting);
      release(current);
      waiting = [];
      current = [];
    };
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      if (alive) timer = window.setTimeout(() => void tick(), ms);
    };
    const nextDelay = () => (failures > 0 ? Math.min(MAX_BACKOFF_MS, FAST_MS * 2 ** failures) : quiet >= QUIET_POLLS ? SLOW_MS : FAST_MS);

    const arrived = (incoming: ChatMessageView[]) => {
      const known = linesRef.current;
      const ids = new Set(known.map((line) => line.id));
      const refs = new Set(known.flatMap((line) => (line.ref ? [line.ref] : [])));
      const fresh = incoming.filter((line) => !ids.has(line.id) && !(line.ref && refs.has(line.ref)));
      setLines((lines) => mergeLines(lines, incoming));
      if (fresh.length === 0) return;
      const fromParent = fresh.filter((line) => line.direction === "in").length;
      if (fromParent > 0) {
        cue("ready");
        if (!atBottom.current) setNewBelow((count) => count + fromParent);
      }
      callbacks.current.onChanged();
    };

    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === "hidden") {
        // Picked up again when the screen is back in view.
        release(waiting);
        waiting = [];
        return;
      }
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      current = waiting;
      waiting = [];
      try {
        const seenNow = document.hasFocus() ? "&seen=1" : "";
        const url = `/chats/thread?c=${encodeURIComponent(chatId)}&since=${encodeURIComponent(cursorRef.current)}&stamp=${encodeURIComponent(stampRef.current)}${seenNow}`;
        const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
        if (!alive) return;
        const body = (await response.json().catch(() => null)) as PollBody | null;
        if (!alive) return;
        if (response.status === 401 || body?.kind === "signed_out") {
          stop();
          setState("signed_out");
          return;
        }
        if (body?.kind === "moved") {
          stop();
          callbacks.current.onMoved(body.to);
          return;
        }
        if (response.status === 404 || body?.kind === "none") {
          stop();
          setState("gone");
          return;
        }
        if (!response.ok || body?.kind !== "update") {
          failures += 1;
          return;
        }
        failures = 0;
        cursorRef.current = body.cursor;
        stampRef.current = body.stamp;
        if (body.head) setHead(body.head);
        if (body.messages.length > 0) {
          quiet = 0;
          arrived(body.messages);
        } else {
          quiet += 1;
        }
      } catch {
        failures += 1;
      } finally {
        busy = false;
        release(current);
        current = [];
        if (alive) {
          if (again) {
            again = false;
            schedule(0);
          } else {
            schedule(nextDelay());
          }
        }
      }
    };

    const wake = () => {
      if (document.visibilityState !== "visible") return;
      quiet = 0;
      schedule(0);
    };
    pollNow.current = () =>
      new Promise<void>((resolve) => {
        if (!alive) {
          resolve();
          return;
        }
        waiting.push(resolve);
        quiet = 0;
        if (busy) again = true;
        else schedule(0);
      });

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    schedule(FAST_MS);
    return () => {
      stop();
      pollNow.current = () => Promise.resolve();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
    };
  }, [chatId]);

  /** The chat as it is now, before an action says it is done (at most a few seconds). */
  const settled = () => Promise.race([pollNow.current(), new Promise<void>((resolve) => window.setTimeout(resolve, SETTLE_MS))]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottom.current = near;
    if (near && newBelow > 0) setNewBelow(0);
  };

  const keepBottom = () => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  };

  const jumpDown = () => {
    const el = scroller.current;
    if (!el) return;
    cue("tap");
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    atBottom.current = true;
    setNewBelow(0);
  };

  const showEarlier = async () => {
    const oldest = lines.find((line) => !isLocal(line));
    if (!oldest || earlierBusy) return;
    setEarlierBusy(true);
    try {
      const response = await fetch(`/chats/thread?c=${encodeURIComponent(chatId)}&before=${encodeURIComponent(oldest.at)}`, { cache: "no-store", headers: { accept: "application/json" } });
      const body = (await response.json().catch(() => null)) as EarlierBody | null;
      if (!response.ok || body?.kind !== "earlier") {
        toast.show({ tone: "bad", text: tx(T.earlierFailed) });
        return;
      }
      const el = scroller.current;
      pending.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
      setLines((current) => mergeLines(current, body.messages));
      setMore(body.more);
    } catch {
      toast.show({ tone: "bad", text: tx(T.earlierFailed) });
    } finally {
      setEarlierBusy(false);
    }
  };

  /* -------------------------------------------------------- writing */

  const addLocal = (line: ChatMessageView) => {
    pending.current = "bottom";
    setNewBelow(0);
    setLines((current) => mergeLines(current, [line]));
  };

  const settle = (ref: string, saved: ChatMessageView | null) => {
    setLines((current) => (saved ? mergeLines(current, [saved]) : current.filter((line) => line.id !== `local:${ref}`)));
    if (saved) callbacks.current.onChanged();
  };

  const sendAgain = async (line: ChatMessageView) => {
    if (againId) return;
    setAgainId(line.id);
    try {
      const result = await resendChatAction({ messageId: line.id, clientRef: newRef() });
      if (!result.ok) {
        toast.show({ tone: "bad", text: tx(result.words) });
        if (result.moved) callbacks.current.onMoved(result.moved);
        return;
      }
      pending.current = "bottom";
      setLines((current) => mergeLines(current.map((item) => (item.id === line.id ? { ...item, resent: true } : item)), [result.message]));
      if (result.delivery === "waiting") toast.show({ tone: "info", text: tx(T.waitingToast), cue: "success" });
      else if (result.delivery === "failed") toast.show({ tone: "bad", text: tx(T.tapToRetry) });
      else cue("success");
      callbacks.current.onChanged();
    } catch {
      toast.show({ tone: "bad", text: tx(T.failed) });
    } finally {
      setAgainId(null);
    }
  };

  /* -------------------------------------------------------- the chat */

  const act = async (step: Step) => {
    if (acting) return;
    setActing(step);
    try {
      const result = await manageChatAction({ chatId, step });
      if (!result.ok) {
        toast.show({ tone: "bad", text: tx(result.words) });
        if (result.moved) callbacks.current.onMoved(result.moved);
        else await settled();
        return;
      }
      await settled();
      if (step === "take") toast.show({ text: tx(T.takenOver), cue: "done" });
      else if (step === "give_back") toast.show({ text: tx(T.handedBack) });
      else if (step === "reopen") toast.show({ text: tx(T.reopened) });
      else toast.show({ text: tx(T.markedDone), cue: "done", undo: () => act("reopen"), undoLabel: tx(T.reopen) });
      callbacks.current.onChanged();
    } catch {
      toast.show({ tone: "bad", text: tx(T.failed) });
    } finally {
      setActing(null);
    }
  };

  const passed = () => {
    // Someone who is not an admin no longer sees a chat they gave away.
    if (!seesAll) {
      onLeave();
      return;
    }
    void settled();
    callbacks.current.onChanged();
  };

  /* -------------------------------------------------------- drawing */

  const live = state === "live";
  const mayWrite = live && !previewing && head.access === "reply";
  const drawn = drawLines(lines, now);
  const firstChild = head.children[0] ?? null;
  const initial = (firstChild?.name ?? head.name).trim().match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "?";
  const sub = [head.childrenLabel || head.phoneLabel, tx(head.deskLabel)].filter(Boolean).join(" · ");
  const showPass = live && !previewing && head.mayPass && head.passTargets.length > 0;
  const showHandBack = live && !previewing && head.mayHandBack;
  const showFinish = live && !previewing && head.mayFinish;
  const childLinks = canOpenChild ? head.children : [];

  const banners: Array<{ key: string; tone: "info" | "warn" | "ok" | "acc"; icon: "alert" | "checkCircle" | "award" | "info" | "message"; text: string }> = [];
  if (head.status === "done") banners.push({ key: "done", tone: "ok", icon: "checkCircle", text: tx(T.doneBanner(head.doneByName)) });
  if (head.takenByMe && head.access === "reply" && head.mayHandBack) banners.push({ key: "took", tone: "acc", icon: "message", text: tx(T.youTook(head.deskFor)) });
  if (head.wantsAdmin) banners.push({ key: "principal", tone: "acc", icon: "award", text: tx(T.wantsAdminBanner) });
  else if (head.complaint) banners.push({ key: "complaint", tone: "warn", icon: "alert", text: tx(T.complaintBanner) });

  let bottom: ReactNode;
  if (state === "signed_out") {
    bottom = (
      <div className="chat-locked" role="alert">
        <span>{tx(T.signedOut)}</span>
        <a className="tap btn pri big" href={expiredLoginHref("/chats", `c=${chatId}`)}>
          <Ic n="key" size={20} />
          {tx(T.signIn)}
        </a>
      </div>
    );
  } else if (state === "gone") {
    bottom = (
      <div className="chat-locked" role="status">
        <span>{tx(T.gone)}</span>
        <button type="button" className="tap btn sec big" onClick={onLeave}>
          <Ic n="chevLeft" size={20} />
          {tx(T.goneBack)}
        </button>
      </div>
    );
  } else if (previewing) {
    bottom = (
      <div className="chat-locked" role="note">
        <span>
          <Ic n="eye" size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
          {tx(T.previewing)}
        </span>
      </div>
    );
  } else if (head.access === "reply") {
    bottom = <Composer key={chatId} head={head} now={now} myName={myName} onLocal={addLocal} onSettle={settle} onMoved={(to) => callbacks.current.onMoved(to)} />;
  } else if (head.access === "take_over") {
    bottom = (
      <div className="chat-locked">
        <span>{tx(T.takeOverWhy(head.deskFor))}</span>
        <button type="button" className="tap btn pri big" disabled={acting !== null} onClick={() => void act("take")}>
          {acting === "take" ? <Ic n="refresh" size={20} className="spin" /> : <Ic n="message" size={20} />}
          {tx(T.takeOver)}
        </button>
      </div>
    );
  } else {
    bottom = (
      <div className="chat-locked" role="note">
        <span>
          <Ic n="eye" size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
          {head.takenByName ? tx(T.watchTaken(head.takenByName)) : tx(T.watchOnly(head.deskFor))}
        </span>
      </div>
    );
  }

  return (
    <section className="chat-threadpane" aria-label={head.name}>
      <header className="chat-head">
        <button type="button" className="chat-back tap" onClick={onBack} aria-label={tx(T.back)}>
          <Ic n="chevLeft" size={26} />
        </button>
        <ChildAvatar text={initial} seed={head.id} size={44} student={firstChild?.id ?? null} zoom={firstChild?.name ?? null} />
        <div className="chat-head-who">
          <span className="chat-head-name">
            {head.name}
            {head.practice ? <span className="chat-tag">{tx(T.practice)}</span> : null}
          </span>
          <span className="chat-head-sub">{sub}</span>
        </div>
        <a className="chat-call tap" href={telHref(head.phone)} aria-label={`${tx(T.call)} ${head.phoneLabel}`} onClick={() => cue("tap")}>
          <Ic n="phone" size={18} />
          <span className="chat-call-w">{tx(T.call)}</span>
        </a>
      </header>

      {showFinish || showPass || showHandBack || childLinks.length > 0 ? (
        <div className="chat-actions" role="group" aria-label={tx(T.actionsLabel)}>
          {showFinish ? (
            head.status === "done" ? (
              <button type="button" className="chat-act tap" disabled={acting !== null} onClick={() => void act("reopen")}>
                <Ic n={acting === "reopen" ? "refresh" : "undo"} size={17} className={acting === "reopen" ? "spin" : undefined} />
                {tx(T.reopen)}
              </button>
            ) : (
              <button type="button" className="chat-act done tap" disabled={acting !== null} onClick={() => void act("finish")} title={tx(T.markDoneHint)}>
                <Ic n={acting === "finish" ? "refresh" : "checkCircle"} size={17} className={acting === "finish" ? "spin" : undefined} />
                {tx(T.markDone)}
              </button>
            )
          ) : null}
          {showPass ? (
            <button type="button" className="chat-act tap" disabled={acting !== null} onClick={() => setPassOpen(true)}>
              <Ic n="send" size={17} />
              {tx(T.pass)}
            </button>
          ) : null}
          {showHandBack ? (
            <button type="button" className="chat-act tap" disabled={acting !== null} onClick={() => void act("give_back")}>
              <Ic n={acting === "give_back" ? "refresh" : "undo"} size={17} className={acting === "give_back" ? "spin" : undefined} />
              {tx(T.handBack)}
            </button>
          ) : null}
          {childLinks.map((child) => (
            <Link key={child.id} href={`/students/${child.id}`} className="chat-act tap">
              <Ic n="user" size={17} />
              {tx(head.children.length > 1 ? T.childPageOf(firstName(child.name)) : T.childPage)}
            </Link>
          ))}
        </div>
      ) : null}

      {banners.slice(0, 2).map((banner) => (
        <div key={banner.key} className={`chat-banner ${banner.tone}`} role="note">
          <Ic n={banner.icon} size={18} style={{ flex: "none", marginTop: 1 }} />
          <span>{banner.text}</span>
        </div>
      ))}

      <div className="chat-msgwrap">
        <div className="chat-msgs" ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label={tx(T.title)}>
          {more ? (
            <button type="button" className="chat-older tap btn sec" disabled={earlierBusy} onClick={() => void showEarlier()}>
              <Ic n={earlierBusy ? "refresh" : "chevUp"} size={16} className={earlierBusy ? "spin" : undefined} />
              {tx(T.older)}
            </button>
          ) : null}
          {drawn.length === 0 ? <div className="chat-day">{tx(T.noMessages)}</div> : null}
          {drawn.map((item) => (
            <Fragment key={item.line.id}>
              {item.day ? <DayLine label={tx(item.day)} /> : null}
              <ChatLine
                drawn={item}
                myName={myName}
                onPhoto={setPhoto}
                onMediaLoad={keepBottom}
                onSendAgain={(line) => void sendAgain(line)}
                againBusy={againId === item.line.id}
                mayWrite={mayWrite}
              />
            </Fragment>
          ))}
        </div>
        {newBelow > 0 ? (
          <button type="button" className="chat-newpill tap" onClick={jumpDown} aria-label={tx(T.jumpDown)}>
            <Ic n="chevDown" size={18} />
            {tx(T.newBelow)}
            <span className="chat-newpill-n">{newBelow}</span>
          </button>
        ) : null}
      </div>

      {bottom}

      <PassSheet open={passOpen} onClose={() => setPassOpen(false)} head={head} onPassed={passed} onMoved={(to) => callbacks.current.onMoved(to)} />
      <PhotoViewer open={photo !== null} onClose={() => setPhoto(null)} src={photo?.url ?? ""} alt={tx(T.photo)} name={photo?.name.replace(/\.[a-z0-9]{2,5}$/i, "") || head.name} />
    </section>
  );
}
