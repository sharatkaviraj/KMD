"use client";

import { rupees } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { ChildAvatar } from "@/vx/ui/child-avatar";
import { Pill, type Tone } from "@/vx/ui/primitives";

import { rowTime } from "./logic";
import type { ChatListItem } from "./view";
import { T } from "./words";

/*
 * One chat as a row: the child's face, the parent's name, when they last
 * wrote, the last words and up to three tags. Chats draws it as a link and
 * the chat bubble's panel (D-641) as a button, so the two lists look the same.
 */

function RowTags({ item, dues, seesAll }: { item: ChatListItem; dues: number; seesAll: boolean }) {
  const { tx } = useVx();
  const tags: Array<{ key: string; tone: Tone; icon?: IconName; text: string }> = [];
  if (item.finishedItself) tags.push({ key: "itself", tone: "ok", icon: "checkCircle", text: tx(T.finishedItself) });
  if (item.wantsAdmin) tags.push({ key: "principal", tone: "warn", icon: "award", text: tx(T.wantsPrincipal) });
  if (item.complaint) tags.push({ key: "complaint", tone: "bad", icon: "alert", text: tx(T.complaint) });
  if (item.passedUp) tags.push({ key: "late", tone: "bad", icon: "clock", text: tx(T.noAnswerDay) });
  if (item.takenBy) tags.push({ key: "taken", tone: "info", icon: "message", text: tx(item.takenBy) });
  if (dues > 0) tags.push({ key: "dues", tone: "warn", icon: "rupee", text: tx(T.due(rupees(dues))) });
  if (seesAll && !item.wantsAdmin) tags.push({ key: "desk", tone: "acc", text: tx(item.deskLabel) });
  if (item.topic) tags.push({ key: "topic", tone: "mut", text: tx(item.topic) });
  if (tags.length === 0) return null;
  return (
    <span className="chat-row-tags">
      {tags.slice(0, 3).map((tag) => (
        <Pill key={tag.key} tone={tag.tone} icon={tag.icon}>
          {tag.text}
        </Pill>
      ))}
    </span>
  );
}

/** What goes inside a `.chat-row`: the face and the words beside it. */
export function ChatRowBody({
  item,
  selected,
  now,
  dues,
  seesAll,
}: {
  item: ChatListItem;
  selected: boolean;
  now: string;
  dues: number;
  seesAll: boolean;
}) {
  const { tx } = useVx();
  const waiting = item.status === "waiting";
  const unread = selected ? 0 : item.unread;
  return (
    <>
      <ChildAvatar text={item.initial} seed={item.id} size={48} student={item.studentId} />
      <span className="chat-row-main">
        <span className="chat-row-top">
          <span className="chat-row-name">{item.name}</span>
          <span className={`chat-row-time${waiting ? " wait" : ""}`}>{tx(rowTime(item.lastAt, now))}</span>
        </span>
        {item.children ? <span className="chat-row-kids">{item.children}</span> : null}
        <span className="chat-row-last">
          {waiting ? <Ic n="clock" size={14} style={{ flex: "none", color: "var(--bad)" }} aria-hidden="true" /> : null}
          {item.previewBy ? <span className="by">{tx(item.previewBy)}:</span> : null}
          <span className="txt">{tx(item.preview)}</span>
          {unread > 0 ? (
            <span className="chat-unread" aria-label={tx(T.unread(unread))}>
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </span>
        <RowTags item={item} dues={dues} seesAll={seesAll} />
      </span>
    </>
  );
}
