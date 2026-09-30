import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(__dirname),
  resolve: { alias: {
    "@": path.resolve(__dirname, "../../src"),
    "next/navigation": path.resolve(__dirname, "navigation.ts"),
    "next/link": path.resolve(__dirname, "link.tsx"),
  } },
  server: { host: "127.0.0.1", port: 3201, strictPort: true },
});
