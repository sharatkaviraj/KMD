import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // Next inlines these in production; fixtures never inherit machine secrets.
  define: { "process.env": {} },
  root: path.resolve(__dirname),
  publicDir: path.resolve(__dirname, "../../public"),
  resolve: { alias: {
    "@/vx/screens/admin/student-document-actions": path.resolve(__dirname, "student-actions.ts"),
    "@/app/(app)/school-office/actions": path.resolve(__dirname, "../shared/school-office-action-adapters.ts"),
    "@/app/(app)/payments/bridge-actions": path.resolve(__dirname, "fees-bridge-actions.ts"),
    // Collect on a synthetic bridge: invented children, nothing posted (collect.html).
    "@/app/(app)/payments/collect-actions": path.resolve(__dirname, "collect-actions.ts"),
    "@/app/(app)/receipts/office-command-actions": path.resolve(__dirname, "office-command-actions.ts"),
    "@/app/(app)/teach/tasks/actions": path.resolve(__dirname, "../shared/sampark-action-adapters.ts"),
    "@/app/(app)/collection/photos/profile-actions": path.resolve(__dirname, "../shared/sampark-action-adapters.ts"),
    "@/app/(app)/messages/outbox-actions": path.resolve(__dirname, "outbox-actions.ts"),
    "@/vx/screens/family-contact/actions": path.resolve(__dirname, "student-actions.ts"),
    "@/vx/screens/notes/actions": path.resolve(__dirname, "student-actions.ts"),
    // Needs you decides leave in place (21 Oct smoke fixes); the fixture never does.
    "@/app/(app)/timetable/vx-actions": path.resolve(__dirname, "student-actions.ts"),
    // The guided cover flow (review C01): synthetic preview/confirm/check, nothing saved or sent.
    "@/app/(app)/substitutions/guided-actions": path.resolve(__dirname, "guided-cover-actions.ts"),
    "@": path.resolve(__dirname, "../../src"),
    "next/navigation": path.resolve(__dirname, "navigation.ts"),
    "next/link": path.resolve(__dirname, "link.tsx"),
    "next/image": path.resolve(__dirname, "image.tsx"),
  } },
  server: { host: "127.0.0.1", port: 3201, strictPort: true },
});
