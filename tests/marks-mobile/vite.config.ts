import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  root: path.resolve(__dirname),
  publicDir: path.resolve(__dirname, "../../public"),
  // VX uses plain CSS here; this fixture does not compile Tailwind utilities.
  css: { postcss: { plugins: [] } },
  resolve: { alias: {
    "@": path.resolve(__dirname, "../../src"),
    "next/navigation": path.resolve(__dirname, "../mobile-ui/navigation.ts"),
    "next/link": path.resolve(__dirname, "../mobile-ui/link.tsx"),
    "next/image": path.resolve(__dirname, "../mobile-ui/image.tsx"),
  } },
  server: { host: "127.0.0.1", port: 3206, strictPort: true },
});
