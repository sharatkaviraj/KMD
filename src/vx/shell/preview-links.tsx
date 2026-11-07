"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";

import { useSideCollapsed } from "./sidebar";
import { setViewAsAction } from "./view-as-actions";

/**
 * A line under "See the app as": a role's sample menu, or — key `person`,
 * first and admin-only — "Choose a person", which opens the picker for one
 * real member of staff's own One (D-544).
 */
export type PreviewMenu = { key: string; label: Pair; icon: "grad" | "rupee" | "trend" | "award" | "users" };

/**
 * "See the app as" in the desktop sidebar (UI-12, D-544). Only an
 * administrator has it, so the shell loads it with `next/dynamic`
 * (`./lazy.tsx`) and passes it to the sidebar: nobody else downloads its
 * code, and it is still drawn on the server, so it is there at first paint.
 */
export function PreviewLinks({ menus, previewing }: { menus: PreviewMenu[]; previewing: string | null }) {
  const { tx } = useVx();
  const pathname = usePathname() ?? "/";
  const collapsed = useSideCollapsed();
  return (
    <div>
      {collapsed ? (
        <div aria-hidden="true" style={{ height: 28 }} />
      ) : (
        <div style={{ height: 28, padding: "10px 12px 0", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--navm)" }}>
          {tx({ en: "See the app as", hi: "दूसरे रूप में देखें" })}
        </div>
      )}
      {menus.map((m) => (
        <PreviewLink key={m.key} menu={m.key} label={tx(m.label)} icon={m.icon} collapsed={collapsed} on={m.key === "person" ? pathname === "/view-as" : previewing === m.key} />
      ))}
    </div>
  );
}

function PreviewLink({ menu, label, icon, collapsed, on }: { menu: string; label: string; icon: PreviewMenu["icon"]; collapsed: boolean; on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`tap sidei${on ? " on" : ""}`}
      aria-current={on ? "page" : undefined}
      title={collapsed ? label : undefined}
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (menu === "person") return router.push("/view-as");
          const href = await setViewAsAction(menu);
          router.push(href);
          router.refresh();
        })
      }
      style={{ width: "100%", height: 38, marginBottom: 2, display: "flex", alignItems: "center", gap: 12, padding: "0 12px", borderRadius: 11, border: 0, background: on ? undefined : "transparent", fontSize: 14, justifyContent: collapsed ? "center" : undefined, textAlign: "left" }}
    >
      <Ic n={pending ? "refresh" : icon} size={19} className={pending ? "spin" : undefined} />
      {collapsed ? null : <span className="clip" style={{ flex: 1 }}>{label}</span>}
    </button>
  );
}
