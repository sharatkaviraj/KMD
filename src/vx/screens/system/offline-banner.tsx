"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";

/*
 * P11 state `offline`. A thin strip under the top bar while the device has no
 * connection, and a short "back online" after it returns.
 *
 * What it promises is only what is true: forms that keep durable drafts
 * (src/platform/drafts) keep what was typed on this device, and nothing is
 * sent until the connection is back. Money is never taken offline — a
 * receipt number comes from the database, so the Payment Desk waits.
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

export function OfflineBanner() {
  const { tx, sub } = useVx();
  const online = useOnline();
  // "Back online" shows for a few seconds after the connection returns.
  const [backAt, setBackAt] = useState<number | null>(null);

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

  const offline = !online;
  const title = offline ? p("You are offline", "इंटरनेट नहीं है") : p("Back online", "इंटरनेट वापस आ गया");
  const body = offline
    ? p("What you type is kept on this phone and sent when the internet is back. Fees cannot be taken until then.", "जो लिखेंगे वह इस फ़ोन पर रहेगा और इंटरनेट आने पर जाएगा। तब तक फीस नहीं ली जा सकती।")
    : p("Everything is up to date again.", "सब फिर से ताज़ा है।");

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
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        background: offline ? "var(--tbg)" : "var(--oks)",
        color: offline ? "var(--tfg)" : "var(--ok)",
        fontSize: 14,
        borderBottom: "1px solid var(--bd)",
      }}
    >
      <Ic n={offline ? "wifiOff" : "checkCircle"} size={18} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong>{tx(title)}</strong>
        {sub(title) ? <span style={{ opacity: 1, marginLeft: 6, fontWeight: 400 }}>· {sub(title)}</span> : null}
        <span style={{ display: "block", fontSize: 13, color: offline ? "var(--tfg)" : "var(--ok)" }}>{tx(body)}</span>
      </span>
    </div>
  );
}
