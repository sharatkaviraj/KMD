"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import type { ExpiredWho } from "@/vx/screens/system/expired-sheet";
import { expiredLoginHref } from "@/vx/screens/system/logic";

/*
 * The dialog itself, words in two languages and all, loads only once a
 * session has lapsed: it was on the first load of every screen for a moment
 * most people never see (page-size budget, 15 Nov 2026).
 */
const ExpiredSheet = dynamic(() => import("@/vx/screens/system/expired-sheet").then((m) => m.ExpiredSheet), { ssr: false });

/*
 * P11 state `expired` (design `Auth` · expired). When the sign-in lapses
 * while a screen is open, say so on top of the screen rather than letting the
 * next save fail: what was typed in a draft-keeping form stays on the device,
 * and "Sign in" comes back to this same page (/login?reason=expired&next=…).
 *
 * It listens to Supabase's own auth events and re-checks when the tab comes
 * back into view — no polling. While signed in it remembers whose session it
 * is, so the dialog can say so. Mount once inside the signed-in shell.
 */
export function SessionExpiredSheet() {
  const pathname = usePathname();
  const [expired, setExpired] = useState(false);
  const [who, setWho] = useState<ExpiredWho | null>(null);

  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | undefined;
    let leaving = false;
    const markLeaving = () => {
      leaving = true;
    };
    // A deliberate sign-out navigates away; do not show the sheet for it.
    window.addEventListener("beforeunload", markLeaving);
    const remember = (user: { email?: string | null; last_sign_in_at?: string | null; user_metadata?: Record<string, unknown> }) => {
      const named = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
      const name = named || user.email || "";
      if (name) setWho({ name, at: user.last_sign_in_at ?? null });
    };

    /*
     * supabase-js and its realtime client are ~67 KB gzip. A static import put
     * them in the first-load JS of every screen, a teacher's included, for a
     * sheet that only matters once a session lapses (perf fix 3). They load
     * when the browser is idle instead, as OfficeSyncListener's do: a second's
     * delay before listening costs nothing.
     */
    const start = () => {
      void import("@/platform/supabase/client")
        .then(({ createClient }) => {
          if (cancelled) return;
          // A prompt about the session must never be what breaks the page.
          let supabase: ReturnType<typeof createClient>;
          try {
            supabase = createClient();
          } catch {
            return;
          }
          const { data } = supabase.auth.onAuthStateChange((event, session) => {
            if (session) {
              remember(session.user);
              setExpired(false);
            }
            if (event === "SIGNED_OUT" && !leaving) setExpired(true);
          });
          const check = async () => {
            if (document.visibilityState !== "visible") return;
            const { data: s } = await supabase.auth.getSession();
            if (!s.session && !leaving) setExpired(true);
          };
          document.addEventListener("visibilitychange", check);
          teardown = () => {
            data.subscription.unsubscribe();
            document.removeEventListener("visibilitychange", check);
          };
        })
        .catch(() => {
          // No client means no prompt; the next save still says the session ended.
        });
    };
    const idle = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(start, { timeout: 4000 }) : null;
    const timer = idle === null ? window.setTimeout(start, 1500) : null;

    return () => {
      cancelled = true;
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timer !== null) window.clearTimeout(timer);
      teardown?.();
      window.removeEventListener("beforeunload", markLeaving);
    };
  }, []);

  if (!expired) return null;
  const href = expiredLoginHref(pathname, window.location.search);
  return <ExpiredSheet open who={who} href={href} />;
}
