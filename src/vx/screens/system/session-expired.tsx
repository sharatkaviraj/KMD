"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { createClient } from "@/platform/supabase/client";

import { ExpiredSheet, type ExpiredWho } from "@/vx/screens/system/expired-sheet";
import { expiredLoginHref } from "@/vx/screens/system/logic";

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
    // A prompt about the session must never be what breaks the page.
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
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
    return () => {
      data.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("beforeunload", markLeaving);
    };
  }, []);

  const href = expiredLoginHref(pathname, typeof window === "undefined" ? "" : window.location.search);

  return <ExpiredSheet open={expired} who={who} href={href} />;
}
