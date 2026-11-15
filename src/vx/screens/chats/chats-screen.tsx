"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { CHAT_VIEWS, type ChatFilter, type ChatView } from "@/modules/chats/domain/filters";
import { cue } from "@/ui/feedback/cue";
import Link from "@/ui/link";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";
import { ChildAvatar } from "@/vx/ui/child-avatar";
import { SearchBox, Seg } from "@/vx/ui/controls";
import { setLiveChatCount, useLiveChatScope } from "@/vx/shell/chat-live";
import { HelpButton, useToast } from "@/vx/ui/overlays";
import { EmptyState, Pill } from "@/vx/ui/primitives";

import { chatsHref } from "./logic";
import { ChatRowBody } from "./row";
import { ChatThread } from "./thread";
import type { ChatListData, ChatListItem, ChatThreadData } from "./view";
import { T } from "./words";

import "./chats.css";

/*
 * Chats with parents (D-616), made for teachers and accountants who are not
 * used to apps: it looks and works like WhatsApp. The list has the parents
 * waiting for a reply on top, longest wait first, with a red mark; tap one
 * and the chat opens (the whole phone screen, or beside the list on a
 * computer). An admin's list opens on what is theirs ("For you") with tabs
 * for the class teachers, the accounts office and everything, a chip per
 * teacher, families with fees due, and a search by name, phone or admission
 * number (the owner, 15 Nov 2026: filtered, never a flood).
 *
 * The list keeps itself current: it asks every 20 seconds whether a parent
 * is waiting, and redraws when that changed or the chat open beside it did.
 */

/** A row tapped in this list opened the chat: the phone's back arrow then goes back to the list, as WhatsApp's does. */
let openedFromList = false;

const VIEW_LABEL: Record<ChatView, Pair> = { you: T.forYou, class: T.teachers, accounts: T.accounts, all: T.all };
const VIEW_ICON: Record<ChatView, IconName> = { you: "user", class: "users", accounts: "rupee", all: "inbox" };

/** How often the list asks whether parents are waiting, and how often it redraws anyway. */
const PULSE_MS = 20_000;
const FULL_REFRESH_MS = 120_000;

type Notice = "old_link" | "gone" | null;

function ChatRowLink({
  item,
  href,
  selected,
  now,
  dues,
  seesAll,
  onOpen,
}: {
  item: ChatListItem;
  href: string;
  selected: boolean;
  now: string;
  dues: number;
  seesAll: boolean;
  onOpen: (item: ChatListItem) => void;
}) {
  const waiting = item.status === "waiting";
  return (
    <Link
      href={href}
      scroll={false}
      className={`chat-row tap${selected ? " sel" : ""}${waiting ? " wait" : ""}`}
      aria-current={selected ? "true" : undefined}
      onClick={() => onOpen(item)}
    >
      <ChatRowBody item={item} selected={selected} now={now} dues={dues} seesAll={seesAll} />
    </Link>
  );
}

/** The chat as it opens, drawn at once from its row while the page brings the messages. */
function OpeningPane({ item, onBack }: { item: ChatListItem; onBack: () => void }) {
  const { tx } = useVx();
  return (
    <section className="chat-threadpane" aria-label={item.name} aria-busy="true">
      <header className="chat-head">
        <button type="button" className="chat-back tap" onClick={onBack} aria-label={tx(T.back)}>
          <Ic n="chevLeft" size={26} />
        </button>
        <ChildAvatar text={item.initial} seed={item.id} size={44} student={item.studentId} />
        <div className="chat-head-who">
          <span className="chat-head-name">{item.name}</span>
          <span className="chat-head-sub">{item.children ?? tx(item.deskLabel)}</span>
        </div>
      </header>
      <div className="chat-pick" role="status">
        <Ic n="refresh" size={28} className="spin" />
        <span>{tx(T.opening)}</span>
      </div>
    </section>
  );
}

export function ChatsScreen({
  list,
  thread,
  filter,
  openId,
  now: serverNow,
  myName,
  previewing,
  canOpenChild,
  notice,
}: {
  /** Null when the list could not be read. */
  list: ChatListData | null;
  thread: ChatThreadData | null;
  filter: ChatFilter;
  /** The chat that is open (it is also in the address). */
  openId: string | null;
  /** The server's clock when the page was drawn. */
  now: string;
  myName: string;
  previewing: boolean;
  canOpenChild: boolean;
  notice: Notice;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const liveWho = useLiveChatScope();
  const [pending, startTransition] = useTransition();

  // The screen's own clock, for "Today", the row times and the WhatsApp day.
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date().toISOString()), 0);
    const every = window.setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);

  // A tapped row opens its chat at once; the messages follow.
  const [opening, setOpening] = useState<ChatListItem | null>(null);
  const shownId = thread?.head.id ?? null;
  const [seenShown, setSeenShown] = useState(shownId);
  if (shownId !== seenShown) {
    setSeenShown(shownId);
    setOpening(null);
  }

  // The search box: typed here, sent to the address a moment after the typing stops.
  const [query, setQuery] = useState(filter.query);
  const [syncedQuery, setSyncedQuery] = useState(filter.query);
  if (filter.query !== syncedQuery) {
    setSyncedQuery(filter.query);
    // Back or a tab changed the search; words typed since are kept.
    if (query.trim() === syncedQuery) setQuery(filter.query);
  }
  const searchTimer = useRef<number | undefined>(undefined);
  const refreshTimer = useRef<number | undefined>(undefined);
  const lastRefresh = useRef(0);
  useEffect(() => {
    const search = searchTimer;
    const refresh = refreshTimer;
    return () => {
      window.clearTimeout(search.current);
      window.clearTimeout(refresh.current);
    };
  }, []);

  const go = (href: string) => {
    startTransition(() => router.replace(href, { scroll: false }));
  };

  /** Redraw the list soon (a new line, a finished chat), once for a burst of changes. */
  const refreshSoon = () => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      lastRefresh.current = Date.now();
      router.refresh();
    }, 1_200);
  };

  // Is a parent waiting? Asked every 20 seconds while the screen is in view; the list redraws when the answer changes.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let last: string | null = null;
    lastRefresh.current = Date.now();
    const check = async () => {
      window.clearTimeout(timer);
      if (!alive) return;
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch("/chats/pulse", { cache: "no-store", headers: { accept: "application/json" } });
          const body = (await response.json().catch(() => null)) as { waiting?: number; latest?: { chatId: string; at: string } | null; failed?: boolean } | null;
          if (!alive) return;
          // A failed read says nothing about who is waiting: no redraw, and the menu's number stays.
          if (response.ok && body && !body.failed) {
            setLiveChatCount(body.waiting ?? 0, liveWho);
            const mark = `${body.waiting ?? 0}|${body.latest?.chatId ?? ""}|${body.latest?.at ?? ""}`;
            const stale = Date.now() - lastRefresh.current > FULL_REFRESH_MS;
            if ((last !== null && mark !== last) || stale) {
              lastRefresh.current = Date.now();
              router.refresh();
            }
            last = mark;
          }
        } catch {
          // Offline for a moment: the next check tries again.
        }
      }
      if (alive) timer = window.setTimeout(() => void check(), PULSE_MS);
    };
    const back = () => {
      if (document.visibilityState === "visible") void check();
    };
    timer = window.setTimeout(() => void check(), PULSE_MS);
    document.addEventListener("visibilitychange", back);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [router, liveWho]);

  const onQuery = (value: string) => {
    setQuery(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => go(chatsHref(filter, { query: value.trim(), chat: openId })), value ? 450 : 0);
  };

  const open = (item: ChatListItem) => {
    if (item.id === openId) return;
    openedFromList = true;
    cue("tap");
    setOpening(item);
  };

  const listHref = chatsHref(filter);
  const back = () => {
    setOpening(null);
    if (openedFromList) {
      openedFromList = false;
      router.back();
      return;
    }
    router.replace(listHref, { scroll: false });
  };
  const leave = () => {
    openedFromList = false;
    setOpening(null);
    router.replace(listHref, { scroll: false });
  };
  const moved = (to: string) => {
    toast.show({ tone: "info", text: tx(T.moved) });
    router.replace(chatsHref(filter, { chat: to }), { scroll: false });
  };

  /* --------------------------------------------------------- the list */

  const items = list?.items ?? [];
  const seesAll = list?.seesAll === true;
  const mayDues = seesAll || list?.feesDesk === true;
  const filtered = Boolean(filter.query || filter.dues || filter.teacherId || (seesAll && filter.view !== "you"));
  const showSearch = seesAll || (list?.total ?? 0) >= 8 || Boolean(filter.query);
  const waitingRows = filter.dues || filter.show === "done" ? [] : items.filter((item) => item.status === "waiting");
  const otherRows = filter.dues || filter.show === "done" ? items : items.filter((item) => item.status !== "waiting");

  const rows = (group: ChatListItem[]) => (
    <div className="chat-list" aria-busy={pending || undefined}>
      {group.map((item) => (
        <ChatRowLink
          key={item.id}
          item={item}
          href={chatsHref(filter, { chat: item.id })}
          selected={item.id === (opening?.id ?? openId)}
          now={now}
          dues={list?.dues[item.id] ?? 0}
          seesAll={seesAll}
          onOpen={open}
        />
      ))}
    </div>
  );

  let body: ReactNode;
  if (!list) {
    body = (
      <EmptyState
        icon="alert"
        title={tx(T.couldNotRead)}
        action={
          <button type="button" className="tap btn sec" onClick={() => router.refresh()}>
            <Ic n="refresh" size={18} />
            {tx(T.tryAgain)}
          </button>
        }
      />
    );
  } else if (!list.enabled) {
    body = <EmptyState icon="message" title={tx(T.off)} body={tx(T.offBody)} />;
  } else if (filter.dues && list.duesFailed) {
    body = <EmptyState icon="alert" title={tx(T.duesFailed)} />;
  } else if (items.length === 0) {
    body = filtered ? (
      <EmptyState
        icon="search"
        title={tx(T.emptyFiltered)}
        body={tx(T.emptyFilteredBody)}
        action={
          <Link href={chatsHref({ view: "you", show: filter.show, teacherId: null, dues: false, query: "" })} replace scroll={false} className="tap btn sec">
            <Ic n="x" size={18} />
            {tx(T.clearFilters)}
          </Link>
        }
      />
    ) : filter.show === "done" ? (
      <EmptyState icon="checkCircle" title={tx(T.emptyDone)} />
    ) : (
      <EmptyState icon="message" title={tx(T.emptyTitle)} body={tx(T.emptyBody)} />
    );
  } else {
    body = (
      <>
        {filter.dues ? <p className="chat-hint">{tx(T.duesHint)}</p> : null}
        {waitingRows.length > 0 ? (
          <>
            <h2 className="chat-sec wait">
              <span>{tx(T.secWaiting)}</span>
              <span className="chat-sec-n">{waitingRows.length}</span>
            </h2>
            {rows(waitingRows)}
          </>
        ) : null}
        {otherRows.length > 0 ? (
          <>
            {waitingRows.length > 0 || filter.show === "done" ? (
              <h2 className="chat-sec">
                <span>{tx(filter.show === "done" ? T.secDone : T.secOthers)}</span>
              </h2>
            ) : null}
            {rows(otherRows)}
          </>
        ) : null}
        {list.hidden > 0 ? <p className="chat-more">{tx(T.more(list.hidden))}</p> : null}
      </>
    );
  }

  const opened = Boolean(thread) || Boolean(opening);
  let pane: ReactNode;
  if (opening && opening.id !== shownId) pane = <OpeningPane item={opening} onBack={back} />;
  else if (thread)
    pane = (
      <ChatThread
        key={thread.head.id}
        data={thread}
        myName={myName}
        now={now}
        previewing={previewing}
        canOpenChild={canOpenChild}
        seesAll={seesAll}
        onBack={back}
        onLeave={leave}
        onMoved={moved}
        onChanged={refreshSoon}
      />
    );
  else
    pane = (
      <section className="chat-threadpane" aria-hidden="true">
        <div className="chat-pick">
          <span className="chat-pick-ic">
            <Ic n="message" size={34} />
          </span>
          <strong>{tx(T.pickChat)}</strong>
          <span>{tx(T.pickChatBody)}</span>
        </div>
      </section>
    );

  return (
    <div className="vxt vx-page chat-page">
      <header className="chat-top">
        <div className="chat-top-titles">
          <span className="chat-top-crumb">{tx(T.crumb)}</span>
          <h1 className="chat-top-title serif">{tx(T.title)}</h1>
        </div>
        {list?.viewingTest ? (
          <Pill tone="warn" icon="flask">
            {tx(T.practice)}
          </Pill>
        ) : null}
        <HelpButton
          title={tx(T.helpTitle)}
          steps={[
            { icon: "message", title: tx(T.help1), body: tx(T.help1Body) },
            { icon: "send", title: tx(T.help2), body: tx(T.help2Body) },
            { icon: "checkCircle", title: tx(T.help3), body: tx(T.help3Body) },
          ]}
        />
      </header>

      <div className={`chat-grid${opened ? " chat-open" : ""}`}>
        <div className="chat-listpane">
          {notice === "old_link" ? (
            <div className="chat-banner info chat-card" role="status">
              <Ic n="info" size={18} style={{ flex: "none", marginTop: 1 }} />
              <span>{tx(T.oldLink)}</span>
            </div>
          ) : notice === "gone" ? (
            <div className="chat-banner warn chat-card" role="status">
              <Ic n="alert" size={18} style={{ flex: "none", marginTop: 1 }} />
              <span>{tx(T.gone)}</span>
            </div>
          ) : null}
          {list?.viewingTest && list.enabled ? (
            <div className="chat-banner info chat-card" role="note">
              <Ic n="flask" size={18} style={{ flex: "none", marginTop: 1 }} />
              <span>{tx(T.practiceBanner)}</span>
            </div>
          ) : null}

          {list?.enabled && list.counts ? (
            <nav className="chat-tabs" aria-label={tx(T.title)}>
              {CHAT_VIEWS.map((view) => {
                const on = filter.view === view;
                const count = list.counts?.[view] ?? { waiting: 0, total: 0 };
                return (
                  <Link
                    key={view}
                    href={chatsHref(filter, { view, teacherId: null, chat: openId })}
                    replace
                    scroll={false}
                    className={`chat-tab tap${on ? " on" : ""}`}
                    aria-current={on ? "page" : undefined}
                  >
                    <Ic n={VIEW_ICON[view]} size={18} />
                    <span>{tx(VIEW_LABEL[view])}</span>
                    <span className="chat-tab-n">{count.total}</span>
                    {count.waiting > 0 ? (
                      <span className="chat-tab-wait" aria-label={tx(T.waitingCount(count.waiting))}>
                        {count.waiting}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          ) : null}

          {list?.enabled && seesAll && filter.view === "class" && list.teachers.length > 0 ? (
            <div className="chat-chips hs" role="group" aria-label={tx(T.teachers)}>
              <Link href={chatsHref(filter, { teacherId: null, chat: openId })} replace scroll={false} className={`tap chip${filter.teacherId ? "" : " on"}`} aria-current={filter.teacherId ? undefined : "true"}>
                {tx(T.allTeachers)}
              </Link>
              {list.teachers.map((teacher) => {
                const on = filter.teacherId === teacher.staffId;
                return (
                  <Link
                    key={teacher.staffId}
                    href={chatsHref(filter, { teacherId: teacher.staffId, chat: openId })}
                    replace
                    scroll={false}
                    className={`tap chip${on ? " on" : ""}`}
                    aria-current={on ? "true" : undefined}
                  >
                    {teacher.name}
                    {teacher.waiting > 0 ? (
                      <span className="chat-chip-wait" aria-label={tx(T.waitingCount(teacher.waiting))}>
                        {teacher.waiting}
                      </span>
                    ) : (
                      <span className="num chat-chip-n">{teacher.total}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ) : null}

          {list?.enabled ? (
            <div className="chat-filters">
              {showSearch ? <SearchBox value={query} onChange={onQuery} placeholder={tx(T.search)} name="q" /> : null}
              <div className="chat-filter-row">
                <Seg
                  label={tx(T.showLabel)}
                  options={[
                    { value: "active", label: tx(T.showOpen) },
                    { value: "done", label: tx(T.showDone) },
                  ]}
                  value={filter.show === "done" ? "done" : "active"}
                  onChange={(value) => go(chatsHref(filter, { show: value, chat: openId }))}
                  style={{ flex: 1, minWidth: 0 }}
                />
                {mayDues ? (
                  <Link
                    href={chatsHref(filter, { dues: !filter.dues, chat: openId })}
                    replace
                    scroll={false}
                    className={`tap chip chat-dues${filter.dues ? " on" : ""}`}
                    aria-current={filter.dues ? "true" : undefined}
                  >
                    <Ic n="rupee" size={15} />
                    {tx(T.hasDues)}
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          {body}
        </div>

        {pane}
      </div>
    </div>
  );
}
