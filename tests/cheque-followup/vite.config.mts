import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root, publicDir: path.join(root, "../../public"),
  define: { "process.env.NEXT_PUBLIC_SCHOOL_NAME": JSON.stringify("OPS Synthetic School") },
  resolve: { alias: {
    "@/app/(app)/accounts/books/actions": path.join(root, "actions.ts"),
    "@/app/(app)/accounts/actions": path.join(root, "../accountant-mobile/actions.ts"),
    "@/app/login/actions": path.join(root, "../accountant-mobile/actions.ts"),
    "@": path.join(root, "../../src"),
    "next/navigation": path.join(root, "../mobile-ui/navigation.ts"),
    "next/link": path.join(root, "../mobile-ui/link.tsx"),
  } }, server: { host: "127.0.0.1", port: 3221, strictPort: true },
});
