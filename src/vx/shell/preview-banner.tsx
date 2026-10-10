"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Ic } from "@/vx/icons";

import { clearViewAsAction } from "./view-as-actions";

/** Shown across every screen while an admin is seeing the app as another role. */
export function PreviewBanner({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="vx-preview" role="status">
      <Ic n="eye" size={16} />
      <span style={{ flex: 1, minWidth: 0 }}>Seeing the app as {label} · read-only</span>
      <button
        type="button"
        className="tap"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const href = await clearViewAsAction();
            router.push(href);
            router.refresh();
          })
        }
        style={{ border: 0, borderRadius: 10, padding: "6px 12px", background: "var(--card)", color: "var(--fg)", fontWeight: 700, fontSize: 13 }}
      >
        {pending ? "Switching…" : "Back to admin"}
      </button>
    </div>
  );
}
