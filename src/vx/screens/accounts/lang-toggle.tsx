"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { saveLanguageAction } from "@/app/(app)/preferences/actions";
import { useVx } from "@/vx/i18n";

/**
 * The design's one-tap language button on the accountant's top bar: it shows
 * the other language ("हि" while reading English) and writes the reader's
 * stored preference, as the sidebar's EN | हि does (UI-6).
 */
export function LangToggle({ phone = false }: { phone?: boolean }) {
  const { language } = useVx();
  const router = useRouter();
  const [pending, start] = useTransition();
  const isHi = language === "hi";
  const flip = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("language", isHi ? "both" : "hi");
      await saveLanguageAction({ status: "idle", message: null }, fd);
      router.refresh();
    });
  return (
    <button
      type="button"
      className={`tap btn ${phone ? "ghost" : "sec"}`}
      aria-label="Switch language"
      lang={isHi ? "en" : "hi"}
      disabled={pending}
      onClick={flip}
      style={phone ? { width: 44, height: 44, padding: 0, borderRadius: 22, fontSize: 14 } : { width: 52, padding: 0 }}
    >
      {isHi ? "EN" : "हि"}
    </button>
  );
}
