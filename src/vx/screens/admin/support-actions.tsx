"use client";

import Link from "@/vx/ui/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { dayMonth } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { replyToNoteAction, setNoteStatusAction } from "@/vx/screens/notes/actions";
import { excerpt, followUpLabel, followUpOwnerText, type FollowOwner, type NoteStatus } from "@/vx/screens/notes/domain/notes";
import { p, type Pair } from "@/vx/text";
import { Textarea } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Btn, Pill } from "@/vx/ui/primitives";

export type SupportAction = {
  id: string;
  body: string;
  status: NoteStatus;
  followUpOn: string | null;
  followUpOwner: FollowOwner | null;
  followUpName: string | null;
  by: string;
  canWork?: boolean;
};

type Mode = { id: string; kind: "update" | "done" } | null;

/**
 * Every open support action for one child, worked where it is shown (notes
 * §6, D-266). Working, Done and Add update write the same note the notes
 * board and the teacher's Today read, so one change shows in all three.
 *
 * Done asks what was tried and what changed — optional, kept as an update on
 * the note — because a review is a record of the work, not a verdict on the
 * child. A late review is shown as late, in amber, never as the child's
 * failure.
 */
export function SupportActions({ actions, today, notesHref }: { actions: SupportAction[]; today: string; notesHref: string }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<Pair | null>(null);
  const [pending, start] = useTransition();

  const open = (id: string, kind: "update" | "done") => {
    setMode({ id, kind });
    setText("");
    setError(null);
  };

  const run = (work: () => Promise<{ ok: boolean; error?: Pair }>, done: Pair) =>
    start(async () => {
      const res = await work();
      if (!res.ok) return setError(res.error ?? p("Not saved. Try again.", "सहेजा नहीं गया। फिर से कोशिश करें।"));
      toast.show({ text: tx(done) });
      setMode(null);
      setText("");
      router.refresh();
    });

  const setStatus = (id: string, status: NoteStatus, done: Pair) => run(() => setNoteStatusAction(id, status), done);

  const save = (a: SupportAction, kind: "update" | "done") => {
    const body = text.trim();
    if (kind === "update") {
      if (!body) return setError(p("Write the update first.", "पहले अपडेट लिखें।"));
      return run(() => replyToNoteAction(a.id, body, "typed"), p("Update added", "अपडेट जोड़ा गया"));
    }
    return run(async () => {
      if (body) {
        const reply = await replyToNoteAction(a.id, body, "typed");
        if (!reply.ok) return reply;
      }
      return setNoteStatusAction(a.id, "done");
    }, p("Marked done", "पूरा किया गया"));
  };

  return (
    <ul data-support-actions style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {actions.map((a) => {
        const owner = followUpOwnerText({ followUpOwner: a.followUpOwner, followUpName: a.followUpName, writtenByName: a.by });
        const review = followUpLabel(a.followUpOn, today, dayMonth);
        const editing = mode?.id === a.id ? mode.kind : null;
        return (
          <li key={a.id} style={{ padding: "12px 14px", borderRadius: 14, background: "var(--s2)", display: "flex", flexDirection: "column", gap: 8 }}>
            <Link href={`${notesHref}&note=${a.id}`} style={{ color: "var(--fg)", fontSize: 15 }}>{excerpt(a.body, 160)}</Link>
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {a.status === "working" ? <Pill tone="acc">{tx(p("Working on it", "काम चल रहा है"))}</Pill> : null}
              {owner ? <Pill tone="mut" icon="user">{tx(p(`Owner: ${tx(owner)}`, `ज़िम्मेदार: ${tx(owner)}`))}</Pill> : null}
              {review ? <Pill tone={review.tone} icon="flag">{tx(p(`Review: ${tx(review.text)}`, `समीक्षा: ${tx(review.text)}`))}</Pill> : null}
            </span>
            {editing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Textarea
                  rows={2}
                  maxLength={1000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-label={tx(editing === "done" ? p("What was tried and what changed", "क्या किया गया और क्या बदला") : p("Update", "अपडेट"))}
                  placeholder={tx(editing === "done" ? p("What was tried and what changed (optional)", "क्या किया गया और क्या बदला (वैकल्पिक)") : p("What happened since?", "तब से क्या हुआ?"))}
                />
                {error ? <p role="alert" style={{ margin: 0, color: "var(--bad)", fontWeight: 600, fontSize: 14 }}>{tx(error)}</p> : null}
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Btn variant="pri" disabled={pending} onClick={() => save(a, editing)}>
                    {tx(pending ? p("Saving…", "सहेज रहे हैं…") : editing === "done" ? p("Mark done", "पूरा करें") : p("Save update", "अपडेट सहेजें"))}
                  </Btn>
                  <Btn variant="ghost" disabled={pending} onClick={() => setMode(null)}>{tx(p("Cancel", "रद्द करें"))}</Btn>
                </span>
              </div>
            ) : (
              <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="soft" icon="message" onClick={() => open(a.id, "update")}>{tx(p("Add update", "अपडेट जोड़ें"))}</Btn>
                {a.canWork && a.status === "open" ? (
                  <Btn variant="ghost" disabled={pending} onClick={() => setStatus(a.id, "working", p("Marked working", "काम शुरू दर्ज"))}>{tx(p("Working on it", "काम चल रहा है"))}</Btn>
                ) : null}
                {a.canWork ? <Btn variant="ghost" icon="check" onClick={() => open(a.id, "done")}>{tx(p("Done", "पूरा"))}</Btn> : null}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
