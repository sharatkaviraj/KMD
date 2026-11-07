// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({replace:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({replace:state.replace,push:vi.fn()})}));
vi.mock("next/link",()=>({useLinkStatus:()=>({pending:false}),default:({children,href}:React.ComponentProps<"a">)=><a href={href}>{children}</a>}));
vi.mock("@/vx/i18n",()=>({useVx:()=>({language:"en",tx:(pair:{en:string})=>pair.en})}));
vi.mock("@/vx/shell/top-actions",()=>({NewMenu:()=>null,SearchTrigger:()=>null}));
vi.mock("@/vx/ui/overlays",()=>({useToast:()=>({show:vi.fn()}),Sheet:()=>null}));
vi.mock("@/modules/teacher-tasks/ui/assignment-sheet",()=>({AssignmentLauncher:()=>null}));
import { StudentsScreen,type StudentsProps } from "@/vx/screens/admin/students";

it("preserves newer typing and class order when search results shrink to one page",async()=>{
  vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const props:StudentsProps={session:"QA",rows:[],total:100,window:{page:1,pages:2,firstRow:1,lastRow:50},q:"",classId:null,view:"school",seg:"all",classes:[],counts:null,seesMoney:false,attendanceRead:true,viewKey:"synthetic",canCollect:false,canAdmit:false,canRemind:false,failed:false,sort:{key:"class",dir:1}};
  async function type(value:string){await act(async()=>{const input=host.querySelector<HTMLInputElement>("#stu-q-m")!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
  try {
    await act(async()=>root.render(<StudentsScreen {...props}/>));await type("A");await act(async()=>{vi.advanceTimersByTime(250);});
    await type("Aarav");
    await act(async()=>root.render(<StudentsScreen {...props} q="A" total={1} window={{page:1,pages:1,firstRow:1,lastRow:1}}/>));
    expect(host.querySelector<HTMLInputElement>("#stu-q-m")!.value).toBe("Aarav");
    await act(async()=>{vi.advanceTimersByTime(250);});expect(state.replace).toHaveBeenCalledTimes(2);
    const params=new URL(state.replace.mock.calls[1][0],"https://one.invalid").searchParams;
    expect(params.get("q")).toBe("Aarav");expect(params.get("sort")).toBe("class");
  } finally {await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();}
});
