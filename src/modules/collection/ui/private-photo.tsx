import type { ComponentProps } from "react";

/** Private signed URLs and local previews must not enter a public image cache. */
export function PrivatePhoto(props: ComponentProps<"img">) {
  // eslint-disable-next-line @next/next/no-img-element -- short-lived authorized URL, no shared optimizer cache.
  return <img decoding="async" {...props} alt={props.alt ?? ""} />;
}
