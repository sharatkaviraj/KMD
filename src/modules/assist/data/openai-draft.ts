import "server-only";

import { z } from "zod";

import { costUsd } from "../domain/cost";
import type { AssistImage } from "../domain/tasks";

/** What one provider stage returned, in the same shape for Claude, OpenAI and Gemini. */
export type StageReply = {
  /** The parsed JSON, still unchecked; the task's Zod schema and `finish()` decide whether it is a draft. */
  candidate: unknown;
  /** The provider declined on safety grounds. The chain stops: a decline is not tried on the next provider. */
  refused: boolean;
  input: number;
  output: number;
  cacheRead: number;
  costUsd: number;
};

type ResponsesBody = {
  status?: string;
  output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  error?: { code?: unknown; type?: unknown } | null;
};

const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

/**
 * One draft from the OpenAI Responses API (the ChatGPT Pro plan's monthly API
 * credits, D-416). Plain `fetch`, as the transcription stage does: no SDK, no
 * stored conversation (`store: false`), and the JSON schema is a hint — the
 * task's Zod schema validates the answer here, exactly as for Claude.
 *
 * Errors are thrown with the HTTP status and a short code only, for
 * `failureOf()`; an upstream message can quote the request.
 */
export async function openaiDraft(opts: {
  apiKey: string;
  model: string;
  instructions: string;
  text: string;
  image: AssistImage | null;
  output: z.ZodType;
  maxTokens: number;
  timeoutMs: number;
  fetcher?: typeof fetch;
}): Promise<StageReply> {
  const schema: Record<string, unknown> = { ...z.toJSONSchema(opts.output) };
  delete schema.$schema;
  const content: Record<string, unknown>[] = [{ type: "input_text", text: opts.text }];
  if (opts.image) content.push({ type: "input_image", image_url: `data:${opts.image.mediaType};base64,${opts.image.data}` });

  const response = await (opts.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      instructions: opts.instructions,
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "draft", schema, strict: false } },
      max_output_tokens: opts.maxTokens,
      store: false,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
    redirect: "error",
  });
  const body = (await response.json().catch(() => null)) as ResponsesBody | null;
  if (!response.ok) {
    const code = [body?.error?.code, body?.error?.type].find((v) => typeof v === "string" && /^[a-z_]{1,48}$/u.test(v)) ?? "";
    throw Object.assign(new Error(`OpenAI draft unavailable ${code}`.trim()), { status: response.status });
  }

  const input = count(body?.usage?.input_tokens);
  const output = count(body?.usage?.output_tokens);
  const cacheRead = Math.min(input, count(body?.usage?.input_tokens_details?.cached_tokens));
  const reply = { input, output, cacheRead, costUsd: costUsd(opts.model, { input_tokens: input - cacheRead, output_tokens: output, cache_read_input_tokens: cacheRead }) };

  const parts = (body?.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []);
  if (parts.some((part) => part.type === "refusal")) return { ...reply, candidate: undefined, refused: true };
  if (body?.status && body.status !== "completed") return { ...reply, candidate: undefined, refused: false };
  const text = parts.filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("");
  let candidate: unknown;
  try { candidate = JSON.parse(text); } catch { /* No usable draft. */ }
  return { ...reply, candidate, refused: false };
}
