"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";

import { clearViewAsAction } from "./view-as-actions";

const W = {
  seeing: (role: Pair) => p(`Seeing the app as ${role.en} · read-only`, `ऐप को ${role.hi || role.en} की तरह देख रहे हैं · सिर्फ़ देखना`),
  back: p("Back to admin", "प्रशासक पर लौटें"),
  switching: p("Switching…", "बदल रहे हैं…"),
};

/** Shown across every screen while an admin is seeing the app as another role, in the admin's language. */
export function PreviewBanner({ label }: { label: Pair }) {
  const { tx } = useVx();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="vx-preview" role="status">
      <Ic n="eye" size={16} />
      <span style={{ flex: 1, minWidth: 0 }}>{tx(W.seeing(label))}</span>
      <button
        type="button"
        className="tap"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const href = await clearViewAsAction();
            // The action already redrew the frame as the admin's own (revalidatePath):
            // one push, no refresh on top, from the top of the page (D-544).
            window.scrollTo(0, 0);
            router.push(href, { scroll: false });
          })
        }
        style={{ border: 0, borderRadius: 10, padding: "6px 12px", background: "var(--card)", color: "var(--fg)", fontWeight: 700, fontSize: 13 }}
      >
        {tx(pending ? W.switching : W.back)}
      </button>
    </div>
  );
}
