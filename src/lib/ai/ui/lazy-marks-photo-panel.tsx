"use client";

import dynamic from "next/dynamic";

export const LazyMarksPhotoPanel = dynamic(() => import("./marks-photo-panel").then((m) => m.MarksPhotoPanel));
