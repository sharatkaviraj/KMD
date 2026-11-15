#!/usr/bin/env python3
"""Build the Latin fonts every One PDF embeds (D-640).

Why this exists: until D-640 the report card, receipt, certificate and fee
statement PDFs named Helvetica, Times and Courier without carrying them.
Those are the PDF "standard 14" fonts, which a viewer is expected to supply
itself. Most do, but it makes the file depend on the phone: the owner's
Android phone opened every WhatsApp report card and receipt as a blank white
sheet the first time. Embedding every font makes the PDF self-contained, so
what the phone draws comes only from the file.

What it builds: Liberation Sans, Serif and Mono (SIL OFL 1.1; metric-
compatible with Helvetica, Times and Courier, so every line still breaks in
the same place), with three changes:

1. Subset to Latin, punctuation, currency and arrows, without hinting, so the
   twelve files stay small in the repo and in the server bundle.
2. Line metrics set to the values @react-pdf/font gives its standard fonts
   (ascent 900 and descent -200 / -220 / -230 per 1000, no line gap), so a
   line is exactly as tall as before and a one-page card stays one page.
3. Renamed "VPPS PDF Sans/Serif/Mono": "Liberation" is a Reserved Font Name,
   and the OFL forbids it on a modified font. Copyright and licence notices
   are kept; the licence text ships beside the files as OFL-VppsPdf.txt.

Run (needs `pip install fonttools`; Liberation 2.x from the
`fonts-liberation2` package or https://github.com/liberationfonts):

    python3 scripts/build-pdf-fonts.py /usr/share/fonts/truetype/liberation public/fonts
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

UNICODES = (
    "U+0020-007E,U+00A0-024F,U+02B0-02FF,U+2000-206F,U+20A0-20CF,"
    "U+2100-214F,U+2190-21FF,U+2200-22FF,U+25A0-25FF,U+FB01-FB02"
)

# Family -> (new family name, descent per 1000 em, as @react-pdf/font's
# StandardFont reports it for Helvetica, Times-* and Courier-*).
FAMILIES = {
    "Sans": ("VPPS PDF Sans", -200),
    "Serif": ("VPPS PDF Serif", -220),
    "Mono": ("VPPS PDF Mono", -230),
}
STYLES = {
    "Regular": "Regular",
    "Bold": "Bold",
    "Italic": "Italic",
    "BoldItalic": "Bold Italic",
}
ASCENT_PER_1000 = 900


def build(src: Path, out: Path, kind: str, style: str) -> Path:
    family, descent = FAMILIES[kind]
    options = subset.Options()
    options.unicodes = subset.parse_unicodes(UNICODES)
    # Kerning only: @react-pdf/font kerns its standard fonts from the AFM
    # pairs and never forms ligatures, so "fi" must stay two glyphs here too.
    options.layout_features = ["kern"]
    options.hinting = False
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True

    # Keep the source's timestamp so a rebuild gives byte-identical files.
    font = TTFont(str(src), recalcTimestamp=False)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=options.unicodes)
    subsetter.subset(font)

    upm = font["head"].unitsPerEm
    ascent = round(ASCENT_PER_1000 * upm / 1000)
    descent_units = round(descent * upm / 1000)
    hhea = font["hhea"]
    hhea.ascent, hhea.descent, hhea.lineGap = ascent, descent_units, 0
    os2 = font["OS/2"]
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ascent, descent_units, 0

    style_name = STYLES[style]
    ps_family = family.replace(" ", "")
    full_name = family if style == "Regular" else f"{family} {style_name}"
    names = font["name"]
    # Drop every name record that carries the reserved name, then write ours.
    for record in list(names.names):
        if record.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22):
            names.removeNames(nameID=record.nameID)
    names.setName(family, 1, 3, 1, 0x409)
    names.setName(style_name, 2, 3, 1, 0x409)
    names.setName(f"{ps_family}-{style}; built for VPPS One PDFs", 3, 3, 1, 0x409)
    names.setName(full_name, 4, 3, 1, 0x409)
    names.setName(f"{ps_family}-{style}", 6, 3, 1, 0x409)
    names.setName(
        "Derived from Liberation 2.x (SIL OFL 1.1): subset, line metrics "
        "changed, renamed. Not the original Liberation fonts.",
        10, 3, 1, 0x409,
    )

    target = out / f"{ps_family}-{style}.ttf"
    font.save(str(target))
    return target


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    source_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    for kind in FAMILIES:
        for style in STYLES:
            src = source_dir / f"Liberation{kind}-{style}.ttf"
            target = build(src, out_dir, kind, style)
            print(f"{target}  {target.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
