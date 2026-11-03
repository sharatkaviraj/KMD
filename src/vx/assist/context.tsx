"use client";

import { createContext, useContext } from "react";

import type { AssistFeature } from "@/modules/assist/domain/features";

/**
 * Which AI helper features this person is offered (D-324), decided once by
 * the shell on the server: the key is set, the admin has the feature on and
 * the person may already do the job by hand. An empty list — the default —
 * means every AI button stays out of the page.
 */
const AssistContext = createContext<readonly AssistFeature[]>([]);

export function AssistProvider({ features, children }: { features: readonly AssistFeature[]; children: React.ReactNode }) {
  return <AssistContext.Provider value={features}>{children}</AssistContext.Provider>;
}

export function useAssistOffers(feature: AssistFeature): boolean {
  return useContext(AssistContext).includes(feature);
}
