import { createRoot } from "react-dom/client";
import { PaymentDesk } from "@/vx/screens/payments/desk";
import { ToastProvider } from "@/vx/ui/overlays";
import { boot, student } from "./vx-actions";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";
const id = new URLSearchParams(location.search).get("student") ?? "a";
createRoot(document.getElementById("root")!).render(<>
  <div className="vx" style={{ width: "100%", minHeight: "100dvh", containerType: "inline-size", containerName: "vx", paddingBottom: 76 }}>
    <ToastProvider><PaymentDesk boot={boot} previewing={false} initialStudentId={id} initialStudent={{ ok: true, student: student(id) }} initialReceipt={null} /></ToastProvider>
  </div><div id="vx-layer" className="vxt" />
</>);
