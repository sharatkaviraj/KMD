import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(__dirname),
  publicDir: path.resolve(__dirname, "../../public"),
  resolve: { alias: {
    "@/app/(app)/teach/tasks/actions": path.resolve(__dirname, "../shared/sampark-action-adapters.ts"),
    "@/app/(app)/collection/photos/profile-actions": path.resolve(__dirname, "../shared/sampark-action-adapters.ts"),
    "@/app/(app)/messages/outbox-actions": path.resolve(__dirname, "outbox-actions.ts"),
    "@/vx/screens/family-contact/actions": path.resolve(__dirname, "student-actions.ts"),
    "@/vx/screens/notes/actions": path.resolve(__dirname, "student-actions.ts"),
    // Needs you decides leave in place (21 Oct smoke fixes); the fixture never does.
    "@/app/(app)/timetable/vx-actions": path.resolve(__dirname, "student-actions.ts"),
    "@": path.resolve(__dirname, "../../src"),
    "next/navigation": path.resolve(__dirname, "navigation.ts"),
    "next/link": path.resolve(__dirname, "link.tsx"),
    "next/image": path.resolve(__dirname, "image.tsx"),
  } },
  server: { host: "127.0.0.1", port: 3201, strictPort: true },
});
