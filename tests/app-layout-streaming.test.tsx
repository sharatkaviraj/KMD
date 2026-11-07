import { Suspense, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const state=vi.hoisted(()=>({health:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/vx/view-as",()=>({getViewer:async()=>({staff:{id:"synthetic-admin",role:"admin",language:"en"},previewing:null}),PREVIEW_ROLE:{},previewPermissions:async()=>new Set()}));
vi.mock("@/platform/auth/permissions",()=>({can:()=>true}));
vi.mock("@/platform/auth/test-session-policy",()=>({canSwitchSessions:()=>true,isTestSessionLabel:()=>false}));
vi.mock("@/platform/deployment/confinement",()=>({isConfinedDeployment:()=>false}));
vi.mock("@/platform/deployment/marker",()=>({readDeploymentEnvironment:async()=>"production"}));
vi.mock("@/platform/env",()=>({getAppMode:()=>"live"}));
vi.mock("@/modules/academics/data/academics-repo",()=>({resolveSessionLabel:async()=>"2026-27"}));
vi.mock("@/modules/fees/platform/session-context/cookie",()=>({getViewSessionCookie:async()=>"2026-27"}));
vi.mock("@/modules/fees/platform/session-context/resolver",()=>({resolveViewSession:async()=>({sessionLabel:"2026-27",isTest:false})}));
vi.mock("@/modules/fees/platform/session-context/switcher",()=>({getSessionSwitcherData:async()=>({activeSessionLabel:"2026-27",availableSessions:[]})}));
vi.mock("@/platform/fees-bridge/policy",()=>({usesCanonicalFees:()=>true}));
vi.mock("@/platform/fees-bridge/state",()=>({readFeesBridgeHealth:state.health}));
vi.mock("@/platform/i18n/use-language",()=>({LanguageProvider:()=>null}));
vi.mock("@/vx/shell/shell",()=>({VxShell:()=>null}));
vi.mock("@/modules/performance/ui/performance-reporter",()=>({PerformanceReporter:()=>null}));
// The roster card's refresh button refreshes through the app router, which a bare server render does not mount.
vi.mock("next/navigation",async(importOriginal)=>({...(await importOriginal<typeof import("next/navigation")>()),useRouter:()=>({refresh:()=>{}})}));

import AppLayout from "@/app/(app)/layout";

it("returns the authenticated shell with bridge status behind Suspense",async()=>{
  let finish!:(health:{state:null;status:"error"})=>void;
  state.health.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  let resolved=false;
  const pending=AppLayout({params:Promise.resolve({}),children:<main>Synthetic page</main>}).then(result=>{resolved=true;return result;});
  try {
    await vi.waitFor(()=>expect(resolved).toBe(true),{timeout:100});
    const result=await pending;
    const shell=result.props.children;
    const boundary=shell.props.rosterStatus as ReactElement<{children:ReactElement<{language:"en"}>}>;
    expect(boundary.type).toBe(Suspense);
    const renderStatus=boundary.props.children.type as (props:{language:"en"})=>Promise<ReactElement>;
    const status=renderStatus(boundary.props.children.props);
    finish({state:null,status:"error"});
    expect(renderToStaticMarkup(await status)).toContain('role="status"');
  } finally {finish({state:null,status:"error"});await pending;}
});
