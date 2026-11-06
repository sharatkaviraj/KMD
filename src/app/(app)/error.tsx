"use client";

import { useEffect } from "react";

import * as m from "@/messages/pairs";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Button } from "@/ui/primitives/button";
import { ErrorState } from "@/ui/states";
import { isChunkLoadError, reloadOnceForChunk } from "@/vx/shell/chunk-reload";

/**
 * The boundary for every signed-in screen.
 *
 * Sentry arrives in Phase 7; until then the digest is what makes a report
 * actionable — it is the id Vercel's logs carry, so "it said a1b2c3" is
 * enough to find the actual stack without showing anybody a stack.
 *
 * A chunk that did not arrive (weak 4G) is not a broken page: the screen
 * reloads itself once, and if that does not help it says so in the reader's
 * language with a Reload button — "Try again" re-renders without fetching the
 * missing chunk, so it would only fail again (coordinators B10, BUG-12).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The shell is above this boundary, so its LanguageProvider still applies:
  // an error screen speaks the same language as the screen that failed.
  const language = useLanguage();
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    console.error(error);
    if (chunk) reloadOnceForChunk(window);
  }, [error, chunk]);

  if (chunk) {
    return (
      <div className="py-6">
        <ErrorState
          language={language}
          title={m.pageNotLoaded}
          detail={primary(m.pageNotLoadedHelp, language)}
          action={
            <Button variant="outline" onClick={() => window.location.reload()}>
              {primary(m.reload, language)}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="py-6">
      <ErrorState
        language={language}
        detail={
          error.digest ? `${primary(m.reference, language)} ${error.digest}` : null
        }
        action={
          <Button variant="outline" onClick={reset}>
            {primary(m.tryAgain, language)}
          </Button>
        }
      />
    </div>
  );
}
