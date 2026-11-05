import { createRoot } from "react-dom/client";

import { LanguageProvider } from "@/platform/i18n/use-language";
import { CollectBridge } from "@/vx/screens/collect/collect-bridge";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

// Collect on a synthetic bridge (collect-actions.ts): invented children, nothing posted anywhere.
const params = new URLSearchParams(location.search);
const language = params.get("locale") === "hi" ? "hi" : params.get("locale") === "both" ? "both" : "en";
createRoot(document.getElementById("root")!).render(
  <LanguageProvider language={language}>
    <CollectBridge
      info={{
        kind: "bridge", sessionLabel: "2026-27", today: "2026-11-05", sessionStart: "2026-04-01",
        canPost: params.get("readonly") !== "true", canWaive: params.get("role") !== "collector", canAdjust: false,
        canSplit: true, showRealQr: false, modes: ["cash", "upi", "bank_transfer", "cheque"], staffName: "Synthetic Cashier", userId: "synthetic-user",
      }}
      initialStudentId={null}
    />
  </LanguageProvider>,
);
