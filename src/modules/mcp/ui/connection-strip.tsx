import Link from "next/link";

import { aiConnectionMessages as a } from "@/messages/ai-connection";
import type { CardState } from "@/modules/mcp/domain/card";
import { istDateTime } from "@/modules/mcp/ui/format";
import { ConnectClaude, type ConnectClaudeWords } from "@/modules/mcp/ui/connect-claude";
import { flat, type Language, type Localized } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";

/** Where the address and the steps are: the person's own card on Preferences. */
export const AI_CONNECTION_CARD_HREF = "/preferences#ai-connection";

/** The Connect Claude button's words, said on the server (rule 9). */
export function connectClaudeWords(language: Language): ConnectClaudeWords {
  const say = (text: Localized) => flat(text, language);
  return {
    button: say(a.connectClaude),
    opened: say(a.claudeOpened),
    openedNoCopy: say(a.claudeOpenedNoCopy),
    steps: [say(a.claudeStep1), say(a.claudeStep2), say(a.claudeStep3)],
    openAgain: say(a.claudeOpenAgain),
    once: say(a.claudeOnce),
  };
}

/** States in which the next thing to do is connect (again). */
export const CONNECT_STATES: ReadonlySet<CardState["kind"]> = new Set(["not_connected", "disconnected", "reconnect_required"]);

/**
 * Today's one line about the AI connection (owner, 4 Nov): whether this person
 * is connected, from One's own records, and the one place to act. Shown only
 * to someone the card is for (eligible, or who has connected before); it says
 * "allowed", never "connected and working", because One cannot see inside
 * Claude or ChatGPT.
 */
export function AiConnectionStrip({ state, language, canManage, address }: { state: CardState; language: Language; canManage: boolean; address: string | null }) {
  if (state.kind === "unavailable") return null;
  const say = (text: Localized) => flat(text, language);
  let tone: "todo" | "ok" | "off" = "todo";
  let status: string;
  let action: Localized;
  let href = AI_CONNECTION_CARD_HREF;

  switch (state.kind) {
    case "not_connected":
      status = say(a.stripNotConnected);
      action = a.stripConnect;
      break;
    case "allowed": {
      tone = "ok";
      const last = state.live.map((row) => row.lastUsedAt).filter((when): when is string => Boolean(when)).sort().at(-1);
      status = `${say(a.allowed)} · ${say(last ? a.lastUsed(istDateTime(last)) : a.notUsedYet)}`;
      action = a.stripManage;
      break;
    }
    case "switched_off":
      tone = "off";
      status = say(canManage ? a.stripSwitchedOffAdmin : a.cardSwitchedOff);
      action = canManage ? a.stripTurnOn : a.stripManage;
      if (canManage) href = "/settings/ai-connection";
      break;
    case "disconnected":
      status = say(a.disconnected);
      action = a.stripConnect;
      break;
    case "reconnect_required":
      status = say(a.reconnect);
      action = a.stripReconnect;
      break;
  }

  // Not connected yet (or again): the button itself, so nobody has to find the card first.
  if (address && CONNECT_STATES.has(state.kind)) {
    return (
      <div className="vx-ai-strip-wrap">
        <div className={`vx-ai-strip vx-ai-strip-${tone}`}>
          <Ic n="sparkle" size={16} />
          <span className="vx-ai-strip-text">
            <strong>{say(a.stripTitle)}</strong>
            <span>{status}</span>
          </span>
        </div>
        <ConnectClaude address={address} words={connectClaudeWords(language)} className="vx-ai-strip-wrap" />
      </div>
    );
  }

  return (
    <Link href={href} className={`tap vx-ai-strip vx-ai-strip-${tone}`}>
      <Ic n="sparkle" size={16} />
      <span className="vx-ai-strip-text">
        <strong>{say(a.stripTitle)}</strong>
        <span>{status}</span>
      </span>
      <span className="vx-ai-strip-act">{say(action)}<Ic n="chevRight" size={14} /></span>
    </Link>
  );
}
