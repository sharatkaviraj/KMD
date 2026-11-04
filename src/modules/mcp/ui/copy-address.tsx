"use client";

import { useState } from "react";

import { Button } from "@/ui/primitives/button";

/**
 * Copies the connection address for pasting into Claude's "Add custom
 * connector". The words come from the server (rule 9: the card's own pairs),
 * so this file holds no text. Where the clipboard is refused, the address
 * above stays selectable by hand.
 */
export function CopyAddress({ address, label, done }: { address: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="self-start"
      aria-live="polite"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? done : label}
    </Button>
  );
}
