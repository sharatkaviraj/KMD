import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(__dirname),
  cacheDir: path.resolve(__dirname, "../../.next/vite-payment-draft"),
  define: { "process.env": "{}" },
  resolve: { alias: {
    "@/platform/locale/language-provider": path.resolve(__dirname, "payment-draft-language.ts"),
    "next/dynamic": path.resolve(__dirname, "dynamic.tsx"),
    "@": path.resolve(__dirname, "../../src"),
    "next/navigation": path.resolve(__dirname, "../mobile-ui/navigation.ts"),
    "next/link": path.resolve(__dirname, "../mobile-ui/link.tsx"),
  } },
  server: { host: "127.0.0.1", port: 3202, strictPort: true },
});
