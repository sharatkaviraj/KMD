"use client";

import { useEffect } from "react";

import { m } from "@/messages";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Button } from "@/ui/primitives/button";
import { ErrorState } from "@/ui/states";

/**
 * The boundary for every signed-in screen.
 *
 * Sentry arrives in Phase 7; until then the digest is what makes a report
 * actionable — it is the id Vercel's logs carry, so "it said a1b2c3" is
 * enough to find the actual stack without showing anybody a stack.
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

  useEffect(() => {
    console.error(error);
  }, [error]);

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
