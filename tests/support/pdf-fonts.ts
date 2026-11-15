/**
 * Which fonts a PDF names, and whether it carries each one (D-640).
 *
 * A font with no /FontFile, /FontFile2 or /FontFile3 in its descriptor (or no
 * descriptor at all, which is how a "standard 14" Helvetica is written) is a
 * font the phone has to supply. The owner's Android phone showed a blank page
 * the first time it opened such a file, so every One PDF must carry all its
 * fonts.
 */
export type PdfFont = { baseFont: string; subtype: string; embedded: boolean };

export function pdfFonts(pdf: Buffer): PdfFont[] {
  const raw = pdf.toString("latin1");
  const dicts = new Map<string, string>();
  for (const head of raw.matchAll(/(\d+) 0 obj\b/g)) {
    const start = (head.index ?? 0) + head[0].length;
    const endObj = raw.indexOf("endobj", start);
    const streamAt = raw.indexOf("stream", start);
    dicts.set(head[1], raw.slice(start, streamAt >= 0 && streamAt < endObj ? streamAt : endObj));
  }
  const ref = (dict: string, key: string) => dict.match(new RegExp(`/${key}\\s+(\\d+) 0 R`))?.[1];
  const carries = (descriptorId: string | undefined) =>
    Boolean(descriptorId && /\/FontFile[23]?\s+\d+ 0 R/.test(dicts.get(descriptorId) ?? ""));

  const fonts: PdfFont[] = [];
  for (const dict of dicts.values()) {
    if (!/\/Type\s*\/Font\b/.test(dict)) continue;
    const subtype = dict.match(/\/Subtype\s*\/(\w+)/)?.[1] ?? "?";
    if (subtype === "CIDFontType2" || subtype === "CIDFontType0") continue; // reached through its Type0 parent
    const baseFont = dict.match(/\/BaseFont\s*\/(\S+?)[\s/>]/)?.[1] ?? "?";
    let descriptor = ref(dict, "FontDescriptor");
    if (subtype === "Type0") {
      const child = dict.match(/\/DescendantFonts\s*\[\s*(\d+) 0 R/)?.[1];
      descriptor = child ? ref(dicts.get(child) ?? "", "FontDescriptor") : undefined;
    }
    fonts.push({ baseFont, subtype, embedded: carries(descriptor) });
  }
  return fonts;
}

/** The fonts a PDF leaves for the viewer to find. Empty means self-contained. */
export function fontsNotEmbedded(pdf: Buffer): string[] {
  return pdfFonts(pdf)
    .filter((font) => !font.embedded)
    .map((font) => font.baseFont);
}
