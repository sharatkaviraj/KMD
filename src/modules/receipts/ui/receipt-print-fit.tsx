"use client";

import { useEffect } from "react";

/*
 * One receipt, one sheet of A4 (owner, 7 Nov 2026: "printed in single sheet only").
 *
 * The receipt's own print styles (receipt-document-v3) already set it compact
 * enough that an ordinary receipt fits with room to spare. What they cannot
 * promise is the unusual one — eight instalment lines, a previous-year balance,
 * three discount policies — and a receipt whose tear-off stub lands on a second
 * sheet is two broken halves rather than one document.
 *
 * So just before the browser prints (the Print button, Ctrl+P, the phone's
 * Print menu: all of them fire `beforeprint`), every single-receipt sheet is
 * laid out once at A4 width under the same print rules (`.rcpt-measure`), its
 * height read, and if it is taller than the sheet it is given a `zoom` that
 * makes it fit. Nothing is clipped and nothing moves to page two; at worst the
 * type is a little smaller. `afterprint` puts the screen back.
 */

const MM = 96 / 25.4;
/** The sheet itself: the receipt carries its own 10 mm margin as padding (receipt-document-v3). */
export const A4_HEIGHT_PX = 297 * MM;
/** Head-room for printer rounding: a sheet that is exactly full can still spill one line. */
const SAFETY = 0.975;
/** Below this the type stops being readable; nothing real comes close. */
const SMALLEST = 0.6;

const SHEETS = ".receipt-print-page[data-receipt-solo]";

/** The zoom a sheet of `height` px needs to fit on one A4 page. 1 when it already fits. */
export function receiptFitFor(height: number, room = A4_HEIGHT_PX * SAFETY): number {
  if (!Number.isFinite(height) || height <= room) return 1;
  return Math.max(SMALLEST, Math.floor((room / height) * 1000) / 1000);
}

/** Measure every single-receipt sheet on the page at A4 and set the zoom it needs. */
export function fitReceiptsForPrint(root: ParentNode = document): number[] {
  return [...root.querySelectorAll<HTMLElement>(SHEETS)].map((sheet) => {
    sheet.style.removeProperty("--rcpt-fit");
    sheet.classList.add("rcpt-measure");
    // offsetHeight, not getBoundingClientRect: a sheet inside an animating or
    // zoomed screen is measured in its own CSS pixels, which is what print uses.
    const height = sheet.offsetHeight;
    sheet.classList.remove("rcpt-measure");
    const fit = height > 0 ? receiptFitFor(height) : 1;
    if (fit < 1) sheet.style.setProperty("--rcpt-fit", String(fit));
    sheet.dataset.receiptFit = String(fit);
    return fit;
  });
}

export function clearReceiptFit(root: ParentNode = document) {
  for (const sheet of root.querySelectorAll<HTMLElement>(SHEETS)) {
    sheet.style.removeProperty("--rcpt-fit");
    delete sheet.dataset.receiptFit;
  }
}

/** Wait for the logo and the signature: printing before they decode prints two empty boxes. */
async function imagesReady(root: ParentNode, timeoutMs = 3000) {
  const images = [...root.querySelectorAll<HTMLImageElement>(`${SHEETS} img`)];
  const decoded = Promise.allSettled(
    images.map((image) => {
      image.loading = "eager";
      return image.complete ? Promise.resolve() : image.decode();
    }),
  );
  let timer: number | undefined;
  await Promise.race([decoded, new Promise<void>((resolve) => { timer = window.setTimeout(resolve, timeoutMs); })]);
  if (timer !== undefined) window.clearTimeout(timer);
}

/** The Print A4 button: wait for the images, fit, then open the browser's print dialog. */
export async function printReceipt(root: ParentNode = document) {
  await imagesReady(root);
  await document.fonts?.ready.catch(() => undefined);
  fitReceiptsForPrint(root);
  window.print();
}

/**
 * Mounted once beside a receipt. Fits the sheet on every way into print, and
 * with `autoPrint` (a `?print=1` link from Collect or the desk) opens the print
 * dialog as soon as the page is ready, so "Print" means print.
 */
export function ReceiptPrintFit({ autoPrint = false }: { autoPrint?: boolean }) {
  useEffect(() => {
    const before = () => fitReceiptsForPrint();
    const after = () => clearReceiptFit();
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  useEffect(() => {
    if (!autoPrint) return;
    let live = true;
    const at = window.location.href;
    // Two frames after the images: the sheet is painted before the dialog freezes it.
    void imagesReady(document).then(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (live && window.location.href === at) void printReceipt();
      }));
    });
    return () => {
      live = false;
    };
  }, [autoPrint]);

  return null;
}
