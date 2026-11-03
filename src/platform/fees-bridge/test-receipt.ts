import "server-only";
import { getOptionalEnvVar, getServerSupabaseUrl } from "@/platform/env";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";

type Verification = {state:"invalid"}|{state:"unverifiable";receiptNumber:string}|{
  state:"valid"|"reversed";receiptNumber:string;paymentDate:string;totalAmount:number;
};

/** Public, minimal verification of One's isolated TEST receipts only. */
export async function verifyOneTestReceipt(receiptNumber:string):Promise<Verification> {
  if(!/^TST[-/][\w/-]{1,60}$/.test(receiptNumber))return {state:"invalid"};
  const key=getOptionalEnvVar("SUPABASE_SERVICE_ROLE_KEY");
  if(!key)return {state:"unverifiable",receiptNumber};
  const read=async(table:"receipts"|"v_receipt_reversal_totals",params:Record<string,string>)=>{
    const url=new URL(`/rest/v1/${table}`,getServerSupabaseUrl());
    url.search=new URLSearchParams(params).toString();
    const response=await fetch(url,{headers:{apikey:key,Authorization:`Bearer ${key}`,"Accept-Profile":"public"},cache:"no-store",redirect:"error"});
    if(!response.ok)throw new Error("Receipt verification unavailable.");
    const data:unknown=await response.json();
    if(!Array.isArray(data))throw new Error("Receipt verification unavailable.");
    return data;
  };
  try{
    const rows=await read("receipts",{select:"id,receipt_number,payment_date,total_amount,student:students!receipts_student_id_fkey!inner(class:classes!students_class_id_fkey!inner(session_label))",receipt_number:`eq.${receiptNumber}`,limit:"1"});
    const row=rows[0];
    if(!row || !isTestSessionLabel(row.student?.class?.session_label))return {state:"invalid"};
    if(typeof row.id!=="string" || !/^[0-9a-f-]{36}$/i.test(row.id) || row.receipt_number!==receiptNumber || typeof row.payment_date!=="string" || !Number.isFinite(Number(row.total_amount)))return {state:"unverifiable",receiptNumber};
    const totals=await read("v_receipt_reversal_totals",{select:"receipt_id,reversed_amount",receipt_id:`eq.${row.id}`});
    const reversed=totals.length===0?0:Number(totals[0]?.reversed_amount);
    if(!Number.isFinite(reversed))return {state:"unverifiable",receiptNumber};
    const totalAmount=Number(row.total_amount);
    return {state:totalAmount>0 && reversed>=totalAmount?"reversed":"valid",receiptNumber,paymentDate:row.payment_date,totalAmount};
  }catch{return {state:"unverifiable",receiptNumber};}
}
