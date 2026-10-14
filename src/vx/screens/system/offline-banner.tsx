"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";

/*
 * P11 state `offline` (design `Auth` · offline). A strip across the top of
 * the content while the device has no connection, and a short "back online"
 * after it returns.
 *
 * What it promises is only what is true: forms that keep durable drafts
 * (src/platform/drafts) keep what was typed on this device, and nothing is
 * sent until the connection is back. Money is never taken offline — a
 * receipt number comes from the database, so the Payment Desk waits. The
 * design's "receipts wait on this phone" queue has no counterpart here.
 *
 * Mount once inside the signed-in shell (beside the page, above the content).
 */

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** True while the browser says it has no network. Server render: online. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

const T = {
  offline: p("You’re offline — what you type is kept on this phone and goes when you’re back. Fees wait until then.", "इंटरनेट नहीं है — जो लिखेंगे वह इस फ़ोन पर रहेगा और इंटरनेट आने पर जाएगा। फीस तब तक रुकेगी।"),
  back: p("Back online · everything is up to date again", "इंटरनेट वापस आ गया · सब फिर से ताज़ा है"),
  retry: p("Try again", "फिर से देखें"),
  checking: p("Checking…", "देख रहे हैं…"),
};

/** The strip itself, so the design fixture can draw either state. */
export function OfflineStrip({ offline, checking, onRetry }: { offline: boolean; checking?: boolean; onRetry?: () => void }) {
  const { tx, sub } = useVx();
  const text = offline ? T.offline : T.back;
  return (
    <div
      className="vxt"
      role="status"
      aria-live="polite"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "10px 12px",
        padding: "12px clamp(16px, 2.2vw, 28px)",
        background: offline ? "var(--warns)" : "var(--oks)",
        color: offline ? "var(--warnfg)" : "var(--ok)",
        borderBottom: "1px solid var(--bd)",
        animation: "xIn .32s var(--ease) both",
      }}
    >
      <Ic n={offline ? "wifiOff" : "checkCircle"} size={20} />
      <span style={{ flex: 1, minWidth: 200, fontSize: 14, fontWeight: 600 }}>
        {tx(text)}
        {sub(text) ? <span style={{ display: "block", fontSize: 12, fontWeight: 500 }}>{sub(text)}</span> : null}
      </span>
      {offline && onRetry ? (
        <button type="button" className="tap btn sec" onClick={onRetry} disabled={checking} style={{ height: 36 }}>
          <Ic n="refresh" size={18} className={checking ? "spin" : undefined} />
          {tx(checking ? T.checking : T.retry)}
        </button>
      ) : null}
    </div>
  );
}

export function OfflineBanner() {
  const router = useRouter();
  const online = useOnline();
  // "Back online" shows for a few seconds after the connection returns.
  const [backAt, setBackAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const back = () => {
      setBackAt(Date.now());
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setBackAt(null), 4000);
    };
    const gone = () => {
      window.clearTimeout(timer);
      setBackAt(null);
    };
    window.addEventListener("online", back);
    window.addEventListener("offline", gone);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", back);
      window.removeEventListener("offline", gone);
    };
  }, []);

  if (online && backAt === null) return null;

  // "Try again" asks the browser once more and, if it is back, reloads this
  // screen's data. It never reloads the page while offline.
  const retry = () => {
    setChecking(true);
    window.setTimeout(() => {
      setChecking(false);
      if (navigator.onLine) router.refresh();
    }, 1200);
  };

  return <OfflineStrip offline={!online} checking={checking} onRetry={retry} />;
}
