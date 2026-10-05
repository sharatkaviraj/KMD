import * as React from "react";
import type { ImageProps } from "next/image";

/** The fixture serves public files directly; production uses Next's optimizer. */
export default function Image({ src, alt, fill, preload: _preload, priority: _priority, sizes, ...props }: ImageProps) {
  // Next-only loading props must not leak onto the fixture's HTML element.
  void _preload;
  void _priority;
  const source = typeof src === "string" ? src : "default" in src ? src.default.src : src.src;
  // eslint-disable-next-line @next/next/no-img-element -- direct public-file rendering in the isolated UI fixture
  return <img {...props} src={source} alt={alt} sizes={sizes}
    style={{ ...(fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : {}), ...props.style }} />;
}
