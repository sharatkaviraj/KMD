"use client";

import { useEffect, useState } from "react";

import { flushDraftWrites } from "@/platform/drafts/store";
import { requestActivation, updatePwa, usePwaState } from "@/platform/pwa/store";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";

/*
 * P11 state `update` (design `Auth` · update): a new version of the app is
 * waiting, said in the design's dark toast above the bottom bar.
 *
 * The same activation rule as src/ui/system/service-worker-registration.tsx,
 * which stays mounted and does the reload on `controllerchange`: never while
 * a sheet is open, a field has focus or a save is running, and only after
 * pending draft writes have reached storage. The design's "What's new" sheet
 * needs release notes the app does not have, so the toast's button updates.
 */

const T = {
  ready: p("A new version is ready", "नया संस्करण तैयार है"),
  update: p("Update now", "अभी अपडेट करें"),
  updating: p("Updating…", "अपडेट हो रहा है…"),
  blocked: p("Finish or close the form you are on first", "पहले खुला फ़ॉर्म पूरा या बंद करें"),
  later: p("Later", "बाद में"),
};

function busyPage(): boolean {
  return Boolean(
    document.documentElement.hasAttribute("data-sheet-open") ||
      document.activeElement?.matches("input,textarea,select,[contenteditable]") ||
      document.querySelector('[aria-busy="true"],[data-draft-storage-error="true"]'),
  );
}

/** The toast itself, so the design fixture can draw it. */
export function UpdateToast({ busy, blocked, onUpdate, onLater }: { busy?: boolean; blocked?: boolean; onUpdate: () => void; onLater: () => void }) {
  const { tx } = useVx();
  return (
    <div className="vxt">
      <div className="toastwrap">
        <div className="toast" role="status" style={{ gap: 8, padding: "8px 8px 8px 14px" }}>
          <span aria-hidden="true" style={{ flex: "none", width: 30, height: 30, borderRadius: 15, background: "var(--tacs)", color: "var(--tacc)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic n="download" size={16} />
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, paddingRight: 4, lineHeight: 1.35 }}>{tx(blocked ? T.blocked : T.ready)}</span>
          <button type="button" disabled={busy} onClick={onUpdate}>{tx(busy ? T.updating : T.update)}</button>
          <button type="button" aria-label={tx(T.later)} onClick={onLater} style={{ width: 36, padding: 0, background: "transparent", color: "var(--tfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic n="x" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function UpdateBanner() {
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

  return <UpdateToast busy={busy} blocked={blocked} onUpdate={() => void activate()} onLater={() => setLater(true)} />;
}
