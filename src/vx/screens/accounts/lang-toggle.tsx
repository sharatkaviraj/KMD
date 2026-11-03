"use client";

import { LanguageControl } from "@/vx/ui/language";

/**
 * The accountant's top-bar language control. It used to flip between Hindi
 * and both, so an English reader who tapped it once could never get English
 * back (20 Oct smoke day). It is now the shared three-way control: English,
 * हिंदी or both, one 44 px button on a phone.
 */
export function LangToggle({ phone = false }: { phone?: boolean }) {
  return <LanguageControl pill={phone} />;
}
