import {fileURLToPath} from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: __dirname, envDir: path.resolve(__dirname, "empty-env"),
  publicDir: path.resolve(__dirname, "../../public"), cacheDir: path.resolve(__dirname, "../../.test-artifacts/profile-photos-vite"),
  define: { "process.env": "{}" },
  resolve: { alias: {
    "@/app/(app)/collection/photos/profile-actions": path.resolve(__dirname, "actions.ts"),
    "next/navigation": path.resolve(__dirname, "../mobile-ui/navigation.ts"),
    "@": path.resolve(__dirname, "../../src"),
  } },
  server: { host: "127.0.0.1", port: 3228, strictPort: true },
});
