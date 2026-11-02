import { createRoot } from "react-dom/client";
import { LoginForm } from "@/app/login/login-form";
import { LoginScreen } from "@/app/login/login-screen";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

const language = new URLSearchParams(location.search).get("lang") === "hi" ? "hi" : "en";
createRoot(document.getElementById("root")!).render(<LoginScreen language={language}><LoginForm language={language} /></LoginScreen>);
