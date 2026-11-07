"use client";

import { useEffect, useState } from "react";
import { recordTaskSentAction, taskSendQueueAction } from "@/app/(app)/teach/tasks/delivery-actions";
import type { Language } from "@/platform/i18n/language";
import { cue } from "@/ui/feedback/cue";
import Link from "@/ui/link";
import { Ic } from "@/vx/icons";
import { lead, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";
import { Avatar, Btn, Pill, Progress, Skel, SuccessTick } from "@/vx/ui/primitives";
import { entryMessage, nextEntry, type SendEntry, type SendKind } from "../domain/send-queue";
import { CW } from "./collect-words";

/*
 * The send list (D-521), Sampark's send queue in One: every teacher on one
 * screen, each with one green button that opens WhatsApp with their own
 * message and link already typed. The button is a real link, built before
 * the tap, so the phone opens WhatsApp straight away (no second "Open
 * WhatsApp" step, nothing for a pop-up blocker to stop); the tap also notes
 * the send, the same record the task sheet writes. Nothing is ever sent by
 * the app: the office presses Send in WhatsApp.
 */

type Loaded = { today: string; entries: SendEntry[] };

const WA_GREEN = "#1FA855";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function SendQueue({ kind, ids, language, onRecorded }: {
  kind: SendKind;
  ids: readonly string[];
  language: Language;
  /** Called once a send is noted, so the board behind can refresh when the list closes. */
  onRecorded?: () => void;
}) {
  const say = (pair: Pair) => lead(pair, language);
  const toast = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [noted, setNoted] = useState<Readonly<Record<string, "ok" | "failed">>>({});
  const [shown, setShown] = useState<string | null>(null);
  const key = `${kind}|${ids.join(",")}`;

  useEffect(() => {
    let live = true;
    const [which, list] = key.split("|");
    taskSendQueueAction(which as SendKind, list ? list.split(",") : []).then(
      (result) => { if (!live) return; if (result.ok) setLoaded({ today: result.today, entries: result.entries }); else setFailed(true); },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; };
  }, [key, attempt]);

  const retry = () => { setFailed(false); setLoaded(null); setAttempt((n) => n + 1); };

  if (failed) {
    return (
      <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
        <p style={{ margin: 0 }}>{say(CW.loadFailed)}</p>
        <Btn icon="refresh" onClick={retry}>{say(CW.tryAgain)}</Btn>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p aria-live="polite" style={{ margin: 0, fontSize: 14, color: "var(--mut)", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="vx-dots" aria-hidden="true" style={{ display: "inline-flex", gap: 3 }}>
            {[0, 1, 2].map((i) => <span key={i} style={{ width: 6, height: 6, borderRadius: 3, background: "var(--acc)", animation: `xPulse 1s ease ${i * 160}ms infinite` }} />)}
          </span>
          {say(CW.loading)}
        </p>
        {[0, 1, 2].map((i) => <Skel key={i} h={112} r={16} />)}
      </div>
    );
  }

  const { entries, today } = loaded;
  const sendable = entries.filter((e) => !e.blocked && e.mobile && e.url);
  const finishedCount = sendable.filter((e) => e.done || sent.has(e.taskId)).length;
  const next = nextEntry(entries, sent);
  const allDone = sendable.length > 0 && finishedCount === sendable.length;

  const tapped = (entry: SendEntry) => {
    const remaining = sendable.filter((e) => !e.done && !sent.has(e.taskId) && e.taskId !== entry.taskId).length;
    cue(remaining === 0 ? "done" : "tap");
    setSent((all) => new Set(all).add(entry.taskId));
    recordTaskSentAction(entry.taskId, kind).then(
      (result) => {
        setNoted((all) => ({ ...all, [entry.taskId]: result.ok ? "ok" : "failed" }));
        if (result.ok) onRecorded?.();
      },
      () => setNoted((all) => ({ ...all, [entry.taskId]: "failed" })),
    );
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ text: say(CW.copied), tone: "ok" });
    } catch {
      toast.show({ text: say(CW.copyFailed), tone: "bad" });
    }
  };

  if (entries.length === 0) {
    return <p style={{ margin: 0, padding: "18px 0", textAlign: "center", color: "var(--mut)" }}>{say(CW.nobody)}</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>{say(CW.sendHow)}</p>
      {sendable.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="num" aria-live="polite" style={{ fontSize: 13, fontWeight: 700, color: allDone ? "var(--ok)" : "var(--mut)" }}>{say(CW.progress(finishedCount, sendable.length))}</span>
          <Progress value={finishedCount} max={sendable.length} tone={allDone ? "var(--ok)" : WA_GREEN} height={10} />
        </div>
      ) : null}
      {allDone ? (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 16, background: "var(--oks)", animation: "xPopIn .5s var(--ease) both" }}>
          <SuccessTick size={44} />
          <strong style={{ fontSize: 15 }}>{say(kind === "initial" ? CW.allSent : CW.allReminded)}</strong>
        </div>
      ) : null}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {entries.map((entry, i) => {
          const { text, href } = entryMessage(entry, kind, today);
          const tappedNow = sent.has(entry.taskId);
          const isNext = entry.taskId === next;
          const done = entry.done || tappedNow;
          // The details asked for, unless the work is already named after them.
          const asked = entry.fields.map((f) => (language === "hi" ? f.hi || f.en : f.en)).join(", ");
          const detail = [entry.group, entry.students > 0 ? say(CW.forWhom(entry.students)) : null, asked && asked.toLowerCase() !== entry.title.toLowerCase() ? asked : null].filter(Boolean).join(" · ");
          return (
            <li
              key={entry.taskId}
              className="card"
              style={{
                padding: "14px 14px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                borderColor: isNext ? WA_GREEN : undefined,
                boxShadow: isNext ? `0 0 0 2px ${WA_GREEN}33` : undefined,
                opacity: entry.blocked === "finished" ? 0.7 : 1,
                animation: `xIn .35s var(--ease) ${Math.min(i * 50, 400)}ms both`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <Avatar text={initials(entry.teacherName)} seed={entry.teacherName} size={44} />
                <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <strong style={{ fontSize: 16, lineHeight: 1.25, overflowWrap: "anywhere" }}>{entry.teacherName}</strong>
                  <span style={{ fontSize: 13, color: "var(--mut)", overflowWrap: "anywhere" }}>{entry.title}{detail ? ` · ${detail}` : ""}</span>
                </div>
                {done ? (
                  <span style={{ animation: tappedNow ? "xTick .4s var(--ease) both" : undefined }}>
                    <Pill tone="ok" icon="check">{say(entry.done && !tappedNow ? (kind === "initial" ? CW.alreadySent : CW.remindedTick) : kind === "initial" ? CW.sentTick : CW.remindedTick)}</Pill>
                  </span>
                ) : isNext ? (
                  <Pill tone="acc">{say(CW.next)}</Pill>
                ) : null}
              </div>
              {entry.blocked === "check" || entry.blocked === "no-link" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 12, background: "var(--warns)", color: "var(--warnfg)", fontSize: 13 }}>
                  <span>{say(entry.blocked === "check" ? CW.blockedCheck : CW.blockedLink)}</span>
                  <Link href={`/inbox?view=collect&task=${entry.taskId}`} className="tap" style={{ fontWeight: 700, color: "inherit", display: "inline-flex", alignItems: "center", gap: 4, minHeight: 32 }}>
                    {say(CW.openWorkOf)} <Ic n="chevRight" size={16} />
                  </Link>
                </div>
              ) : entry.blocked === "finished" ? (
                <span style={{ fontSize: 13, color: "var(--ok)", fontWeight: 600 }}>{say(CW.finished)}</span>
              ) : href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => tapped(entry)}
                  className={`tap btn big${done ? " sec" : ""}`}
                  style={done ? { width: "100%" } : { width: "100%", background: WA_GREEN, borderColor: WA_GREEN, color: "#fff" }}
                >
                  <Ic n={kind === "initial" ? "send" : "bell"} size={20} />
                  {say(done ? CW.sendAgain : kind === "initial" ? CW.sendOn : CW.remindOn)}
                </a>
              ) : (
                <p role="note" style={{ margin: 0, padding: "10px 12px", borderRadius: 12, background: "var(--warns)", color: "var(--warnfg)", fontSize: 13 }}>{say(CW.noMobile)}</p>
              )}
              {noted[entry.taskId] === "failed" ? <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--warnfg)" }}>{say(CW.recordFailed)}</p> : null}
              {entry.url && entry.blocked !== "finished" && entry.blocked !== "check" ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <Btn variant="ghost" icon="copy" onClick={() => void copy(text)}>{say(CW.copy)}</Btn>
                  <Btn variant="ghost" icon={shown === entry.taskId ? "chevUp" : "message"} onClick={() => setShown((cur) => (cur === entry.taskId ? null : entry.taskId))}>{say(CW.seeMessage)}</Btn>
                </div>
              ) : null}
              {shown === entry.taskId ? (
                <div style={{ alignSelf: "flex-end", maxWidth: "100%", padding: "10px 12px", borderRadius: "14px 14px 4px 14px", background: "#DCF8C6", color: "#111B21", fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere", animation: "xIn .25s var(--ease) both" }}>{text}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {sendable.length > 0 ? (
        <p style={{ margin: 0, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--mut)" }}>
          <Ic n="mic" size={18} style={{ flex: "none", color: "var(--acc)" }} />
          <span>{say(CW.voiceTip)}</span>
        </p>
      ) : null}
    </div>
  );
}
