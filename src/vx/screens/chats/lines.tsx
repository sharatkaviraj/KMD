"use client";

import { Fragment, type ReactNode } from "react";

import { timeP } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";

import { sizeWords, type DrawnLine } from "./logic";
import type { ChatFileView, ChatMessageView, Tick } from "./view";
import { T } from "./words";

/*
 * One line of a chat (D-616), drawn the way WhatsApp draws it: the parent's
 * on the left in white, the school's on the right in green with ticks, Veer
 * Patta AI's on the right in grey and named, and what happened at school
 * (passed on, finished) as a small yellow note in the middle that only staff
 * see.
 */

const TICK_ICON: Record<Tick, IconName> = {
  sending: "clock",
  sent: "check",
  delivered: "ticks",
  read: "ticks",
  waiting: "clock",
  failed: "alert",
};

function TickMark({ tick }: { tick: Tick }) {
  const { tx } = useVx();
  const tone = tick === "read" ? " read" : tick === "failed" ? " failed" : "";
  return (
    <span className={`chat-tick${tone}`} role="img" aria-label={tx(T.tick[tick])} title={tx(T.tick[tick])}>
      <Ic n={TICK_ICON[tick]} size={15} stroke={tick === "sending" || tick === "waiting" ? 2 : 2.4} />
    </span>
  );
}

const LINK = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;

/** The words of a message, with any web link tappable. */
function Words({ text }: { text: string }) {
  const parts = text.split(LINK);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", textDecoration: "underline" }}>
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function FileCard({ file }: { file: ChatFileView }) {
  const { tx } = useVx();
  const size = sizeWords(file.bytes);
  const inner = (
    <>
      <span className="chat-file-ic" aria-hidden="true">
        <Ic n="fileText" size={22} />
      </span>
      <span className="chat-file-name">
        <span className="clip">{file.name}</span>
        <small>{[size, file.url ? tx(T.openFile) : null].filter(Boolean).join(" · ")}</small>
      </span>
    </>
  );
  // A file still sending has nowhere to open yet.
  if (!file.url || file.url.startsWith("blob:")) return <span className="chat-file">{inner}</span>;
  return (
    <a className="chat-file tap" href={file.url} target="_blank" rel="noopener noreferrer" aria-label={`${tx(T.openFile)}: ${file.name}`}>
      {inner}
    </a>
  );
}

function Media({ line, onPhoto, onLoad }: { line: ChatMessageView; onPhoto: (file: ChatFileView) => void; onLoad: () => void }) {
  const { tx } = useVx();
  const file = line.file;
  if (!file) return null;
  if (file.kind === "image" || file.kind === "sticker") {
    // A line still sending shows the photo from the phone itself; it opens once it is saved.
    const sending = file.url.startsWith("blob:") || !file.url;
    return (
      <button
        type="button"
        className="chat-img"
        onClick={() => (sending ? undefined : onPhoto(file))}
        aria-label={tx(T.photo)}
        style={file.kind === "sticker" ? { maxWidth: 140, background: "transparent" } : undefined}
      >
        {file.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private file through One's own check, never optimised by Next
          <img src={file.url} alt={tx(T.photo)} loading="lazy" decoding="async" onLoad={onLoad} />
        ) : (
          <span className="chat-img-wait" aria-hidden="true">
            <Ic n="image" size={28} />
          </span>
        )}
      </button>
    );
  }
  if (file.kind === "audio") {
    return (
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--mut)" }}>
          <Ic n="mic" size={14} />
          {tx(T.voiceNote)}
        </span>
        <audio className="chat-audio" controls preload="none" src={file.url} />
      </span>
    );
  }
  if (file.kind === "video") {
    return <video className="chat-audio" style={{ width: 260, borderRadius: 8 }} controls preload="none" src={file.url} />;
  }
  return <FileCard file={file} />;
}

function Body({ line }: { line: ChatMessageView }) {
  const { tx } = useVx();
  if (line.kind === "tap") {
    return (
      <span style={{ fontStyle: "italic" }}>
        {tx(T.tapped)}: <Words text={line.body ?? ""} />
      </span>
    );
  }
  if (line.kind === "other") return <span style={{ fontStyle: "italic", color: "var(--mut)" }}>{tx(T.notPassedOn)}</span>;
  if (line.kind === "location") {
    return (
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {line.body ? <Words text={line.body} /> : null}
        {line.map ? (
          <a href={line.map} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: "var(--info)" }}>
            <Ic n="mapPin" size={16} />
            {tx(T.map)}
          </a>
        ) : null}
      </span>
    );
  }
  if (line.kind === "contacts" && line.contacts) {
    return (
      <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {line.contacts.map((person, index) => (
          <span key={index} style={{ display: "flex", flexDirection: "column" }}>
            <strong>{person.name ?? "—"}</strong>
            {person.phones.map((phone) => (
              <a key={phone} href={`tel:${phone.replace(/[^\d+]/g, "")}`} style={{ color: "var(--info)" }}>
                {phone}
              </a>
            ))}
          </span>
        ))}
      </span>
    );
  }
  return line.body ? <Words text={line.body} /> : null;
}

export function ChatNote({ line }: { line: ChatMessageView }) {
  const { tx } = useVx();
  return (
    <div className="chat-note" role="note">
      {line.event ? tx(line.event) : line.body}
      {line.event && line.body ? <em>“{line.body}”</em> : null}
    </div>
  );
}

export function ChatLine({
  drawn,
  myName,
  onPhoto,
  onMediaLoad,
  onSendAgain,
  againBusy,
  mayWrite,
}: {
  drawn: DrawnLine;
  myName: string;
  onPhoto: (file: ChatFileView) => void;
  /** A photo finished loading (the chat keeps its place at the bottom). */
  onMediaLoad: () => void;
  onSendAgain: (line: ChatMessageView) => void;
  againBusy: boolean;
  mayWrite: boolean;
}) {
  const { tx } = useVx();
  const { line, head } = drawn;
  if (line.direction === "note") return <ChatNote line={line} />;
  const failed = line.tick === "failed";
  const waiting = line.tick === "waiting";
  const mine = line.direction === "out" && Boolean(line.by) && line.by?.en === myName;
  let who: ReactNode = null;
  if (head && line.direction === "ai") {
    who = (
      <span className="chat-ai-tag">
        <Ic n="sparkle" size={13} />
        {tx(T.ai)}
      </span>
    );
  } else if (head && line.direction === "out" && line.by) {
    who = <span className="chat-who">{mine ? tx(T.you) : tx(line.by)}</span>;
  }
  return (
    <div className={`chat-line ${line.direction}${head ? " gap" : ""}${failed ? " failed" : ""}`}>
      {who}
      <div className="chat-bub">
        <Media line={line} onPhoto={onPhoto} onLoad={onMediaLoad} />
        <Body line={line} />
        <span className="chat-meta">
          <span>{tx(timeP(line.at))}</span>
          {line.tick ? <TickMark tick={line.tick} /> : null}
        </span>
      </div>
      {failed || waiting ? (
        <div className={`chat-problem${waiting ? " wait" : ""}`}>
          <Ic n={failed ? "alert" : "clock"} size={14} />
          <span>{line.problem ? tx(line.problem) : tx(failed ? T.tick.failed : T.tick.waiting)}</span>
          {failed && line.resent ? <span style={{ fontWeight: 700 }}>{tx(T.sentAgain)}</span> : null}
          {failed && !line.resent && mayWrite ? (
            <button type="button" className="tap btn sec" style={{ height: 36, padding: "0 12px", fontSize: 13 }} disabled={againBusy} onClick={() => onSendAgain(line)}>
              <Ic n="refresh" size={15} className={againBusy ? "spin" : undefined} />
              {tx(T.sendAgain)}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The date line that opens a day's messages. */
export function DayLine({ label }: { label: string }) {
  return (
    <div className="chat-day" role="separator">
      {label}
    </div>
  );
}
