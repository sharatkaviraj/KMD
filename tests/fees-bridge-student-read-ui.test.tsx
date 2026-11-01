import * as React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it,vi} from "vitest";
import {bridgeWorkspaceFixture} from "./fixtures/bridge-student-workspace";
vi.mock("next/link",()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
vi.mock("@/vx/i18n",()=>({useVx:()=>({tx:(value:{en:string})=>value.en})}));
import {SourceStudentInfo,SourceFeeDetails,SourceFamilyHistory,SourcePages} from "@/vx/screens/admin/student360-source";
describe("native student source read views",()=>{
  it("shows complete school/identity/contact fields for departed students and escapes saved notes",()=>{
    const source=bridgeWorkspaceFixture();source.student.status="left";source.student.leftOn="2026-10-31";source.student.notes="<script>synthetic</script>";
    const html=renderToStaticMarkup(<SourceStudentInfo source={source}/>);
    for(const value of ["SYN-APAAR","SYN-JAN","SYN-TC","SYN-BOARD","Synthetic Emergency","Synthetic Guardian","Synthetic District","left","31 Oct 2026"])expect(html).toContain(value);
    expect(html).toContain("&lt;script&gt;synthetic&lt;/script&gt;");expect(html).not.toContain("<script>");
  });
  it("keeps every history page in pagination links so changing receipt page does not reset other sections",()=>{
    const source=bridgeWorkspaceFixture();source.pagination.receipts={page:2,pageSize:40,totalCount:99,hasMore:true};source.pagination.ledgerPayments!.page=3;source.pagination.financeHistory!.page=4;source.history.contacts!.pagination.page=5;
    const html=renderToStaticMarkup(<SourcePages source={source} section="receipts"/>);
    expect(html).toContain("receiptsPage=3");expect(html).toContain("ledgerPage=3");expect(html).toContain("financePage=4");expect(html).toContain("contactsPage=5");expect(html).toContain("99 records");
  });
  it("displays no active EMI explicitly while retaining the saved earlier plans and corrections",()=>{
    const source=bridgeWorkspaceFixture();source.repaymentPlan=null;
    const html=renderToStaticMarkup(<SourceFeeDetails source={source}/>);
    expect(html).toContain('data-student-source-section="emi"');expect(html).toContain("No active EMI plan.");expect(html).toContain("Synthetic replaced plan");expect(html).toContain("Synthetic correction");expect(html).toContain("Synthetic charge");
  });
  it("shows contact and delivery histories without introducing send or call actions",()=>{
    const html=renderToStaticMarkup(<SourceFamilyHistory source={bridgeWorkspaceFixture()}/>);
    expect(html).toContain("Synthetic contact note");expect(html).toContain("Synthetic delivery note");expect(html).toContain("Promises kept");expect(html).not.toContain("<button");expect(html).not.toContain("wa.me");expect(html).not.toContain("tel:");
  });
});
