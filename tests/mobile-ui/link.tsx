import type { AnchorHTMLAttributes, ReactNode } from "react";
export default function Link({ href, children, prefetch, scroll, replace, unstable_dynamicOnHover, onNavigate, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode; prefetch?: unknown; scroll?: unknown; replace?: unknown; unstable_dynamicOnHover?: unknown; onNavigate?: unknown }) {
  // The fixture replaces routing only; real component semantics/styles stay intact.
  void prefetch; void scroll; void replace; void unstable_dynamicOnHover; void onNavigate;
  return <a href={href} {...props}>{children}</a>;
}
export function useLinkStatus() { return { pending: false }; }
