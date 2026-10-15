"use client";

import { useEffect } from "react";

import { m } from "@/messages";
import { primary, secondary, type Localized } from "@/platform/i18n/language";
import { isChunkLoadError, reloadOnceForChunk } from "@/vx/shell/chunk-reload";

/**
 * The last boundary, for a failure above every layout — most often a chunk
 * of the app itself that did not arrive on weak 4G. Without this file Next
 * drew its own English-only, unstyled "This page couldn't load" (coordinators
 * B10, class-teacher BUG-12).
 *
 * It replaces the root layout, so no provider is above it and the reader's
 * language is not known here: it says each line in Hindi with the English
 * beneath, as the "both" reading does. Inline styles, because the app's
 * stylesheet may be one of the things that did not load.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    console.error(error);
    // Once, by itself; the page says what happened if that does not help.
    if (chunk) reloadOnceForChunk(window);
  }, [error, chunk]);

  return (
    <html lang="hi">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box", background: "#F7F6F3", color: "#1C1917", fontFamily: "system-ui, -apple-system, 'Noto Sans Devanagari', sans-serif" }}>
        <main role="alert" style={{ maxWidth: 420, width: "100%", textAlign: "center", display: "flex", flexDirection: "column", gap: 12 }}>
          <Both text={m.pageNotLoaded} size={20} weight={700} />
          <Both text={m.pageNotLoadedHelp} size={15} weight={400} />
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ alignSelf: "center", minHeight: 48, padding: "0 24px", borderRadius: 14, border: 0, background: "#0B4F79", color: "#FFFFFF", fontSize: 16, fontWeight: 600 }}
          >
            {primary(m.reload, "hi")} · {primary(m.reload, "en")}
          </button>
          {error.digest ? <span style={{ fontSize: 12, color: "#78716C" }}>{`${primary(m.reference, "en")} ${error.digest}`}</span> : null}
        </main>
      </body>
    </html>
  );
}

function Both({ text, size, weight }: { text: Localized; size: number; weight: number }) {
  const english = secondary(text, "both");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: size, fontWeight: weight, lineHeight: 1.4 }}>{primary(text, "hi")}</span>
      {english ? <span style={{ fontSize: size - 3, color: "#57534E", lineHeight: 1.4 }}>{english}</span> : null}
    </div>
  );
}
