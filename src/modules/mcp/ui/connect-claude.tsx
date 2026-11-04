"use client";

import { useState } from "react";

/** Claude's own Connectors page (claude.com/docs/connectors/custom/remote-mcp links it). */
export const CLAUDE_CONNECTORS_URL = "https://claude.ai/customize/connectors";

export type ConnectClaudeWords = {
  button: string;
  opened: string;
  openedNoCopy: string;
  steps: [string, string, string];
  openAgain: string;
  once: string;
};

/**
 * One tap toward connecting Claude (owner, 4 Nov): copies One's address and
 * opens Claude's Connectors page in a new tab, then says the three things left
 * to do there. Claude documents no link that pre-fills the address, so this
 * does not pretend to finish the job; the card says "Allowed" only once One's
 * own records show the approval. The words come from the server (rule 9).
 */
export function ConnectClaude({ address, words, className }: { address: string; words: ConnectClaudeWords; className?: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const start = async () => {
    // The copy starts while this page still has focus, and the tab opens inside
    // the tap so the browser does not block it.
    const copying = navigator.clipboard?.writeText(address).then(() => true, () => false) ?? Promise.resolve(false);
    window.open(CLAUDE_CONNECTORS_URL, "_blank", "noopener,noreferrer");
    setCopied(await copying);
  };

  return (
    <div className={className ?? "flex flex-col gap-2"}>
      <button type="button" className="tap vx-connect-claude" onClick={start}>{words.button}</button>
      {copied !== null ? (
        <div role="status" className="vx-connect-claude-steps">
          <p>{copied ? words.opened : words.openedNoCopy}</p>
          <ol>
            {words.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <p className="vx-connect-claude-once">{words.once}</p>
          <a href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noopener noreferrer" className="vx-lnk">{words.openAgain}</a>
        </div>
      ) : null}
    </div>
  );
}
