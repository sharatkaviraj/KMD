"use client";

import { Btn } from "@/vx/ui/primitives";

/** The browser's own print, on the receipt page whose print styles hide the shell. */
export function PrintButton({ label }: { label: string }) {
  return <Btn variant="pri" icon="printer" onClick={() => window.print()}>{label}</Btn>;
}
