import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(__dirname, "../../public"),
  define: { "process.env": "{}" },
  resolve: { alias: {
    "@/app/login/actions": path.resolve(__dirname, "actions.ts"),
    "@": path.resolve(__dirname, "../../src"),
    "next/navigation": path.resolve(__dirname, "../mobile-ui/navigation.ts"),
    "next/link": path.resolve(__dirname, "../mobile-ui/link.tsx"),
  } },
  server: { host: "127.0.0.1", port: 3226, strictPort: true },
});
