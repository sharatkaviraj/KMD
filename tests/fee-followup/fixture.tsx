import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { ToastProvider } from "@/vx/ui/overlays";
import { PaymentDesk } from "@/vx/screens/payments/desk";
import { boot, student } from "./actions";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

createRoot(document.getElementById("root")!).render(<LanguageProvider language="en"><ToastProvider><PaymentDesk boot={boot} previewing={false} initialStudentId={student().id} initialStudent={{ ok: true, student: student() }} initialReceipt={null} /></ToastProvider></LanguageProvider>);
