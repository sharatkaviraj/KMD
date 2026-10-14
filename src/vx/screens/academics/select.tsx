"use client";

import { useRouter } from "next/navigation";

import { Ic } from "@/vx/icons";

/**
 * A choice that is a URL: picking an option goes to `action` with it (and the
 * hidden values) in the query, so every state can be linked to. Drawn as a
 * chip, to sit in a card's header the way the design's controls do.
 */
export function AutoSelect({ name, label, value, options, hidden, action }: { name: string; label: string; value: string; options: { value: string; label: string }[]; hidden: Record<string, string>; action: string }) {
  const router = useRouter();
  const go = (v: string) => {
    const sp = new URLSearchParams({ ...hidden, [name]: v });
    router.replace(`${action}?${sp}`, { scroll: false });
  };
  return (
    <label className="tap chip" style={{ height: 40, gap: 6, flex: "none" }}>
      <span style={{ fontSize: 12, color: "var(--mut)" }}>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => go(e.target.value)} style={{ border: 0, background: "transparent", color: "inherit", font: "inherit", fontWeight: 700, outline: "none", WebkitAppearance: "none", appearance: "none", cursor: "pointer", paddingRight: 2 }}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <Ic n="chevDown" size={14} />
    </label>
  );
}
