"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";

import { decideParentSuggestionsAction, undoParentSuggestionsAction } from "@/app/(app)/inbox/parent-actions";
import { markAllLabel, SUGGESTION_WORDS as SW, type RegisterMark } from "@/modules/whatsapp/domain/parent-suggestion-words";
import { initials } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Face } from "@/vx/ui/face";
import { useToast } from "@/vx/ui/overlays";
import { Btn, Pill } from "@/vx/ui/primitives";

/*
 * Parents' notes (D-598): what Veer Patta AI read on WhatsApp about a
 * child's absence, waiting for the class teacher on Today, with Leave,
 * Absent and Not now on each, "Mark all" for the morning's, and what was
 * decided today with Undo. Needs you draws only the decided half, under its
 * queue. Every decision is the server's: a row says "Saving…" until the page
 * shows the answer, and is never shown as done before.
 */

export type ParentNoteRow = {
  /** The suggestion's id. */
  id: string;
  studentId: string | null;
  childName: string;
  classLabel: string | null;
  /** "Today · Sick · Class 6". */
  line: Pair;
  /** The parent's own words, one paragraph. */
  words: string | null;
  practice: boolean;
  /** An absence that covers today. */
  urgent: boolean;
  /** Once decided: "Leave · Test Teacher · 9:10 am". */
  decided: Pair | null;
};

const FAILED = p("That did not go through. Nothing was changed.", "यह नहीं हो पाया। कुछ नहीं बदला।");
const WAITING = (n: number) => p(`${n} waiting`, `${n} बाकी`);

export function ParentNotesCard({ waiting, decided, via, decidedOnly }: {
  waiting: ParentNoteRow[];
  decided: ParentNoteRow[];
  via: "teacher_home" | "needs_you";
  /** Needs you: its queue has the waiting ones; this card is "Decided today" only. */
  decidedOnly?: boolean;
}) {
  const { tx, sub } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  // The rows on their way to the server, and what is being asked of them.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  // Never drawn while an admin sees One as someone else: the server leaves the card out then.
  const undo = (ids: string[]) => {
    setBusy(new Set(ids));
    start(async () => {
      try {
        const result = await undoParentSuggestionsAction({ ids });
        toast.show({ text: tx(result.message), tone: result.ok ? "info" : "bad" });
        router.refresh();
      } catch {
        toast.show({ text: tx(FAILED), tone: "bad" });
      } finally {
        setBusy(new Set());
      }
    });
  };

  const decide = (rows: ParentNoteRow[], decision: "apply" | "dismiss", mark?: RegisterMark) => {
    if (pending || rows.length === 0) return;
    setBusy(new Set(rows.map((row) => row.id)));
    start(async () => {
      try {
        const result = await decideParentSuggestionsAction({ ids: rows.map((row) => row.id), decision, mark, via, kind: "absence", childName: rows.length === 1 ? rows[0].childName : null });
        if (result.ok) {
          toast.show({ text: tx(result.message), tone: "ok", undoLabel: tx(SW.undo), ms: 8000, undo: () => undo(result.decided) });
          if (result.refused.length) toast.show({ text: tx(result.refused[0].message), tone: "bad" });
        } else {
          toast.show({ text: tx(result.message), tone: "bad" });
        }
        // The row moves to "Decided today" when the page has the server's answer, not before.
        router.refresh();
      } catch {
        toast.show({ text: tx(FAILED), tone: "bad" });
      } finally {
        setBusy(new Set());
      }
    });
  };

  if (decidedOnly && decided.length === 0) return null;
  const heading = decidedOnly ? SW.decidedToday : SW.parentsNotes;
  const second = sub(heading);
  const open = waiting.filter((row) => !busy.has(row.id));

  return (
    <section className="card tc-card" aria-label={tx(heading)} style={{ order: waiting.length ? 0 : 3, display: "flex", flexDirection: "column", gap: 12, padding: decidedOnly ? 18 : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ flex: "none", width: 40, height: 40, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--oks)", color: "var(--ok)" }}>
          <Ic n={decidedOnly ? "history" : "message"} size={20} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{tx(heading)}</span>
          {second ? <span lang="hi" style={{ fontSize: 13, color: "var(--mut)" }}>{second}</span> : null}
        </span>
        {waiting.length ? <Pill tone="warn">{tx(WAITING(waiting.length))}</Pill> : null}
      </div>
      {decidedOnly ? null : <span style={{ fontSize: 13, color: "var(--mut)", lineHeight: 1.45 }}>{tx(SW.parentsNotesSub)}</span>}

      {waiting.map((row, index) => {
        const saving = busy.has(row.id);
        return (
          <div key={row.id} style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 16, background: row.urgent ? "var(--warns)" : "var(--s2)", animation: `xIn .32s var(--ease) ${index * 45}ms both` }}>
            <Who row={row} />
            {row.words ? <span style={{ fontSize: 14, lineHeight: 1.5, overflowWrap: "anywhere" }}>“{row.words}”</span> : null}
            {saving ? (
              <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, fontWeight: 600, color: "var(--mut)" }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: "currentColor", animation: "xPulse 1.2s ease infinite" }} />
                {tx(SW.deciding)}
              </span>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <Btn variant="pri" icon="check" disabled={pending} onClick={() => decide([row], "apply", "leave")}>{tx(SW.leave)}</Btn>
                <Btn disabled={pending} onClick={() => decide([row], "apply", "absent")}>{tx(SW.absent)}</Btn>
                <Btn variant="ghost" disabled={pending} onClick={() => decide([row], "dismiss")}>{tx(SW.notNow)}</Btn>
              </div>
            )}
          </div>
        );
      })}
      {open.length >= 2 ? (
        <Btn variant="soft" icon="ticks" disabled={pending} onClick={() => decide(open, "apply", "leave")} style={{ alignSelf: "flex-start" }}>{tx(markAllLabel(open.length, "leave"))}</Btn>
      ) : null}
      {waiting.length ? <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.5 }}>{tx(FOOT)}</span> : null}

      {decided.length ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {decidedOnly ? null : <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mut)", padding: "4px 0" }}>{tx(SW.decidedToday)}</span>}
          {decided.map((row) => (
            <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 56, borderTop: "1px solid var(--bd)", padding: "6px 0" }}>
              <Who row={row} small />
              <Btn variant="ghost" icon="undo" disabled={pending} onClick={() => undo([row.id])} ariaLabel={`${tx(SW.undo)} · ${row.childName}`}>
                {busy.has(row.id) ? tx(SW.deciding) : tx(SW.undo)}
              </Btn>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** What Leave, Absent and Not now do, said once under the buttons. */
const FOOT = p(
  "Leave or Absent is how the register starts the child; no absent message goes to the parent for them. A register already saved keeps its marks.",
  "छुट्टी या अनुपस्थित से रजिस्टर में बच्चा वैसा ही शुरू होगा; अभिभावक को अनुपस्थिति का संदेश नहीं जाएगा। पहले से सहेजा रजिस्टर नहीं बदलता।",
);

const FACE: CSSProperties = { flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, background: "var(--oks)", color: "var(--ok)" };

/** The child's face and name, and the one line: what the parent said, or what was decided and by whom. */
function Who({ row, small }: { row: ParentNoteRow; small?: boolean }) {
  const { tx } = useVx();
  const size = small ? 36 : 44;
  return (
    <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12 }}>
      <Face style={{ ...FACE, width: size, height: size, borderRadius: size / 2, fontSize: small ? 13 : 15 }} student={row.studentId} zoom={row.childName} zoomSub={row.classLabel}>{initials(row.childName)}</Face>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <strong style={{ fontSize: small ? 14 : 15, overflowWrap: "anywhere" }}>{row.childName}</strong>
          {row.practice ? <Pill tone="warn">{tx(SW.practice)}</Pill> : null}
        </span>
        <span style={{ fontSize: 13, color: row.decided ? "var(--ok)" : "var(--mut)", fontWeight: row.decided ? 600 : 400, overflowWrap: "anywhere" }}>{tx(row.decided ?? row.line)}</span>
      </span>
    </span>
  );
}
