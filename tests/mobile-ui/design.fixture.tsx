import { useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { LanguageProvider } from "@/platform/i18n/use-language";
import type { Language } from "@/platform/i18n/language";
import { PageHeader } from "@/ui/page-header-localized";
import { PageHeader as FeePageHeader } from "@/ui/shell/page-header";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Card } from "@/ui/primitives/card";
import { Input } from "@/ui/primitives/input";
import { SelectNative } from "@/ui/primitives/select-native";
import { Section } from "@/ui/primitives/section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/primitives/tabs";
import { SectionCard } from "@/ui/shell/section-card";
import { Panel, PanelRow } from "@/ui/panel";
import { bottomFor, groupsFor, MENU_HOME, MENU_LABEL, type DesignMenu } from "@/vx/nav";
import { VxBottomBar } from "@/vx/shell/bottom-bar";
import { VxSidebar } from "@/vx/shell/sidebar";
import { NavTrail } from "@/vx/ui/back-link";
import { ToastProvider } from "@/vx/ui/overlays";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";

/*
 * The design fidelity fixture: production screens in the production shell,
 * with synthetic records, no database and no sign-in. Each `view` is drawn
 * at 390 and 1440 px and set beside the design's own frame
 * (docs/design-handoff/screenshots) to check that they are the same picture.
 *
 *   npx vite --config tests/mobile-ui/design.vite.config.ts
 *   http://127.0.0.1:3202/design.html?view=classic&path=/substitutions
 */

const params = new URLSearchParams(location.search);
const language: Language = params.get("locale") === "hi" ? "hi" : params.get("locale") === "hi-en" ? "both" : "en";
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");

const allowAll = () => true;
const badges = Promise.resolve({ inbox: 6, notes: 3, dues: 18, books: 2, marks: 4, news: 1 });
const me = { initials: "JS", name: "Janmejay Singh", sub: "Admin · every workspace", href: "/settings", color: "#0B4F79" };

function Shell({ menu, children }: { menu: DesignMenu; children: ReactNode }) {
  const groups = groupsFor(menu, allowAll);
  const tabs = bottomFor(menu, allowAll);
  return (
    <div className="vxt vx-shell">
      <VxSidebar
        groups={groups}
        me={me}
        roleLine={`${MENU_LABEL[menu].en} · 2026–27`}
        home={MENU_HOME[menu]}
        badges={badges}
        teacherSized={menu === "teacher"}
        previewMenus={[]}
        previewing={null}
      />
      <div className="vx-content">
        <main id="vx-main" className="vx-main vx-reset">{children}</main>
      </div>
      <VxBottomBar tabs={tabs} badges={badges} />
    </div>
  );
}

const pair = (en: string, hi: string) => ({ en, hi });

/** An older screen as it is built: this app's PageHeader, a Section, a Panel, the fee kit's controls. */
function Classic() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={pair("Timetable", "समय सारणी")}
        title={pair("Substitutions", "सब्स्टिट्यूशन")}
        description={pair("Who is away today, and who covers each period.", "आज कौन अनुपस्थित है और हर पीरियड कौन लेगा।")}
        language={language}
        action={<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm">Rules</Button><Button size="sm">Save absence</Button></div>}
      />
      <Tabs defaultValue="today">
        <TabsList aria-label="Day"><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="tomorrow">Tomorrow</TabsTrigger><TabsTrigger value="week">This week</TabsTrigger></TabsList>
        <TabsContent value="today" />
      </Tabs>
      <Panel title={pair("Away today", "आज अनुपस्थित")} description={pair("2 teachers · 5 periods to cover", "2 अध्यापक · 5 पीरियड")} language={language} action={<Badge variant="warning">5 open</Badge>}>
        <PanelRow lead="MM" title="Mr. Meena" detail="Physics · full day" trailing={<Button size="sm" variant="soft">Assign</Button>} />
        <PanelRow lead="SK" title="Ms. Kanwar" detail="Science · after lunch" trailing={<Badge variant="success">Covered</Badge>} />
      </Panel>
      <Section title="Arrange cover" description="Pick a free teacher for each period.">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block space-y-1.5"><span className="text-[12px] font-bold text-muted-foreground">Teacher away</span><SelectNative><option>Mr. Meena</option></SelectNative></label>
          <label className="block space-y-1.5"><span className="text-[12px] font-bold text-muted-foreground">Date</span><Input type="date" defaultValue="2026-10-08" /></label>
          <label className="block space-y-1.5"><span className="text-[12px] font-bold text-muted-foreground">Reason</span><Input placeholder="Leave, training…" /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button>Save absence &amp; arrange cover</Button><Button variant="outline">Cancel</Button><Button variant="soft">Suggest teachers</Button><Button variant="ghost">Help</Button><Button variant="destructive">Remove</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="success">Covered</Badge><Badge variant="warning">Open</Badge><Badge variant="danger">Clash</Badge><Badge variant="info">Published</Badge><Badge>Draft</Badge>
        </div>
      </Section>
      <Card className="p-4"><p className="text-sm text-muted-foreground">A plain card from the fee kit.</p></Card>
    </div>
  );
}

/** A fee screen as it is built: the fee kit's PageHeader and SectionCard. */
function ClassicFee() {
  return (
    <div className="space-y-6">
      <FeePageHeader
        eyebrow="Money · Receipts"
        title="Receipts"
        description="Every receipt this session, newest first."
        mobileEyebrow="214 showing"
        actions={<><Button variant="outline" size="sm">Export</Button><Button size="sm">Collect fee</Button></>}
      />
      <SectionCard title="Today" description="14 receipts · ₹38,400">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="py-2">Receipt</th><th>Student</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {[["R-1041", "Aarav Sharma · Class 7", "₹4,200"], ["R-1040", "Riya Saini · Class 6", "₹2,500"], ["R-1039", "Kunal Verma · Class 4", "₹6,000"]].map(([r, s, a]) => (
              <tr key={r} className="border-t border-border"><td className="py-2.5 font-medium">{r}</td><td>{s}</td><td className="text-right tabular-nums">{a}</td></tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}

/**
 * Each module adds its screens in its own file, `design/<module>.fixture.tsx`,
 * exporting `views`: one entry per design frame, keyed by the frame's name
 * (`F06-Student360`, `DX-Fees-Receipt`), so the views and the frames line up.
 */
export type DesignView = {
  render: () => ReactNode;
  /** Whose menu the shell draws. Default admin. */
  menu?: DesignMenu;
  /** The route the sidebar and bottom bar treat as current. */
  path?: string;
  /** Draw without the shell (sign-in, public links). */
  bare?: boolean;
};

// Typed by hand: the repo's tsconfig does not load Vite's client types.
const MODULES = import.meta.glob("./design/*.fixture.tsx", { eager: true }) as unknown as Record<string, { views: Record<string, DesignView> }>;

const VIEWS: Record<string, DesignView> = {
  classic: { render: () => <Classic />, path: "/timetable" },
  "classic-fee": { render: () => <ClassicFee />, path: "/receipts" },
  ...Object.assign({}, ...Object.values(MODULES).map((m) => m.views)),
};

// A view names the route it stands for; the stubbed router reads it from `?path=`.
{
  const initial = VIEWS[params.get("view") ?? "classic"];
  if (initial?.path && !params.has("path")) {
    params.set("path", initial.path);
    history.replaceState(null, "", `?${params}`);
  }
}

const subscribe = (fn: () => void) => {
  window.addEventListener("popstate", fn);
  return () => window.removeEventListener("popstate", fn);
};

function Fixture() {
  useSyncExternalStore(subscribe, () => location.search);
  const name = params.get("view") ?? "classic";
  const view = VIEWS[name];
  if (!view) {
    return <ul>{Object.keys(VIEWS).sort().map((key) => <li key={key}><a href={`?view=${key}`}>{key}</a></li>)}</ul>;
  }
  const menu = (params.get("menu") as DesignMenu | null) ?? view.menu ?? "admin";
  return (
    <LanguageProvider language={language}>
      <ToastProvider>
        <NavTrail />
        {view.bare || params.get("shell") === "0" ? view.render() : <Shell menu={menu}>{view.render()}</Shell>}
      </ToastProvider>
    </LanguageProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
