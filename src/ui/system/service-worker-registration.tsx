"use client";
import { useEffect, useRef, useState } from "react";
import { m } from "@/messages";
import { primary } from "@/platform/i18n/language";
import { useLang } from "@/platform/locale/language-provider";
import { flushDraftWrites } from "@/platform/drafts/store";
import { captureInstall, registerPwa, updatePwa, usePwaState, waitingWorker } from "@/platform/pwa/store";
export function ServiceWorkerRegistration() {
  const pwa = usePwaState();
  const { locale } = useLang();
  const language = locale === "en" ? "en" : locale === "hi-en" ? "both" : "hi";
  const requested = useRef(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const installed = () => updatePwa({ installed: display.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone) });
    const onInstalled = () => updatePwa({ installed: true, installable: false });
    updatePwa({ ios: /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 });
    installed();
    window.addEventListener("beforeinstallprompt", captureInstall);
    window.addEventListener("appinstalled", onInstalled);
    display.addEventListener("change", installed);
    let disposed = false;
    let cleanupRegistration: (() => void) | undefined;
    const controllerChanged = () => { if (requested.current) window.location.reload(); };
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", controllerChanged);
      void navigator.serviceWorker.register("/service-worker.js", { updateViaCache: "none" }).then(registration => {
        if (disposed) return;
        registerPwa(registration);
        let lastCheck = Date.now();
        const check = () => {
          if (!document.hidden && navigator.onLine && Date.now() - lastCheck > 600_000) {
            lastCheck = Date.now(); void registration.update().catch(() => undefined);
          }
        };
        const found = () => {
          const worker = registration.installing;
          if (!worker) return;
          const changed = () => {
            if (disposed) return;
            if (worker.state === "installed") registerPwa(registration, navigator.serviceWorker.controller ? worker : undefined);
            if (worker.state === "activated") { registerPwa(registration); worker.removeEventListener("statechange", changed); }
          };
          worker.addEventListener("statechange", changed);
        };
        registration.addEventListener("updatefound", found);
        found();
        document.addEventListener("visibilitychange", check);
        cleanupRegistration = () => { registration.removeEventListener("updatefound", found); document.removeEventListener("visibilitychange", check); };
      }).catch(() => updatePwa({ ready: false }));
    }
    return () => {
      disposed = true; cleanupRegistration?.();
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("controllerchange", controllerChanged);
      window.removeEventListener("beforeinstallprompt", captureInstall);
      window.removeEventListener("appinstalled", onInstalled);
      display.removeEventListener("change", installed);
    };
  }, []);
  async function activate() {
    if (document.documentElement.hasAttribute("data-sheet-open") || document.activeElement?.matches("input,textarea,select,[contenteditable]") || document.querySelector('[aria-busy="true"],[data-draft-storage-error="true"]')) { setBlocked(true); return; }
    setBusy(true);
    try {
      await flushDraftWrites();
      const worker = waitingWorker();
      if (worker) { requested.current = true; worker.postMessage({ type: "ACTIVATE_UPDATE" }); }
      else setBusy(false);
    } catch { setBlocked(true); setBusy(false); }
  }
  if (!pwa.waiting) return null;
  return <aside className="fixed right-4 top-4 z-[100] max-w-xs rounded-xl border border-border bg-surface p-4 shadow-lg print:hidden" role="status">
    <p className="font-semibold">{primary(m.pwaUpdate, language)}</p>
    <p className="mt-1 text-sm text-muted-foreground">{primary(blocked ? m.pwaFinishForm : m.pwaUpdateHint, language)}</p>
    <button type="button" onClick={() => void activate()} disabled={busy} className="focus-ring mt-2 min-h-11 rounded-lg bg-accent px-4 font-semibold text-accent-foreground">{primary(m.pwaReload, language)}</button>
  </aside>;
}
