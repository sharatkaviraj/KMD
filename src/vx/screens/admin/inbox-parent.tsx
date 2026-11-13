"use client";

import type { CSSProperties } from "react";

import { markAllLabel, SUGGESTION_WORDS as SW, type RegisterMark } from "@/modules/whatsapp/domain/parent-suggestion-words";
import { initials } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { Face } from "@/vx/ui/face";
import { Btn, Pill } from "@/vx/ui/primitives";
import type { InboxItem } from "@/vx/screens/admin/types";

/*
 * A parent's suggestion in Needs you (D-598): the child's face beside what
 * the parent said, a record change side by side, the parent's own words, and
 * big buttons that decide it at once. Nothing reaches a record until one of
 * them is pressed, and the toast after it offers Undo.
 */

export type ParentDecide = (items: InboxItem[], decision: "apply" | "dismiss", mark?: RegisterMark) => void;

const TILE: CSSProperties = { flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, background: "var(--oks)", color: "var(--ok)" };

/** What the parent said: the face and the one line, the change, their words, and their number to call. */
export function ParentBody({ item, big }: { item: InboxItem; big?: boolean }) {
  const { tx } = useVx();
  const parent = item.parent;
  if (!parent) return null;
  const size = big ? 56 : 44;
  const tile: CSSProperties = { ...TILE, width: size, height: size, borderRadius: size / 2, fontSize: big ? 18 : 15 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: big ? 14 : 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {parent.studentId ? (
          <Face style={tile} student={parent.studentId} zoom={parent.childName} zoomSub={parent.classLabel}>{initials(parent.childName)}</Face>
        ) : (
          <span aria-hidden="true" style={tile}><Ic n="userPlus" size={big ? 24 : 20} /></span>
        )}
        <span style={{ flex: 1, minWidth: 0, fontSize: big ? 16 : 14, color: "var(--mut)", lineHeight: 1.4, overflowWrap: "anywhere" }}>{tx(item.sub)}</span>
        {parent.practice ? <Pill tone="warn">{tx(SW.practice)}</Pill> : null}
      </div>
      {parent.change ? (
        <div className="card" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "center", gap: 10, padding: big ? "14px 18px" : "10px 14px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SW.was)}</span>
            <span style={{ fontWeight: 600, overflowWrap: "anywhere", color: parent.change.was ? "var(--fg)" : "var(--mut)" }}>{parent.change.was ?? "—"}</span>
          </span>
          <Ic n="arrowRight" size={18} />
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>{tx(SW.becomes)}</span>
            <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{parent.change.becomes}</span>
          </span>
        </div>
      ) : null}
      {parent.words ? (
        <figure style={{ margin: 0, padding: "10px 14px", borderRadius: 12, background: "var(--s2)", borderLeft: "3px solid var(--ok)" }}>
          <figcaption style={{ fontSize: 12, color: "var(--mut)", marginBottom: 4 }}>{tx(SW.parentWrote)}</figcaption>
          <blockquote style={{ margin: 0, fontSize: big ? 15 : 14, lineHeight: 1.5, overflowWrap: "anywhere" }}>“{parent.words}”</blockquote>
        </figure>
      ) : null}
      {parent.phone ? (
        <a className="tap" href={`tel:${parent.phone.replace(/\s/g, "")}`} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, color: "var(--accfg)", fontWeight: 600, textDecoration: "none" }}>
          <Ic n="phone" size={18} />
          {tx(SW.call)} · <span className="num">{parent.phone}</span>
        </a>
      ) : null}
    </div>
  );
}

/** The decision, in the words of what it does: Leave or Absent, Add to Admissions, or Apply; and Not now. */
export function ParentButtons({ item, decide, busy, big }: { item: InboxItem; decide: ParentDecide; busy: boolean; big?: boolean }) {
  const { tx } = useVx();
  const parent = item.parent;
  if (!parent) return null;
  const style: CSSProperties | undefined = big ? { height: 44, padding: "0 20px", fontSize: 15 } : undefined;
  const quiet: CSSProperties | undefined = big ? { height: 44, color: "var(--mut)" } : undefined;
  const open = item.href ? <Btn variant="ghost" style={quiet} href={item.href}>{tx(parent.kind === "visit" ? SW.openAdmissions : SW.openRecord)}</Btn> : null;
  const notNow = <Btn style={style} disabled={busy} onClick={() => decide([item], "dismiss")}>{tx(SW.notNow)}</Btn>;
  if (parent.kind === "absence") {
    return (
      <>
        <Btn variant="pri" icon="check" style={style} disabled={busy} onClick={() => decide([item], "apply", "leave")}>{tx(SW.leave)}</Btn>
        <Btn style={style} disabled={busy} onClick={() => decide([item], "apply", "absent")}>{tx(SW.absent)}</Btn>
        {notNow}
        {open}
      </>
    );
  }
  return (
    <>
      <Btn variant="pri" icon="check" style={style} disabled={busy} onClick={() => decide([item], "apply")}>{tx(parent.kind === "visit" ? SW.addVisit : SW.apply)}</Btn>
      {notNow}
      {open}
    </>
  );
}

/** "Mark all 4 as Leave": every parent's absence this list shows, in one tap. Hidden below two. */
export function ParentMarkAll({ items, decide, busy }: { items: InboxItem[]; decide: ParentDecide; busy: boolean }) {
  const { tx } = useVx();
  const absences = items.filter((item) => item.parent?.kind === "absence");
  if (absences.length < 2) return null;
  return (
    <Btn variant="soft" icon="ticks" disabled={busy} onClick={() => decide(absences, "apply", "leave")}>
      {tx(markAllLabel(absences.length, "leave"))}
    </Btn>
  );
}
