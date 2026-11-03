"use client";

import { useRouter } from "next/navigation";
import { useTransition, type CSSProperties, type ReactNode } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";

/**
 * The one "could not read" a card shows (T02/T03, U01). A failed read is never
 * drawn as nought or "All clear": it says the figure is unavailable, that it
 * may not be empty, and offers Try again.
 *
 * Try again re-reads the page's server data in place (`router.refresh`): the
 * other cards, the scroll position, the open session and anything typed stay
 * as they are — the whole dashboard is not reset to recover one card.
 */
const W = {
  couldNot: p("Could not read this just now. It may not be empty.", "अभी यह पढ़ा नहीं जा सका। हो सकता है यह ख़ाली न हो।"),
  partly: p("Some of this could not be read, so it may be incomplete.", "इसका कुछ हिस्सा पढ़ा नहीं जा सका, इसलिए यह अधूरा हो सकता है।"),
  retry: p("Try again", "फिर कोशिश करें"),
  retrying: p("Trying again…", "फिर कोशिश हो रही है…"),
};

export function useRetry() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return { pending, retry: () => start(() => router.refresh()) };
}

export function RetryButton({ style }: { style?: CSSProperties }) {
  const { tx } = useVx();
  const { pending, retry } = useRetry();
  return (
    <button
      type="button"
      className="tap"
      onClick={retry}
      disabled={pending}
      aria-busy={pending || undefined}
      style={{ font: "inherit", fontWeight: 700, color: "var(--acc)", background: "none", border: 0, padding: "4px 0", minHeight: 32, cursor: pending ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 6, ...style }}
    >
      <Ic n="refresh" size={16} className={pending ? "spin" : undefined} />
      {tx(pending ? W.retrying : W.retry)}
    </button>
  );
}

/**
 * `whole`: nothing could be read. `partial`: some rows arrived, more may be
 * missing — shown under those rows. `message` replaces the plain sentence.
 */
export function CouldNotRead({ partial, message, action, style }: { partial?: boolean; message?: Pair; action?: ReactNode; style?: CSSProperties }) {
  const { tx } = useVx();
  return (
    <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "var(--warnfg)", background: "var(--warns)", padding: "10px 12px", borderRadius: 12, ...style }}>
      <Ic n="alert" size={18} style={{ flex: "none", marginTop: 1 }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span>{tx(message ?? (partial ? W.partly : W.couldNot))}</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          <RetryButton />
          {action}
        </span>
      </span>
    </div>
  );
}
