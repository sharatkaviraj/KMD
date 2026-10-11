import path from "node:path";
import { defineConfig } from "vite";
export default defineConfig({
  root: path.resolve(__dirname), publicDir: path.resolve(__dirname, "../../public"),
  resolve: { alias: {
    "@/app/(app)/fees/students/actions": path.resolve(__dirname, "../operations-admin/student-actions.ts"),
    "@": path.resolve(__dirname, "../../src"),
    "next/navigation": path.resolve(__dirname, "../operations-admin/navigation.ts"),
    "next/link": path.resolve(__dirname, "../operations-admin/link.tsx"),
    "next/image": path.resolve(__dirname, "../mobile-ui/image.tsx"),
  } }, server: { host: "127.0.0.1", port: 3214, strictPort: true },
});
