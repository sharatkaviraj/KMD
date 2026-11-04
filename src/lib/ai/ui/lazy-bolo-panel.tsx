"use client";

import dynamic from "next/dynamic";

export const LazyBoloPanel = dynamic(() => import("./bolo-panel").then((m) => m.BoloPanel));
