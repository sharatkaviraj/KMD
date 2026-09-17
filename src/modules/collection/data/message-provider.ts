import "server-only";

import { getOptionalEnvVar, getVppsOneEnvironment } from "@/platform/env";
import type { MessageSend } from "@/modules/collection/domain/messages";
import {
  mockOutcomeFor,
  mockProviderMessageId,
  outcomeErrors,
  type ProviderOutcome,
} from "@/modules/collection/domain/provider";

/**
 * The one seam a message goes out through.
 *
 * PLAN §2 asks for a typed provider adapter with a success/failure/rate-limit
 * mock, and PLAN §1 for the reason: **a test student does not make a recipient
 * phone a test phone.** Every QA run that exercises sending has to be able to
 * get a 429, a timeout and a duplicate on demand, and none of those may involve
 * a real handset or a real invoice.
 *
 * Two implementations, chosen by `MESSAGE_PROVIDER`:
 *
 *  - unset or `aisensy` — the real one, which still refuses without an API key
 *    this repository deliberately does not carry (rule 8: sending costs money).
 *  - `mock` — decides from the destination's last digit and touches nothing.
 *
 * There is no third state where the app guesses. A deploy that has not been
 * told which provider it has behaves exactly as it did before this file
 * existed.
 */

export type DispatchResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string };

export type MessageProvider = {
  /** Recorded in evidence so a run can say which provider produced it. */
  readonly id: "aisensy" | "mock";
  send(send: MessageSend): Promise<DispatchResult>;
};

/* ------------------------------------------------------------- the real one */

const aisensyProvider: MessageProvider = {
  id: "aisensy",

  async send(send) {
    const apiKey = getOptionalEnvVar("AISENSY_API_KEY");

    if (!apiKey) {
      return {
        ok: false,
        error:
          "No AISENSY_API_KEY is configured, so nothing was sent. Open it in WhatsApp and press send.",
      };
    }

    try {
      const response = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey,
          campaignName: send.templateCode,
          destination: `91${send.toPhone}`,
          userName: send.toName ?? "",
          templateParams: send.variables,
        }),
      });

      if (!response.ok) {
        return { ok: false, error: `The provider refused it (${response.status}).` };
      }

      const body: unknown = await response.json().catch(() => null);
      const id =
        body && typeof body === "object" && "messageId" in body
          ? String((body as { messageId: unknown }).messageId)
          : "";

      return { ok: true, providerMessageId: id };
    } catch (thrown) {
      return {
        ok: false,
        error:
          thrown instanceof Error ? thrown.message : "The provider could not be reached.",
      };
    }
  },
};

/* ----------------------------------------------------------------- the mock */

/**
 * How long "slow" takes.
 *
 * Long enough that a screen without a pending state looks broken, short enough
 * that a suite of them does not become the reason nobody runs the suite. Not
 * configurable: a timing fixture somebody can turn down is a timing fixture
 * that gets turned down until it stops catching anything.
 */
const SLOW_MS = 1_200;

const mockProvider: MessageProvider = {
  id: "mock",

  async send(send) {
    const outcome: ProviderOutcome = mockOutcomeFor(send.toPhone);

    if (outcome === "slow") {
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
    }

    switch (outcome) {
      case "sent":
      case "slow":
      case "duplicate":
        // `duplicate` succeeds, and succeeds *identically* every time — the id
        // is derived from the send, so a second dispatch is indistinguishable
        // from a replayed callback. What must not happen next is a second
        // `sent_at`, and `recordDispatch()`'s `.neq("status", "sent")` is what
        // stops it.
        return { ok: true, providerMessageId: mockProviderMessageId(send.id) };

      case "timeout":
      case "rate_limited":
      case "server_error":
        return { ok: false, error: outcomeErrors[outcome].en };
    }
  },
};

/* ------------------------------------------------------------- the choice */

export class ProviderMisconfigured extends Error {}

/**
 * Which provider this deployment has.
 *
 * The `live` guard is the one worth reading twice. A live deployment running
 * the mock would write `sent` rows and `mock:` ids for messages nobody ever
 * received, and the office would find out when a parent said they had not been
 * told. Refusing to start is the cheaper failure.
 */
export function selectProvider(): MessageProvider {
  const configured = getOptionalEnvVar("MESSAGE_PROVIDER")?.toLowerCase();

  if (!configured || configured === "aisensy") return aisensyProvider;

  if (configured === "mock") {
    if (getVppsOneEnvironment() === "live") {
      throw new ProviderMisconfigured(
        "MESSAGE_PROVIDER=mock is refused on a live deployment: it would record messages as sent that nobody received.",
      );
    }
    return mockProvider;
  }

  throw new ProviderMisconfigured(
    `Unknown MESSAGE_PROVIDER: ${configured}. Expected "aisensy" or "mock".`,
  );
}

/** Exported for tests; production code goes through `selectProvider()`. */
export const providers = { aisensyProvider, mockProvider };
