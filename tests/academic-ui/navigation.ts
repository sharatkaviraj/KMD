import { useSyncExternalStore } from "react";
const subscribe = (cb: () => void) => { window.addEventListener("popstate", cb); return () => window.removeEventListener("popstate", cb); };
export function usePathname() { return useSyncExternalStore(subscribe, () => location.pathname); }
export function useSearchParams() { useSyncExternalStore(subscribe, () => location.href); return new URLSearchParams(location.search); }
const move = (href: string, replace = false) => { history[replace ? "replaceState" : "pushState"](null, "", href); window.dispatchEvent(new PopStateEvent("popstate")); };
export function useRouter() { return { push: (href: string) => move(href), replace: (href: string) => move(href, true), back: () => history.back(), refresh: () => window.dispatchEvent(new Event("qa:refresh")), prefetch: () => {} }; }
export function useLinkStatus() { return { pending: false }; }
