import { createRoot } from "react-dom/client";
import { LoginForm } from "@/app/login/login-form";
import { LoginScreen } from "@/app/login/login-screen";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

const params = new URLSearchParams(location.search);
const asked = params.get("lang");
const language = asked === "hi" ? "hi" : asked === "both" ? "both" : "en";
// `?code=1`: the WhatsApp code sign-in, as the page draws it once it is on for all staff (D-585).
const codeSignIn = params.get("code") === "1" ? "default" : "none";
createRoot(document.getElementById("root")!).render(<LoginScreen language={language}><LoginForm language={language} codeSignIn={codeSignIn} /></LoginScreen>);
