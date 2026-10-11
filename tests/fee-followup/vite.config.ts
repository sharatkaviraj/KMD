import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({ root: path.resolve(__dirname), publicDir: path.resolve(__dirname, "../../public"), cacheDir: path.resolve(__dirname, "../../.next/vite-fee-followup"), build: { outDir: path.resolve(__dirname, "../../.test-artifacts/fee-followup/build"), emptyOutDir: true }, define: { "process.env": "{}" }, resolve: { alias: {
  "@/app/(app)/payments/actions": path.resolve(__dirname, "actions.ts"),
  "@": path.resolve(__dirname, "../../src"),
  "next/link": path.resolve(__dirname, "../mobile-ui/link.tsx"),
  "next/navigation": path.resolve(__dirname, "../mobile-ui/navigation.ts"),
} }, server: { host: "127.0.0.1", port: 3232, strictPort: true } });
