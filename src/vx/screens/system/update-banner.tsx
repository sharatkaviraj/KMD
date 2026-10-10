"use client";

import { useEffect, useState } from "react";

import { flushDraftWrites } from "@/platform/drafts/store";
import { requestActivation, updatePwa, usePwaState } from "@/platform/pwa/store";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Btn, IconTile } from "@/vx/ui/primitives";

/*
 * P11 state `update`: a new version of the app is waiting.
 *
 * The same activation rule as src/ui/system/service-worker-registration.tsx,
 * which stays mounted and does the reload on `controllerchange`: never while
 * a sheet is open, a field has focus or a save is running, and only after
 * pending draft writes have reached storage. This is the vx look of that
 * prompt; mount it in the shell and drop the old card's UI there.
 */

function busyPage(): boolean {
  return Boolean(
    document.documentElement.hasAttribute("data-sheet-open") ||
      document.activeElement?.matches("input,textarea,select,[contenteditable]") ||
      document.querySelector('[aria-busy="true"],[data-draft-storage-error="true"]'),
  );
}

export function UpdateBanner() {
  const { tx } = useVx();
  const pwa = usePwaState();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [later, setLater] = useState(false);

  // While this prompt is mounted the root layout's older card stays hidden.
  useEffect(() => {
    updatePwa({ prompted: true });
    return () => updatePwa({ prompted: false });
  }, []);

  if (!pwa.waiting || later) return null;

  async function activate() {
    if (busyPage()) {
      setBlocked(true);
      return;
    }
    setBusy(true);
    try {
      await flushDraftWrites();
      if (!requestActivation()) setBusy(false);
    } catch {
      setBlocked(true);
      setBusy(false);
    }
  }

  return (
    <aside
      className="vxt card"
      role="status"
      style={{ position: "fixed", right: 16, bottom: "calc(96px + env(safe-area-inset-bottom))", zIndex: 60, maxWidth: 360, width: "calc(100% - 32px)", display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", boxShadow: "var(--shh)" }}
    >
      <IconTile icon="refresh" size={36} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <strong>{tx(p("A new version is ready", "नया संस्करण तैयार है"))}</strong>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>
          {blocked
            ? tx(p("Finish or close the form you are on first, then reload.", "पहले खुला फ़ॉर्म पूरा या बंद करें, फिर रीलोड करें।"))
            : tx(p("Reload to get it. What you typed is kept.", "पाने के लिए रीलोड करें। जो लिखा है वह रहेगा।"))}
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <Btn variant="pri" icon="refresh" disabled={busy} onClick={() => void activate()}>{tx(p("Reload", "रीलोड"))}</Btn>
          <Btn variant="ghost" onClick={() => setLater(true)}>{tx(p("Later", "बाद में"))}</Btn>
        </span>
      </span>
    </aside>
  );
}
