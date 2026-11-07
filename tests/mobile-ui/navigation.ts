import { useSyncExternalStore } from "react";
const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
};
export function usePathname() {
  return useSyncExternalStore(subscribe, () => new URLSearchParams(location.search).get("path") ?? (location.pathname === "/" ? "/teach" : location.pathname));
}
export function useSearchParams() { return new URLSearchParams(location.search); }
export function useRouter() { return {
  push: (href: string) => { history.pushState(null, "", href); window.dispatchEvent(new PopStateEvent("popstate")); },
  replace: (href: string) => { history.replaceState(null, "", href); window.dispatchEvent(new PopStateEvent("popstate")); },
  back: () => history.back(),
  refresh: () => { window.dispatchEvent(new Event("qa:refresh")); },
  prefetch: () => {},
}; }
export function useLinkStatus() { return { pending: false }; }
// Server-side helpers some screens import transitively; a fixture never calls them.
export function redirect(href: string): never { throw new Error(`redirect ${href}`); }
export function notFound(): never { throw new Error("notFound"); }
export const RedirectType = { push: "push", replace: "replace" } as const;
