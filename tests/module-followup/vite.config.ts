import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  root: path.resolve(__dirname), publicDir: path.resolve(__dirname, "../../public"),
  resolve: { alias: {
    "@/vx/screens/family-contact/actions": path.resolve(__dirname, "contact-actions.ts"),
    "@/app/login/actions": path.resolve(__dirname, "../accountant-mobile/actions.ts"),
    "@": path.resolve(__dirname, "../../src"),
    "next/navigation": path.resolve(__dirname, "../mobile-ui/navigation.ts"),
    "next/link": path.resolve(__dirname, "../mobile-ui/link.tsx"),
  } }, server: { host: "127.0.0.1", port: 3211, strictPort: true },
});
