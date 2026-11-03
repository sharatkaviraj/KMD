import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({ root: path.resolve(__dirname), publicDir: path.resolve(__dirname, "../../public"), define: { "process.env": JSON.stringify({ NEXT_PUBLIC_SCHOOL_NAME: "Synthetic Test School" }) }, resolve: { alias: {
  "@/app/(app)/payments/actions": path.resolve(__dirname, "actions.ts"),
  "@": path.resolve(__dirname, "../../src"),
  // The school logo (Crest) uses next/image; fixtures serve public files directly, production uses Next's optimizer.
  "next/image": path.resolve(__dirname, "../mobile-ui/image.tsx"),
  "next/link": path.resolve(__dirname, "../mobile-ui/link.tsx"),
  "next/navigation": path.resolve(__dirname, "../mobile-ui/navigation.ts"),
} }, server: { host: "127.0.0.1", port: 3212, strictPort: true } });
