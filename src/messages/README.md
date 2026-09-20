# `src/messages` — two catalogues, on purpose

| File | Who reads it | How |
|---|---|---|
| `index.ts` | Everything except the fee screens | `m.someKey` is a `{ hi, en }` pair, rendered with `primary()` / `secondary()` / `flat()` against the reader's `Language` |
| `en.json`, `hi.json`, `hi-en.json` | The ported School Fees screens | next-intl keys, read with `useTranslations()` / `getTranslations()` |
| `receipts-bilingual.json` | Receipt rendering only | Fixed Hindi+English pairs printed on paper, where the reader is a parent rather than a staff member |

There is no name clash: `@/messages` resolves to `index.ts`, and the JSON files
are imported by path.

## Why both survived

Neither was rewritten into the other. The fee catalogues hold about 2,094 keys;
`index.ts` holds about 750 pairs. Converting either direction would have meant
touching every string in a 600-file port and every screen in this app, in the
same change that moved them — and the first thing to break would have been
whichever one nobody looked at.

The **boundary** is what makes that safe, and it is enforced rather than agreed.
`tests/architecture.test.ts` asserts two things:

- no file imports both;
- nothing outside `src/modules/fees/**` and `src/app/(app)/fees/**` reaches for
  next-intl at all.

A file that read both would decide the reader's language twice, and the two
answers can disagree — `both` renders as a Hindi/English pair on one line and as
Hindi alone on the next.

## One stored preference

`vppsone.staff_profiles.preferred_language` (`hi` | `en` | `both`) is the only
language a person chooses. `src/platform/i18n/bridge.ts` derives the fee locale
from it, and `src/platform/i18n/request.ts` hands that to next-intl.

**`both` maps to `hi`.** There is no bilingual fee catalogue and there will not
be one: it would mean 2,094 strings shaped `"हिन्दी · English"` printed onto money
tables the fee app deliberately designed as single-line. `primary()` already
leads with Hindi for a `both` reader, so a fee screen and an academic screen
agree on the lead line; what a `both` reader loses is the English underneath, on
the fee screens only.

`hi-en` is Hinglish — romanised Hindi, `"Bhugtan counter"` — fully translated and
in use. No VPPS One language maps onto it, so it is reachable only through the
fee app's own locale switcher and the `vpps_locale` cookie it writes.

## Adding a string

To a fee screen: add the key to all three JSON files. To anything else: add a
`t("…", "…")` pair to `index.ts`. Rule 9 still holds — a hard-coded Hindi string
in a component is a bug.
