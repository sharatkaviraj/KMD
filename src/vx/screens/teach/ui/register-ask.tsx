"use client";

import { MARK_LABELS, type RegisterMark } from "@/modules/whatsapp/domain/parent-suggestion-words";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";

/**
 * "Parent says sick" under a child on the register, with Leave and Absent
 * (D-601; the owner's idea 3). A tap only marks the child, like a tap on the
 * card: nothing is applied until the teacher saves, and saving the child as
 * Leave or Absent applies the parent's note with that mark. In its own
 * chunk, fetched only when a parent's note waits on this register:
 * `/teach/attendance` is the tightest page budget in One (`check:bundles`).
 */
export function RegisterAsk({ name, line, mark, onMark }: { name: string; line: Pair; mark: string | undefined; onMark: (mark: RegisterMark) => void }) {
  const { tx } = useVx();
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <span style={{ flex: "1 1 160px", minWidth: 0, display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, color: "var(--info)" }}>
        <Ic n="message" size={14} />
        <span>{tx(line)}</span>
      </span>
      {(["leave", "absent"] as const).map((choice) => {
        const on = mark === choice;
        return (
          <button
            key={choice}
            type="button"
            className="tap chip"
            aria-pressed={on}
            aria-label={`${tx(MARK_LABELS[choice])} · ${name}`}
            onClick={() => onMark(choice)}
            style={{ height: 40, padding: "0 14px", fontSize: 14, background: on ? "var(--infos)" : "var(--card)", color: on ? "var(--info)" : "var(--fg)" }}
          >
            {on ? <Ic n="check" size={15} /> : null}
            {tx(MARK_LABELS[choice])}
          </button>
        );
      })}
    </div>
  );
}
