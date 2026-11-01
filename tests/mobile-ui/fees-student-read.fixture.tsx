import {createRoot} from "react-dom/client";
import {LanguageProvider} from "@/platform/i18n/use-language";
import {Student360,type Student360Props} from "@/vx/screens/admin/student360";
import {moneyFromInstallments,installmentState} from "@/vx/screens/admin/logic";
import {feesFromBridge} from "@/modules/students-fees/vx/canonical-students";
import {oneStudentReadPermissions,restrictStudentWorkspace} from "@/platform/fees-bridge/read-permissions";
import type {CurrentStaff} from "@/platform/auth/current-staff";
import {bridgeWorkspaceFixture} from "../fixtures/bridge-student-workspace";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";
const params=new URLSearchParams(location.search),role=params.get("role")==="office"?"office":"admin";
const language=params.get("locale")==="hi"?"hi":params.get("locale")==="both"?"both":"en";
const staff:CurrentStaff={id:"synthetic",userId:"synthetic",role,isActive:true,permissions:["students:view","fees:view"],email:"synthetic@example.invalid",displayName:"Synthetic Staff",shortName:"Synthetic",isTeaching:false,language,preferredStart:null};
const source=restrictStudentWorkspace(bridgeWorkspaceFixture(),oneStudentReadPermissions(staff));
const fees=feesFromBridge(source)!;
const p:Student360Props={
  id:source.studentId,name:source.student.fullName,classLabel:source.student.classLabel,sr:source.student.admissionNo,rollNo:source.student.rollNo,status:source.student.status,
  father:source.student.fatherName,mother:source.student.motherName,phone:null,address:source.student.address,dob:source.student.dateOfBirth,joined:source.student.joinedOn,route:source.student.transportRouteLabel,
  source,sourceExpected:true,photoUrl:"/synthetic-student-photo.png",tab:"fees",tabs:["fees","family","info"],
  money:moneyFromInstallments(fees.installments,source.asOfDate),feeSummary:fees.summary,feeBreakup:fees.breakup,feeSession:source.sessionLabel,
  installments:fees.installments.map(row=>({id:row.installmentId,label:row.installmentLabel,dueDate:row.dueDate,state:installmentState(row,source.asOfDate),status:row.balanceStatus,pending:row.pendingAmount,settled:row.feeSettledAmount,paid:row.settledAmount,receiptedHere:row.appliedAmount+row.discountCloseoutAmount,adjusted:row.adjustmentAmount,base:row.baseCharge,lateFee:row.finalLateFee,lateFeeWaived:row.waiverApplied,lateFeePending:row.lateFeePending,carry:row.isCarryForward})),
  receipts:fees.receipts,family:fees.family.map(row=>({id:row.id,name:row.fullName,sr:row.admissionNo,classLabel:row.classLabel,self:row.isSelf,total:row.totalDue,paid:row.totalPaid,remaining:row.outstanding})),
  attendance:{percent:null,counted:0,counts:{present:0,absent:0,half_day:0,late:0,leave:0},weeks:[]},terms:[],documents:[],notes:[],history:[],today:source.asOfDate,canCollect:false,canManageDocuments:false,canManageFees:false,canAddNote:false,contacts:null,
};
createRoot(document.getElementById("root")!).render(<LanguageProvider language={language}><Student360 p={p}/></LanguageProvider>);
