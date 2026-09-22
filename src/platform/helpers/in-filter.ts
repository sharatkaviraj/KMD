/**
 * How many ids may go into one PostgREST `.in(...)` filter.
 *
 * **The limit is real, close, and fails in the worst possible way.** A `.in()`
 * list is serialized into the request URL, so every uuid costs about 37 bytes.
 * Measured against this deployment: a list of **300 ids (~11 KB of URL)
 * succeeds; 400 (~15 KB) does not**. Shri Veer Patta has 583 active children,
 * so any query that batches "every student" in one filter is already over the
 * line — not at some future scale.
 *
 * What makes it expensive is the failure mode. An over-long URL is not
 * refused quickly: `fetch` hangs for about **eight seconds** and then rejects
 * with `TypeError: fetch failed`. Call sites written as
 * `const { data } = await …` turn that into an empty array, so the screen
 * renders with a plausible-looking nothing — no call history, no promise
 * counts, no repayment plan — and takes eight seconds longer to do it. Two
 * such queries on the defaulters queue cost sixteen seconds and four missing
 * columns, and nothing anywhere said a query had failed.
 *
 * 200 leaves comfortable headroom under the measured 300 and keeps a
 * whole-school read to three requests.
 *
 * This constant already existed as a local in `ai-context-bundle.ts`, and the
 * same reasoning as a prose comment in three other files. It is here so the
 * next person writing `.in("student_id", ids)` has one place to find it.
 */
export const IN_FILTER_CHUNK_SIZE = 200;
