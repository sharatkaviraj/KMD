"use client";

import Link from "@/ui/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/ui/primitives/button";

type ReceiptPrintActionsProps = {
  backHref?: string;
  autoPrint?: boolean;
};

export function ReceiptPrintActions({
  backHref = "/fees/receipts",
  autoPrint = false,
}: ReceiptPrintActionsProps) {
  const t = useTranslations("Receipts");
  const [showPdfHint, setShowPdfHint] = useState(false);

  // Hide the PDF hint after the print dialog closes (afterprint).
  useEffect(() => {
    if (typeof window === "undefined") return;
    function handleAfterPrint() {
      setShowPdfHint(false);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  useEffect(() => {
    if (!autoPrint) {
      return;
    }

    let cancelled = false;
    const printLocation = window.location.href;
    const stillCurrent = () => !cancelled && window.location.href === printLocation;
    let readinessTimer: number | undefined;
    let frame: number | undefined;
    const printWhenReady = async () => {
      const images = Array.from(document.images);
      // The A4 document is hidden on phones until printing. Its lazy assets
      // will otherwise never start, and decode() can wait indefinitely.
      const decoded = Promise.allSettled(images.map((image) => {
        image.loading = "eager";
        return image.complete ? Promise.resolve() : image.decode();
      }));
      await Promise.race([
        decoded,
        new Promise<void>((resolve) => {
          readinessTimer = window.setTimeout(resolve, 3000);
        }),
      ]);
      if (readinessTimer !== undefined) window.clearTimeout(readinessTimer);
      if (!stillCurrent()) return;

      frame = requestAnimationFrame(() => {
        if (!stillCurrent()) return;
        frame = requestAnimationFrame(() => {
          if (stillCurrent()) window.print();
        });
      });
    };

    void printWhenReady();
    return () => {
      cancelled = true;
      if (readinessTimer !== undefined) window.clearTimeout(readinessTimer);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [autoPrint]);

  // Auto-close the print tab on mobile after the user dismisses the print
  // dialog so they're not left juggling an extra tab. Desktop browsers
  // routinely block window.close() on the parent tab; this only no-ops there.
  useEffect(() => {
    if (!autoPrint) return;
    if (typeof window === "undefined") return;
    function handleAfterPrint() {
      // Small delay so the print dialog has fully closed before window.close.
      window.setTimeout(() => {
        try {
          window.close();
        } catch {
          // window.close() is best-effort: most browsers block it on tabs
          // that weren't opened by script. The user can close the tab manually.
        }
      }, 250);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, [autoPrint]);

  return (
    <div className="no-print flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => window.print()}>
          {t("printActionsPrintReceipt")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setShowPdfHint(true);
            window.print();
          }}
        >
          {t("printActionsSaveAsPdf")}
        </Button>
        <Button asChild variant="secondary">
          <Link href={backHref}>{t("printActionsBack")}</Link>
        </Button>
      </div>
      {showPdfHint ? (
        <p className="text-[11px] text-muted-foreground">
          {t("printActionsPdfHintPrefix")}
          <strong>{t("printActionsPdfHintEmphasis")}</strong>
          {t("printActionsPdfHintSuffix")}
        </p>
      ) : null}
    </div>
  );
}
