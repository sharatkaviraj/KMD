import { useSyncExternalStore } from "react";
const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
};
export function usePathname() { return useSyncExternalStore(subscribe, () => location.pathname); }
export function useSearchParams() { return new URLSearchParams(useSyncExternalStore(subscribe, () => location.search)); }
export function useRouter() { return {
  push: (href: string) => { history.pushState(null, "", href); window.dispatchEvent(new PopStateEvent("popstate")); },
  back: () => history.back(),
  refresh: () => window.dispatchEvent(new PopStateEvent("popstate")),
  prefetch: () => {},
}; }
export function useLinkStatus() { return { pending: false }; }
