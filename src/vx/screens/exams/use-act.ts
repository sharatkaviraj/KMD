"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";

import type { ActionResult } from "./save-types";

const FAILED = p("That did not work. Try again.", "यह नहीं हुआ। फिर से कोशिश करें।");

/** Run an exam-office action: say what happened, refresh the page's data, then carry on. */
export function useAct() {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, after?: (r: Extract<ActionResult, { ok: true }>) => void) =>
    start(async () => {
      const r = await fn().catch(() => null);
      if (!r || !r.ok) {
        toast.show({ text: tx(r && !r.ok ? r.message : FAILED), tone: "bad" });
        return;
      }
      if (r.message) toast.show({ text: tx(r.message) });
      router.refresh();
      after?.(r);
    });
  return { pending, run };
}
