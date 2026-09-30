import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Label, Notice } from "@/ui/primitives";

describe("spoken language on the bilingual sign-in", () => {
  it("overrides the fee-layout fallback language on the actual login region", () => {
    const source = readFileSync("src/app/login/page.tsx", "utf8");
    expect(source).toContain('lang={language === "en" ? "en" : "hi"} aria-labelledby="login-heading"');
  });
  it("names the English secondary field label's language explicitly", () => {
    const html = renderToStaticMarkup(<Label htmlFor="email" text={{ hi: "ईमेल", en: "Email" }} language="both" />);
    expect(html).toContain('<span lang="en"');
    expect(html).toContain("ईमेल");
    expect(html).toContain("Email");
  });
  it("marks English secondary notices without changing their live role", () => {
    const html = renderToStaticMarkup(<Notice tone="danger" text={{ hi: "फिर प्रयास करें", en: "Try again" }} language="both" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('<p lang="en"');
  });
  it.each(["en", "hi"] as const)("does not add a secondary label for %s", (language) => {
    const html = renderToStaticMarkup(<Label text={{ hi: "ईमेल", en: "Email" }} language={language} />);
    expect(html).not.toContain('<span lang="en"');
  });
});
