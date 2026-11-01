import {existsSync,readdirSync} from "node:fs";
import path from "node:path";
import {describe,it,expect} from "vitest";
import {FEES_ROUTE_TEMPLATES,isExistingFeesPath} from "@/platform/fees-bridge/routes";
import {delegatedFeesPath} from "@/platform/fees-bridge/policy";

function routes(dir:string,prefix=""):string[]{
  return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?routes(path.join(dir,entry.name),`${prefix}/${entry.name}`):entry.name==="page.tsx"||entry.name==="route.ts"?[prefix]:[]);
}
const source=path.resolve(process.cwd(),"../schoolfees-coexistence/src/app/protected");
describe("financial navigation coverage",()=>{
  it("has a reviewed source destination for every ported One page/handler",()=>{
    for(const route of routes(path.join(process.cwd(),"src/app/(app)/fees"))){
      const example=route.replace(/\[[^\]]+\]/g,"synthetic-id");
      const destination=delegatedFeesPath(`/fees${example}`)!;
      expect(isExistingFeesPath(destination),route).toBe(true);
      expect(destination,route).toBe(route?`/protected${example}`:"/protected/dashboard");
    }
  });
  it.skipIf(!existsSync(source))("matches the actual current Fees source tree",()=>{
    const actual=new Set(routes(source).map(route=>`/protected${route}`));
    for(const route of FEES_ROUTE_TEMPLATES)expect(actual.has(route),route).toBe(true);
  });
  it("preserves One academics, enquiries and account home",()=>{
    for(const route of ["/accounts","/admissions","/admissions/seats","/assessments","/exams","/students","/attendance"]){expect(delegatedFeesPath(route),route).toBeNull();}
    expect(delegatedFeesPath("/admissions/new")).toBe("/protected/students/new");
    expect(delegatedFeesPath("/fees/unknown-new-screen")).toBe("/protected/dashboard");
  });
});
