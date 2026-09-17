"use client";

import { Printer } from "lucide-react";

import { m } from "@/messages";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Button } from "@/ui/primitives/button";

/**
 * Print, which on every device the school uses also means "save as PDF".
 *
 * A client component for one line of JavaScript, because `window.print()` is
 * the whole feature: the browser already owns the paper size, the margins, the
 * preview and the Devanagari fonts, and a server-rendered PDF would mean
 * shipping all four again to produce a worse copy of this table.
 */
export function PrintButton() {
  const language = useLanguage();

  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Printer aria-hidden />
      {primary(m.registerPrint, language)}
    </Button>
  );
}
