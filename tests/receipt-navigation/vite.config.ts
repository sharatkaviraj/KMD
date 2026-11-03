import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({ root: __dirname, publicDir: path.resolve(__dirname, "../../public"), define: { "process.env": "{}" }, resolve: { alias: {
  "@/app/(app)/receipts/actions": path.resolve(__dirname, "actions.ts"),
  "@": path.resolve(__dirname, "../../src"),
  // The school logo (Crest) uses next/image; fixtures serve public files directly, production uses Next's optimizer.
  "next/image": path.resolve(__dirname, "../mobile-ui/image.tsx"),
  "next/link": path.resolve(__dirname, "link.tsx"),
  "next/navigation": path.resolve(__dirname, "../mobile-ui/navigation.ts"),
} }, server: { host: "127.0.0.1", port: 3228, strictPort: true } });
