"use client";

import { useEffect } from "react";

import { HOME_HINT_COOKIE, HOME_HINT_MAX_AGE } from "@/platform/auth/home-hint-cookie";

/**
 * Keeps the home hint (`src/platform/auth/home-hint.ts`) in step with the
 * signed-in person: written when `/` would redirect them, removed when it
 * would not. Writes only when the value changes, so an ordinary screen costs
 * a cookie read and nothing else.
 */
export function HomeHint({ value }: { value: string | null }) {
  useEffect(() => {
    try {
      const current = document.cookie
        .split("; ")
        .find((part) => part.startsWith(`${HOME_HINT_COOKIE}=`))
        ?.slice(HOME_HINT_COOKIE.length + 1);
      const wanted = value ? encodeURIComponent(value) : null;
      if ((current ?? null) === wanted) return;
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = wanted
        ? `${HOME_HINT_COOKIE}=${wanted}; Path=/; Max-Age=${HOME_HINT_MAX_AGE}; SameSite=Lax${secure}`
        : `${HOME_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    } catch {
      // A browser that refuses cookies boots the slow way, as before.
    }
  }, [value]);
  return null;
}
