import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  root: path.resolve(__dirname), publicDir: path.resolve(__dirname, "../../public"),
  resolve: { alias: {
    "@/app/(app)/exam-office/board/actions": path.resolve(__dirname, "actions.ts"),
    "@/app/(app)/school-office/returns/actions": path.resolve(__dirname, "actions.ts"),
    "@/app/(app)/school-office/actions": path.resolve(__dirname, "actions.ts"),
    "next/navigation": path.resolve(__dirname, "navigation.ts"),
    "next/link": path.resolve(__dirname, "../mobile-ui/link.tsx"),
    "@": path.resolve(__dirname, "../../src"),
  } }, server: { host: "127.0.0.1", port: 3216, strictPort: true },
});
