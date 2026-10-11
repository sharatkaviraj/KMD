import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({ root: path.resolve(__dirname), publicDir: false, resolve: { alias: { "@/app/(app)/timetable/vx-actions": path.resolve(__dirname, "actions.ts"), "@": path.resolve(__dirname, "../../src"), "next/navigation": path.resolve(__dirname, "navigation.ts"), "next/link": path.resolve(__dirname, "link.tsx") } }, server: { host: "127.0.0.1", port: 3203, strictPort: true } });
