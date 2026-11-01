# Application fonts

The same Inter, Source Serif 4 and Noto Sans Devanagari families used by the
application are pinned locally. This removes build-time Google Fonts requests:
the Next 16.3.8 Google loader failed in Vercel when a returned font URL could not
be parsed. `next/font/local` still emits content-hashed assets with font-display
swap and fallback metric adjustment.

Source: the official [google/fonts repository](https://github.com/google/fonts)
at commit `6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec`. Each family includes its
original SIL Open Font License. `manifest.json` records exact source URLs,
SHA-256 hashes, fixed axes, glyph counts and output hashes.

The source variable TTFs were converted with FontTools 4.68.0 and Brotli 1.2.1.
Only non-weight axes were fixed to their source defaults, matching the previous
weight-only Google Fonts requests. Every original Unicode mapping and glyph
advance remains present. Reopening each WOFF2 verified its character map, advance
widths and remaining weight axis against the converted TTF. No Python tooling or
font transformation runs during application installation or deployment.

The three WOFF2 assets total 567,632 bytes. They include complete language
coverage instead of separate Google subset requests, and are cached after the
first visit. The existing family CSS variables and requested weights are retained.
