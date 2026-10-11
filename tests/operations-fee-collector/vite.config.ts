import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  root: path.resolve(__dirname), publicDir: path.resolve(__dirname, "../../public"), cacheDir: path.resolve(__dirname, "../../.next/vite-ops-fee"), define: { "process.env": "{}" },
  resolve: { alias: {
    "@/app/(app)/payments/actions": path.resolve(__dirname, "vx-actions.ts"),
    "@/platform/i18n/use-language": path.resolve(__dirname, "vx-language.ts"),
    "@/platform/locale/language-provider": path.resolve(__dirname, "../payment-draft-ui/payment-draft-language.ts"),
    "next/dynamic": path.resolve(__dirname, "../payment-draft-ui/dynamic.tsx"),
    "@": path.resolve(__dirname, "../../src"),
    "next/navigation": path.resolve(__dirname, "../mobile-ui/navigation.ts"),
    "next/link": path.resolve(__dirname, "../mobile-ui/link.tsx"),
    "next/image": path.resolve(__dirname, "../mobile-ui/image.tsx"),
  } }, server: { host: "127.0.0.1", port: 3224, strictPort: true },
});
