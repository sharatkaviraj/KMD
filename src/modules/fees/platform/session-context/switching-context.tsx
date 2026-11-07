"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

type SwitchingContextValue = {
  isSwitching: boolean;
  setIsSwitching: (value: boolean) => void;
  /**
   * The year a pill is opening, so the switch card can name it ("Opening
   * 2026-27…", then "Now showing 2026-27"). A pill sets it when a year is
   * tapped and clears it when the switch fails, so a failure never reads as
   * done (smoke 7 Nov 2026).
   */
  target?: string | null;
  setTarget?: (label: string | null) => void;
};

const SwitchingContext = createContext<SwitchingContextValue>({
  isSwitching: false,
  setIsSwitching: () => {},
  target: null,
  setTarget: () => {},
});

export function SessionSwitchingProvider({ children }: { children: ReactNode }) {
  const [isSwitching, setIsSwitching] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const value = useMemo(
    () => ({ isSwitching, setIsSwitching, target, setTarget }),
    [isSwitching, target],
  );

  return (
    <SwitchingContext.Provider value={value}>
      {children}
    </SwitchingContext.Provider>
  );
}

export function useSessionSwitching() {
  return useContext(SwitchingContext);
}
