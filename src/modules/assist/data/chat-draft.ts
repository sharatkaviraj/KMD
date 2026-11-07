import "server-only";

import { z } from "zod";

import type { StageReply } from "./openai-draft";

type ChatBody = {
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: unknown } | null;
};

const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

/**
 * The JSON object in a reply that may wrap it in a code fence or a sentence.
 * `undefined` when there is none. Some free models think out loud inside a
 * `<think>` block before answering; that is dropped first, so a brace in the
 * reasoning is never taken for the answer.
 */
export function jsonFrom(text: string): unknown {
  const answer = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/giu, "");
  const trimmed = answer.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try { return JSON.parse(trimmed); } catch { /* Look for the object inside. */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* No usable draft. */ }
  }
  return undefined;
}

/**
 * One draft from an OpenAI-compatible Chat Completions endpoint on a free
 * tier: OpenRouter's `:free` models or NVIDIA's API catalogue (D-490). These
 * cost nothing, so the reply's cost is always 0. The schema is sent in the
 * instructions; the task's Zod schema validates the answer in `run.ts`. A
 * free model's decline is not a refusal of the task: the next stage tries.
 *
 * Errors carry the HTTP status and a short code only, for `failureOf()`.
 */
export async function chatDraft(opts: {
  url: string;
  apiKey: string;
  model: string;
  /** OpenRouter's ordered fallbacks; all must be free (`config.ts`). */
  models?: string[];
  instructions: string;
  text: string;
  output: z.ZodType;
  maxTokens: number;
  timeoutMs: number;
  /** Ask for `response_format: json_object`; off for endpoints that may reject it. */
  jsonMode?: boolean;
  /**
   * Send the task's schema as `response_format: json_schema`, so a model that
   * supports it is held to the shape while it writes (D-496). Wins over `jsonMode`.
   */
  jsonSchema?: boolean;
  headers?: Record<string, string>;
  extra?: Record<string, unknown>;
  fetcher?: typeof fetch;
}): Promise<StageReply & { model: string }> {
  const schema: Record<string, unknown> = { ...z.toJSONSchema(opts.output) };
  delete schema.$schema;
  const system = `${opts.instructions}\n\nAnswer with one JSON object only — no other words and no code fence — that fits this JSON Schema:\n${JSON.stringify(schema)}`;

  const response = await (opts.fetcher ?? fetch)(opts.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json", Accept: "application/json", ...opts.headers },
    body: JSON.stringify({
      model: opts.model,
      ...(opts.models?.length ? { models: opts.models } : {}),
      messages: [{ role: "system", content: system }, { role: "user", content: opts.text }],
      max_tokens: opts.maxTokens,
      temperature: 0.3,
      stream: false,
      ...(opts.jsonSchema
        ? { response_format: { type: "json_schema", json_schema: { name: "draft", schema, strict: true } } }
        : opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...opts.extra,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
    redirect: "error",
  });
  const body = (await response.json().catch(() => null)) as ChatBody | null;
  const codeOf = (value: unknown) => (typeof value === "string" && /^[a-z_]{1,48}$/u.test(value) ? value : "");
  if (!response.ok) {
    throw Object.assign(new Error(`Free model unavailable ${codeOf(body?.error?.code)}`.trim()), { status: response.status });
  }
  // OpenRouter can answer 200 with an error from the upstream model.
  if (body?.error) {
    const status = typeof body.error.code === "number" && body.error.code >= 400 && body.error.code <= 599 ? body.error.code : 502;
    throw Object.assign(new Error("Free model unavailable"), { status });
  }

  const choice = body?.choices?.[0];
  const reply = {
    input: count(body?.usage?.prompt_tokens),
    output: count(body?.usage?.completion_tokens),
    cacheRead: 0,
    costUsd: 0,
    refused: false,
    model: typeof body?.model === "string" && body.model.length >= 3 && body.model.length <= 60 ? body.model : opts.model,
  };
  const finished = !choice?.finish_reason || choice.finish_reason === "stop" || choice.finish_reason === "eos";
  return { ...reply, candidate: finished ? jsonFrom(choice?.message?.content ?? "") : undefined };
}
