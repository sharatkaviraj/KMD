/**
 * The fee screens for a reader of both languages (smoke test A-23).
 *
 * VPPS One's own screens show a `both` reader English with the Hindi beside
 * key labels, and sentences in English. The fee screens speak next-intl out of
 * single-language catalogues, so they used to show that reader pure Hindi,
 * and the two halves of the app disagreed on every page.
 *
 * This builds the same shape out of the English and Hindi catalogues, at
 * request time, without a third file to keep in step: a short label becomes
 * "Receipts · रसीदें"; anything longer, any fragment that is spliced into a
 * sentence ("of", "today"), and anything carrying plural or select syntax
 * stays English, because doubling those would break the line they sit in.
 */

type Catalog = { [key: string]: string | Catalog };

/** Short enough to sit on one line twice, and shaped like a label. */
export const BILINGUAL_LABEL_MAX = 32;

export function bilingualLabel(en: string, hi: string | undefined): string {
  if (!hi || hi === en) return en;
  if (en.length > BILINGUAL_LABEL_MAX) return en;
  if (!/^[A-Z0-9₹]/.test(en)) return en;
  if (/[\n.!?:]$/.test(en) || en.includes("\n")) return en;
  if (/\{[^}]*,/.test(en) || /\{[^}]*,/.test(hi)) return en;
  if (/<[a-z]/i.test(en)) return en;
  return `${en} · ${hi}`;
}

export function bilingualCatalog(en: Catalog, hi: Catalog): Catalog {
  const out: Catalog = {};
  for (const [key, value] of Object.entries(en)) {
    const other = hi[key];
    if (typeof value === "string") {
      out[key] = bilingualLabel(value, typeof other === "string" ? other : undefined);
    } else {
      out[key] = bilingualCatalog(value, other && typeof other === "object" ? other : {});
    }
  }
  return out;
}
