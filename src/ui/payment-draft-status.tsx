"use client";
import { DraftStatus } from "./draft-status";
import { useLang } from "@/platform/locale/language-provider";

export function PaymentDraftStatus(props: Omit<Parameters<typeof DraftStatus>[0], "language">) {
  const { locale } = useLang();
  return <DraftStatus {...props} language={locale === "en" ? "en" : locale === "hi-en" ? "both" : "hi"} />;
}
