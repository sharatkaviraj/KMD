"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type { NeedsStrip as Strip } from "./strip";

/**
 * The Needs you strip in its own chunk (D-630). `/teach/attendance` counts
 * `/teach`'s chunk in its first load, the tightest budget in One
 * (`check:bundles`), so the strip is fetched on its own. The server still
 * draws it, so it arrives with the page.
 */
const NeedsStrip = dynamic(() => import("./strip").then((m) => m.NeedsStrip), {
  loading: () => <div className="skel" style={{ height: 76, borderRadius: 18 }} />,
});

export function NeedsStripLazy(props: ComponentProps<typeof Strip>) {
  return <NeedsStrip {...props} />;
}
