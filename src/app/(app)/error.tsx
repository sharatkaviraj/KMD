"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-6">
      <ErrorState
        detail={error.digest ? `संदर्भ · ref ${error.digest}` : null}
        action={
          <Button variant="outline" onClick={reset}>
            फिर कोशिश करें · Try again
          </Button>
        }
      />
    </div>
  );
}
