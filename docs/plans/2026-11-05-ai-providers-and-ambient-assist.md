# AI in VPPS One, second pass: three providers, the right model per task, and AI that shows up without being asked

Date: 5 November 2026 (revised the same day after the owner's answers). Status: **built 5 Nov 2026 (D-416 to D-419); see docs/ai/DECISIONS.md for what changed from this proposal** (the free key stays off personal data, model IDs are env overrides rather than a table).
Builds on D-324 to D-327 (the Assist helper).

## 0. Owner decisions recorded (5 Nov 2026)

- **The Gemini free tier may be used for any task, including ones with student data.** The owner
  accepted that Google may use free-tier prompts to improve its products and that people may
  review them. Name masking (`redact.ts`) stays on for every provider anyway: it costs nothing and
  keeps names out of every log. Photos (admission forms) cannot be masked.
- **Credits:** the school has **Claude Max** and **ChatGPT Pro**. Since October 2026 both include
  monthly API credits: Claude Max gives $100 (5x) or $200 (20x/Ultra) in the Claude Console, and
  ChatGPT Pro gives credits equal to the plan price on the OpenAI API Platform. The credits
  **expire monthly**. That changes the strategy: unused credits are lost, so for quality-critical
  work the best model on credits costs the school nothing extra.
- **"Best model where it matters":** parent-facing and official writing goes to the strongest
  sensible model. Quick internal help goes to the cheapest model that does it well.

## 1. What is there today (checked, not assumed)

- **One door, one provider.** `POST /api/assist` → `runAssistTask()` in
  `src/modules/assist/data/run.ts` → Claude only (`@anthropic-ai/sdk`). `isAssistConfigured()` is
  just "`ANTHROPIC_API_KEY` is set".
- **16 tasks, 12 features, 2 tiers** (`domain/tasks.ts`, `domain/features.ts`). Haiku 5.5 handles
  quick tasks; Sonnet 5.5 handles `remarks`, `form`, `results` and `brief`. Every task has a Zod
  input, a Zod output, a `finish()` clean-up and PII masking.
- **Guard rails worth keeping:** permission, admin switch, monthly budget, daily cap,
  stray-placeholder check, and the kept/edited/discarded log.
- **Real use, from `vppsone.assist_log` (27 Oct to 4 Nov):** **10 drafts, $0.023 in total.**
- **11 screens** each have their own helper component in `src/vx/assist/*`. **None of the 12 cron
  jobs uses AI.** Cover plans exist only if the covering teacher taps a button.

Cost is not the problem; usage and integration are. Even with the best models (§4), full adoption
costs about **$30 a month, which is inside the Claude Max credit alone**.

## 2. The model line-up (official pages, 5 Nov 2026)

Prices are USD per million tokens (input / output). The Batch APIs are half price on all three.

| Provider | Model ID | Price | Free tier | Use it for |
|---|---|---|---|---|
| Anthropic | `claude-haiku-5-5` | $0.10 / $0.50 | — (credits) | fast fallback for quick tasks |
| Anthropic | `claude-sonnet-5-5` | $2 / $10 | — (credits) | parent-facing Hindi/English writing |
| Anthropic | `claude-opus-5-5` | $4 / $20 | — (credits) | report-card remarks, results, reading handwritten forms |
| Anthropic | `claude-fable-5-1` | $10 / $50 | — | **not used**: no task here needs it |
| OpenAI | `gpt-6-luna` | $0.10 / $0.50 | — (credits) | quick fallback |
| OpenAI | `gpt-6.1-sol` | $2 / $10 | — (credits) | writing and careful fallback (vision) |
| OpenAI | `gpt-6-astra` | $10 / $50 | — | **not used** |
| Google | `gemini-3.1-flash-lite` | $0.25 / $1.50 | **yes** | lookups, matching, how-to |
| Google | `gemini-3.8-flash` | $0.75 / $3.75 → **$1.50 / $7.50 from 1 Jan 2027** | **yes** | quick drafts, cover plans, overnight jobs |
| Google | `gemini-4-argon` | $2 / $10 → **$4 / $20 from 1 Dec 2026** | no | long-term main model for careful work |
| Google | `gemini-3.1-pro-preview` | $2 / $12 | no | preview only; keep out of default chains |

Model IDs live in a database table (§5), not in code, because all three providers rename models
every few months. `gemini-2.5-flash` / `-pro` are deprecated (traffic is rerouted from 1 Dec 2026),
so don't use them.

## 3. How the free Gemini tier works in practice

- **Free and paid Gemini are two Google projects.** A project with billing enabled is on paid
  quota, so you need two keys: `GEMINI_FREE_API_KEY` (no billing) and `GEMINI_API_KEY` (billed).
- Free limits are per project per day and are not published reliably. The router counts requests,
  skips the free key at about 90% of its daily limit, and handles 429s (§6).
- The free tier has no context caching and is slower at busy times. That's fine for quick drafts
  and night jobs, and is why it is not first for work a parent reads.

## 4. Which model does which job

Every task goes into one of three quality tiers. The tier decides the chain, and the person never
chooses a model.

### Tier Q — Quick (internal, short, easy for staff to correct)

`ask.answer`, `columns.match`, `note.polish`, `text.translate`, `cover.plan`, `template.draft`

| Order | Model | Why |
|---|---|---|
| 1 | Gemini free: `gemini-3.8-flash` (`gemini-3.1-flash-lite` for `ask` and `columns`) | costs nothing; good enough for these |
| 2 | `claude-haiku-5-5` (credits) | fast; already proven in the app |
| 3 | `gpt-6-luna` (credits) | |
| 4 | `gemini-3.8-flash` paid | last resort |

### Tier W — Writing that parents or the principal read (Hindi quality matters)

`message.write`, `message.polish`, `message.reply`, `call.script`, `child.summary`,
`class.digest`, `brief.today`

| Order | Model | Why |
|---|---|---|
| 1 | `claude-sonnet-5-5` (credits), effort `low`, server-side `fallbacks: "default"` | best everyday Hindi/English writing; credits otherwise go unused |
| 2 | `gpt-6.1-sol` (credits) | same price class, different provider |
| 3 | Gemini free `gemini-3.8-flash` | still a good draft if both credit providers are down or spent |
| 4 | `gemini-4-argon` paid | |

### Tier C — Careful (official records, many children at once, photos)

`remarks.class`, `results.summary`, `form.read`

| Order | Model | Why |
|---|---|---|
| 1 | `claude-opus-5-5` (credits), effort `low` (writing) / `medium` (`form.read`), `fallbacks: "default"` | the strongest model at a sensible price; report cards and admission records are worth it |
| 2 | `gemini-4-argon` paid for `form.read`; `gpt-6.1-sol` (credits) for the others | Gemini is strong on Devanagari handwriting (prove it in §7) |
| 3 | `gpt-6.1-sol` / Gemini free `gemini-3.8-flash` | |
| 4 | `gemini-4-argon` paid | |

### Background jobs (§9)

Night and weekly jobs use **Gemini free first** (no one is waiting). Weekly class digests use the
**Claude Message Batches API** on `claude-sonnet-5-5` (half price, on credits).

### Estimated monthly spend at full adoption

The estimate assumes about 40 staff × 5 drafts a school day, which is roughly 4,400 drafts a month.

| Tier | Share | Typical tokens | Model | Monthly |
|---|---|---|---|---|
| Q | ~60% | 1.5k in / 0.5k out | Gemini free | **~$0** |
| W | ~35% | 1.5k / 0.6k | Sonnet 5.5 | **~$14** (credits) |
| C | ~5% | 3k / 3k | Opus 5.5 | **~$16** (credits) |

That is about $30 a month against $100–200 of Claude credit plus the OpenAI credit, so the cash
cost today is $0. **Once credits stop (the long-term Gemini plan):** W on `gemini-3.8-flash` paid and
C on `gemini-4-argon` paid comes to **about $25–30 a month** at the January 2027 prices. Switching
is a change to the routes table, not new code.

## 5. Code changes (small, because the single door already exists)

```
src/modules/assist/providers/
  types.ts     Provider interface: run({system, user, image, schema, maxTokens, effort}) →
               {ok, json, usage, model} | {ok:false, kind:"busy"|"quota"|"auth"|"refused"|"bad_output"}
  claude.ts    today's code from run.ts behind the interface; Opus/Sonnet 5.5 keep
               betas ["server-side-fallback-2026-07-01"] + fallbacks "default"; effort per tier
               (Opus 5.5 defaults to "medium" and cannot turn thinking off, so always set it)
  gemini.ts    @google/genai; responseMimeType "application/json" + responseSchema from
               z.toJSONSchema(spec.output) (zod 4.6 has it); thinking level low (thinking is billed
               as output); one client per key (free / paid)
  openai.ts    openai SDK, Responses API with a JSON-schema text format from the same schema
               (confirm structured-output support on the model page for gpt-6-luna / gpt-6.1-sol)
  router.ts    tier → chain; quota/breaker/credit checks; one assist_log row per hop
src/modules/assist/domain/routes.ts   tier per task, default chains, price card per model
```

- `run.ts` keeps every check it has today, in the same order. Only the one
  `claude().beta.messages.parse` call changes, to `routeTask(...)`. `SHARED_RULES`, masking,
  `finish()` and the stray-token check stay the same, so every provider is held to the same rules.
- `featureTier()` (two tiers today) becomes `taskTier()` with Q / W / C, per task rather than per
  feature: `message.reply` and `template.draft` share a feature but not a tier.
- `cost.ts` gets the price cards in §2, including the Gemini price rises dated 1 Dec 2026 and
  1 Jan 2027, so the usage page stays right after those dates.
- `isAssistConfigured()` becomes "at least one provider key is set".
- **Migration (vppsone schema):** `assist_log.provider` and `assist_log.hop`; new
  `assist_routes(tier, chain jsonb)` seeded from §4; `assist_provider_state(provider, day,
  requests, spent_usd, down_until)`; per-provider monthly budgets in `assist_settings`
  (Claude ≤ the linked credit, OpenAI ≤ its credit, Gemini paid a hard cap, e.g. $10).
- **Settings → AI helper (admin only):** a status row per provider in plain words ("Gemini free:
  312 of today's requests used", "Claude credit: $162 left this month", "OpenAI: not linked"),
  a reorderable chain per tier, and kept-rate per provider. Teachers never see a provider or model.
- **Tests:** a router unit test with mocked providers covering order, quota skip, breaker,
  credit skip, and no retrying a refusal elsewhere; one contract test per adapter.

## 6. When the router moves to the next model

It moves on for: 429/quota, 5xx, a timeout (**20 s per hop**, still ≤ 60 s total, and Tier C gets
40 s for the first hop), a connection error, an auth error (that provider is marked down), JSON
that fails the task's Zod schema, a stray placeholder, or `finish()` returning null.

It does **not** move on for a safety decline on a child or parent task. That is reported as
"refused", as today, so one decline is not tried across three providers. Claude's server-side
fallback already handles its own false positives within the same call.

Free-tier protection: a daily counter per key (skip at about 90%), and a circuit breaker
(3 failures in 5 minutes → skip for 10 minutes). Credit protection: when a provider's monthly
budget is spent, skip it. The overall monthly budget stays as the final stop.

## 7. Prove quality before trusting a model: an eval set

`scripts/assist-eval.mjs` holds 8–10 **synthetic** inputs per task (Hindi, English and mixed;
photographed sample forms filled in with made-up details). It runs each through every model in the
task's chain and writes a side-by-side HTML sheet for Janmejay and two teachers to score. Use it to:

- confirm Gemini 3.8 Flash is good enough as the first choice for Tier Q in Hindi;
- choose between Opus 5.5 and Gemini 4 Argon for `form.read`;
- decide when Gemini paid can take over Tiers W and C after the credits.

In production, the kept/edited/discarded log split by provider and model is the ongoing check.

## 8. Making AI part of the work, not a button

### 8.1 One pattern everywhere: the suggestion card

A single `SuggestionCard` in `src/vx/assist/parts.tsx` with the same shape on every screen: a ✦ mark,
the draft, **Use / Change / Not now**, and "Helper's draft — check before saving". Hindi first,
strings in `src/messages`. It replaces the 11 slightly different button-and-panel combinations. With
AI off or failing, the card is not shown, so every screen works without it (PLAN §1).

### 8.2 Substitution → cover plan → notes (the missing loop)

1. **When a teacher marks leave**, they can say or type one line, for example "Class 7B: finish ch. 4
   exercise 2". It is passed to `cover.plan` as the brief.
2. **When cover is confirmed** (`confirmGuidedCoverAction`), a cover plan per duty is drafted in the
   background (Tier Q, Gemini free) and is waiting on the covering teacher's Teach home with no tap.
3. **After the period**, the cover card asks "How did it go?" (voice or one tap: settled / work done /
   problem). It is saved as a **Note** on the class, tagged `cover`, tidied by `note.polish`, and
   shown to the absent teacher when they return.
4. The weekly `class.digest` includes cover periods.

### 8.3 Notes that tidy themselves

- On save, `note.polish` runs in the background and shows "Tidied version ready — use it?" on the
  note, instead of a button the teacher must remember before saving. Suggested tags are tappable chips.
- Student 360 shows a cached `child.summary` (Tier W) that refreshes when new notes arrive.

### 8.4 A "Ready for you" tray on Today

One strip lists drafts waiting for this person ("Cover plan for 7B, period 4 · Class digest for 9A ·
Reply to a parent (2)"). Each opens the screen with the suggestion card filled in. This is how
non-technical staff discover the helper.

## 9. AI inside the automations (drafts only, never sent)

Jobs write to a new `assist_drafts(owner, kind, ref, payload, expires_at)` table. D-10/D-76 hold:
staff send, jobs never do.

| Job | When (IST) | What it drafts | Model route |
|---|---|---|---|
| `assist-cover-plans` | 07:30, and on every cover confirm | plan per cover duty | Tier Q (Gemini free) |
| `assist-today-brief` | 07:40 | Today brief per `attendance:correct` holder | Tier W |
| `assist-class-digest` | Sat 13:00 | week's notes per class teacher | Sonnet 5.5 via **Message Batches** |
| `missing-marks-nudge` (existing) | Sun 17:00 | friendlier wording per teacher | Tier Q |
| `fee-day-summary` (existing) | 19:00 | one paragraph on top of the figures (slots only) | Tier W |
| `assist-drafts-purge` | nightly | delete expired drafts | — |

Jobs count against the same budgets and caps as live requests.

## 10. One-time set-up the owner does (about 30 minutes)

1. **Claude:** claude.ai → Settings → Billing → API credits → **Link organization** to the Claude
   Console org whose key is in `ANTHROPIC_API_KEY`. The link is permanent, and new subscribers wait
   7 days before they can claim. Without the link, the key bills a card instead of using the credits.
2. **OpenAI:** in ChatGPT's settings, link the **API Platform organization** for the Pro credits,
   then create `OPENAI_API_KEY` in that organization. The credits cover API usage, not Codex API keys.
3. **Gemini:** in Google AI Studio, create a key in a project **without** billing
   (`GEMINI_FREE_API_KEY`) and one in a project **with** billing and a budget alert
   (`GEMINI_API_KEY`).
4. Add all four as Vercel production environment variables (server only), next to the existing key
   (docs/SETUP.md table).

## 11. Order of work (each slice ships on its own)

| # | Slice | Size | Unblocks |
|---|---|---|---|
| 1 | Provider interface; Claude behind it; router with one-item chains; Q/W/C tiers (Opus 5.5 on Tier C) | 1 day | everything |
| 2 | Gemini adapter (free + paid), quota counter, breaker; migration | 1–2 days | free tier for Tier Q and jobs |
| 3 | OpenAI adapter; per-provider credit budgets; Settings provider status and chain editor | 1 day | using both credits |
| 4 | Eval script and scoring sheet; adjust routes from the results | 1 day | trust in each model for Hindi |
| 5 | `SuggestionCard` + `assist_drafts` + Today "Ready for you" tray | 2 days | §8, §9 |
| 6 | Substitution → cover plan → notes loop (§8.2) | 2 days | the "connected" feeling |
| 7 | Background note tidy, cached child summary (§8.3) | 1 day | |
| 8 | AI jobs (§9) with batch APIs | 2 days | |
| 9 | When credits end, or evals allow: put Gemini paid first in Tiers W/C | settings only | "Gemini main" |

Acceptance for every slice: `npm run check` is green, router tests cover every fall-through path,
every screen still works with all keys removed, and the admin usage page shows provider, model, hop
and kept-rate. Record D-numbers in `docs/DECISIONS.md` and a row in `docs/PROGRESS.md`.

## 12. Still open

1. Which Claude Max tier ($100 or $200 credit) and which ChatGPT Pro tier? This sets the per-provider budgets.
2. Who scores the eval sheet (§7)?
3. Should a cover "How did it go?" note be visible to the principal, or only to the class teacher
   and the absent teacher?

## Sources

- Gemini pricing, models and free tier (official): https://aistudio.google.com/docs/pricing
- OpenAI models and prices (official): https://developers.openai.com/api/docs/models
- Claude models and prices: the `claude-api` skill's model table (cached 6 Oct 2026); live at platform.claude.com
- Claude Max API credits: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan , https://www.developersdigest.tech/blog/claude-max-team-monthly-api-credits-2026
- ChatGPT Pro API credits: https://dev.to/paullovelace/openai-will-give-chatgpt-pro-and-business-subscribers-up-to-500-a-month-in-api-credits-explained-498a , https://www.datastudios.org/post/openai-chatgpt-pro-business-monthly-api-credits-up-to-500
- Gemini free vs paid data terms: https://ai.google.dev/gemini-api/terms_preview
