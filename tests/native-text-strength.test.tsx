import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

import { PageHeader } from "../src/ui/page-header-localized";
import { MetricCard, TaskHero } from "../src/ui/task-hero";
import { DetailList, Field, Label, Notice, Section } from "../src/ui/primitives";
import { Panel, PanelRow } from "../src/ui/panel";

const title = { hi: "परीक्षण शीर्षक", en: "Test title" };
const description = { hi: "परीक्षण विवरण", en: "Test description" };
const error = { hi: "परीक्षण त्रुटि", en: "Test error" };
const action = { hi: "परीक्षण खोलें", en: "Open test" };

function expectFullTextStrength(html: string) {
  expect(html).not.toMatch(/\bopacity-(?:75|80)\b/);
  expect(html).not.toMatch(/text-accent-soft-foreground\/(?:75|80|90)/);
}

function expectBoth(html: string, text: { hi: string; en: string }) {
  expect(html).toContain(text.hi);
  expect(html).toContain(text.en);
}

describe("native essential text keeps full token contrast", () => {
  it("keeps both PageHeader title and description readable without opacity", () => {
    const html = renderToStaticMarkup(<PageHeader eyebrow={title} title={title} description={description} language="both" />);
    expectBoth(html, title);
    expectBoth(html, description);
    expectFullTextStrength(html);
    expect(html).not.toContain("text-subtle-foreground");
  });

  it("keeps TaskHero bilingual title and accent copy at full strength", () => {
    const html = renderToStaticMarkup(<TaskHero eyebrow={description} title={title} detail={description} href="/teach" action={action} language="both" />);
    expectBoth(html, title);
    expectBoth(html, description);
    expectFullTextStrength(html);
    expect(html).toContain("text-accent-soft-foreground");
    expect(html).toContain('href="/teach"');
  });

  it("keeps MetricCard context readable without changing its figure or destination", () => {
    const html = renderToStaticMarkup(<MetricCard label={title} detail={description} value="12" href="/teach" language="en" />);
    expect(html).toContain("Test description");
    expect(html).toContain("text-[12px] leading-4 text-muted-foreground");
    expect(html).toContain(">12</p>");
    expect(html).toContain('href="/teach"');
  });

  it("keeps Section and Panel bilingual headings and explanations intact", () => {
    for (const html of [
      renderToStaticMarkup(<Section title={title} description={description} language="both"><p>Content</p></Section>),
      renderToStaticMarkup(<Panel title={title} description={description} language="both"><PanelRow title="Test row" detail="Test row context" /></Panel>),
    ]) {
      expectBoth(html, title);
      expectBoth(html, description);
      expectFullTextStrength(html);
      expect(html).not.toContain("text-subtle-foreground");
    }
  });

  it("preserves bilingual labels, errors, notices and detail labels", () => {
    const samples = [
      [renderToStaticMarkup(<Label htmlFor="test-input" text={title} language="both" />), title],
      [renderToStaticMarkup(<Field label={title} htmlFor="test-input" error={error} language="both"><input id="test-input" /></Field>), error],
      [renderToStaticMarkup(<Notice tone="danger" text={error} language="both" />), error],
      [renderToStaticMarkup(<DetailList items={[{ label: title, value: "Synthetic value" }]} language="both" />), title],
    ] as const;
    for (const [html, pair] of samples) {
      expectBoth(html, pair);
      expectFullTextStrength(html);
    }
  });

  it("leaves disabled controls and decorative border alpha unchanged", () => {
    const primitives = readFileSync(new URL("../src/ui/primitives/index.tsx", import.meta.url), "utf8");
    const hero = readFileSync(new URL("../src/ui/task-hero.tsx", import.meta.url), "utf8");
    expect(primitives).toContain("disabled:opacity-60 disabled:bg-surface-2");
    expect(hero).toContain("border-accent/25 bg-accent-soft");
    expect(primitives).not.toMatch(/\bopacity-(?:75|80)\b/);
  });
});
