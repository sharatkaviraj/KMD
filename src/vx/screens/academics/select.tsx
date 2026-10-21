"use client";

import { useRouter } from "next/navigation";

import { Ic } from "@/vx/icons";

/**
 * A choice that is a URL: picking an option goes to `action` with it (and the
 * hidden values) in the query, so every state can be linked to. Drawn as a
 * chip, to sit in a card's header the way the design's controls do.
 *
 * The native select lies over the whole pill, invisible, so the whole pill
 * (44px tall at least) is the tap target — the drawn chip used to hold a
 * select 19px tall that a thumb often missed (smoke 20 Oct).
 */
export function AutoSelect({ name, label, value, options, hidden, action }: { name: string; label: string; value: string; options: { value: string; label: string }[]; hidden: Record<string, string>; action: string }) {
  const router = useRouter();
  const go = (v: string) => {
    const sp = new URLSearchParams({ ...hidden, [name]: v });
    router.replace(`${action}?${sp}`, { scroll: false });
  };
  const current = options.find((o) => o.value === value)?.label ?? "";
  return (
    <span className="tap chip" style={{ position: "relative", minHeight: 44, gap: 6, flex: "none", maxWidth: "100%" }}>
      <span aria-hidden="true" style={{ fontSize: 12, color: "var(--mut)" }}>{label}</span>
      <span aria-hidden="true" className="clip" style={{ fontWeight: 700, minWidth: 0 }}>{current}</span>
      <Ic n="chevDown" size={14} />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => go(e.target.value)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: 44, opacity: 0, border: 0, margin: 0, padding: 0, font: "inherit", cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </span>
  );
}
