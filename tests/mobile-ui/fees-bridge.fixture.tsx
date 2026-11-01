import {createRoot} from "react-dom/client";
import {LiveFeesDesk} from "@/vx/screens/payments/live-fees-desk";
import {student} from "./fees-bridge-actions";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";
const params=new URLSearchParams(location.search);
const language=params.get("locale")==="hi"?"hi":params.get("locale")==="both"?"both":"en";
createRoot(document.getElementById("root")!).render(<LiveFeesDesk language={language} sessionLabel="2026-27" today="2026-11-01" canPost={params.get("readonly")!=="true"} canWaive canDiscount userId="synthetic-mobile-user" initialStudents={[student]} initialStudentId={student.id} initialCursor={null} initialError={null}/>);
