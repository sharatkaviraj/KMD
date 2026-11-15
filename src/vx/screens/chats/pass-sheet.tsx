"use client";

import { useId, useState } from "react";

import { cue } from "@/ui/feedback/cue";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { Sheet, useToast } from "@/vx/ui/overlays";

import { passChatAction } from "@/app/(app)/chats/actions";

import type { ChatHeadView, PassTargetView } from "./view";
import { T } from "./words";

/*
 * "Give to someone else" (D-617): one sheet, one question — who should reply?
 * — with each choice a big button naming a person or an office, and an
 * optional note for them that the parent never sees. The chat moves to them
 * and they are told at once.
 */

function iconFor(target: PassTargetView): IconName {
  if (target.desk === "class") return "users";
  if (target.desk === "accounts") return "rupee";
  return target.principal ? "award" : "building";
}

export function PassSheet({
  open,
  onClose,
  head,
  onPassed,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  head: ChatHeadView;
  onPassed: () => void;
  onMoved: (to: string) => void;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const noteId = useId();
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  // Each opening starts with nothing chosen.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPick(null);
      setNote("");
      setBusy(false);
    }
  }

  const chosen = head.passTargets.find((target) => target.key === pick) ?? null;

  const give = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    try {
      const result = await passChatAction({ chatId: head.id, desk: chosen.desk, teacherId: chosen.teacherId, principal: chosen.principal, note });
      if (!result.ok) {
        toast.show({ tone: "bad", text: tx(result.words) });
        if (result.moved) onMoved(result.moved);
        return;
      }
      toast.show({ text: tx(T.passed), cue: "done" });
      onClose();
      onPassed();
    } catch {
      toast.show({ tone: "bad", text: tx(T.failed) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(T.passTitle)}
      sub={tx(T.passWhy)}
      icon="send"
      backCloses
      footer={
        <button type="button" className="tap btn pri big" style={{ flex: 1 }} disabled={!chosen || busy} onClick={() => void give()}>
          {busy ? <Ic n="refresh" size={20} className="spin" /> : <Ic n="send" size={20} />}
          {tx(chosen ? T.passTo : T.passPick)}
        </button>
      }
    >
      <div className="chat-targets" role="radiogroup" aria-label={tx(T.passTitle)}>
        {head.passTargets.map((target) => {
          const on = target.key === pick;
          return (
            <button
              key={target.key}
              type="button"
              role="radio"
              aria-checked={on}
              className={`chat-target tap${on ? " on" : ""}`}
              onClick={() => {
                cue("select");
                setPick(target.key);
              }}
            >
              <span className="chat-target-ic" aria-hidden="true">
                <Ic n={on ? "check" : iconFor(target)} size={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{tx(target.label)}</span>
            </button>
          );
        })}
      </div>
      <label htmlFor={noteId} className="field" style={{ marginTop: 16 }}>
        <span>{tx(T.passNote)}</span>
        <textarea
          id={noteId}
          className="inp"
          rows={2}
          maxLength={300}
          value={note}
          placeholder={tx(T.passNotePlaceholder)}
          onChange={(event) => setNote(event.target.value)}
          style={{ minHeight: 72, fontSize: 16 }}
        />
      </label>
    </Sheet>
  );
}
