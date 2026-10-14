import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  root: path.resolve(__dirname), publicDir: path.resolve(__dirname, "../../public"),
  define: { "process.env.NEXT_PUBLIC_SCHOOL_NAME": JSON.stringify("OPS Synthetic School") },
  resolve: { alias: {
    "@/app/(app)/accounts/books/actions": path.resolve(__dirname, "actions.ts"),
    "@/app/(app)/accounts/actions": path.resolve(__dirname, "actions.ts"),
    "@/app/login/actions": path.resolve(__dirname, "actions.ts"),
    "@/app/(app)/preferences/actions": path.resolve(__dirname, "actions.ts"),
    "@": path.resolve(__dirname, "../../src"),
    "next/navigation": path.resolve(__dirname, "../mobile-ui/navigation.ts"),
    "next/link": path.resolve(__dirname, "../mobile-ui/link.tsx"),
  } }, server: { host: "127.0.0.1", port: 3207, strictPort: true },
});
