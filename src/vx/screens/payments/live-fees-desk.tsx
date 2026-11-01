"use client";

import { useEffect, useState, useTransition } from "react";
import { ms } from "@/messages/setup";
import { flat, type Language } from "@/platform/i18n/language";
import { FEES_ORIGIN } from "@/platform/fees-bridge/policy";
import type { BridgePostInput, BridgePostedPayment, BridgeQuote, BridgeStudent, BridgeReceipt } from "@/platform/fees-bridge/contracts";
import { postInputSchema } from "@/platform/fees-bridge/contracts";
import { checkBridgePaymentAction, reviewBridgePaymentAction, saveBridgePaymentAction, searchBridgeStudentsAction } from "@/app/(app)/payments/bridge-actions";

const money = (value:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(value);
const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900";
const button = "min-h-11 rounded-lg bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50";

export function officialPrintUrl(raw:string):string|null {
  try {
    const url=new URL(raw,FEES_ORIGIN);
    return url.origin===FEES_ORIGIN && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

export function LiveFeesDesk(props:{
  language:Language;sessionLabel:string;today:string;canPost:boolean;canWaive:boolean;canDiscount:boolean;userId:string;
  initialStudents:BridgeStudent[];initialCursor:string|null;initialStudentId:string|null;initialReceipt?:BridgeReceipt|null;initialError:string|null;
}) {
  const label=(text:Parameters<typeof flat>[0])=>flat(text,props.language);
  const [students,setStudents]=useState(props.initialStudents);
  const [cursor,setCursor]=useState(props.initialCursor);
  const [query,setQuery]=useState("");
  const [studentId,setStudentId]=useState(props.initialStudentId ?? "");
  const [amount,setAmount]=useState("");
  const [date,setDate]=useState(props.today);
  const [discount,setDiscount]=useState("0");
  const [waive,setWaive]=useState(props.canWaive);
  const [mode,setMode]=useState<BridgePostInput["paymentMode"]>("cash");
  const [reference,setReference]=useState("");
  const [remarks,setRemarks]=useState("");
  const [quote,setQuote]=useState<BridgeQuote|null>(null);
  const [command,setCommand]=useState<BridgePostInput|null>(null);
  const [saved,setSaved]=useState<BridgePostedPayment|null>(null);
  const [openedReceipt,setOpenedReceipt]=useState<BridgeReceipt|null>(props.initialReceipt??null);
  const [uncertain,setUncertain]=useState(false);
  const [retryable,setRetryable]=useState(false);
  const [recoveryError,setRecoveryError]=useState(false);
  const [message,setMessage]=useState<string|null>(props.initialError);
  const [pending,startTransition]=useTransition();
  const recoveryKey=`vppsone:fees-command:${props.userId}:${props.sessionLabel}`;
  useEffect(()=>{
    // Restoring a browser-owned pending command after hydration is essential:
    // a reload after a lost response must not generate another payment ID.
    let active=true;
    void Promise.resolve().then(()=>{
      if(!active)return;
      try{
        const raw=sessionStorage.getItem(recoveryKey);
        if(!raw)return;
        const parsed=postInputSchema.safeParse(JSON.parse(raw));
        if(parsed.success && parsed.data.sessionLabel===props.sessionLabel){
          const restored=parsed.data;
          setCommand(restored);setStudentId(restored.studentId);setAmount(String(restored.amount));
          setDate(restored.paymentDate);setDiscount(String(restored.quickDiscountAmount));
          setWaive(restored.lateFeeWaiverAmount>0);setMode(restored.paymentMode);
          setReference(restored.referenceNumber??"");setRemarks(restored.remarks??"");setUncertain(true);
        }
        else{setRecoveryError(true);setMessage(flat(ms.bridgeUnknown,props.language));}
      }catch{setRecoveryError(true);setMessage(flat(ms.bridgeUnavailable,props.language));}
    });
    return()=>{active=false;};
  },[recoveryKey,props.sessionLabel,props.language]);
  const locked=pending || command!==null || recoveryError;
  const feesLink=`${FEES_ORIGIN}/protected/payments?${new URLSearchParams({session:props.sessionLabel,...(studentId?{studentId}:{})})}`;
  const receipt=saved??openedReceipt;

  function changed(){setQuote(null);setMessage(null);}
  function clearRecovery(){try{sessionStorage.removeItem(recoveryKey);}catch{/* The canonical receipt still proves success; a reload safely checks the old ID. */}}
  function search(more=false){startTransition(async()=>{
    try{
      const result=await searchBridgeStudentsAction(props.sessionLabel,query,more?cursor:null);
      if(!result.ok){setMessage(result.message);return;}
      setStudents(more?[...students,...result.data.students]:result.data.students);
      setCursor(result.data.nextCursor);setMessage(null);
    }catch{setMessage(label(ms.bridgeUnavailable));}
  });}
  function review(){startTransition(async()=>{
    try{
      const result=await reviewBridgePaymentAction({studentId,sessionLabel:props.sessionLabel,paymentDate:date,amount:Number(amount),quickDiscountAmount:Number(discount),lateFeeWaiverAmount:0},waive);
      if(!result.ok){setMessage(result.message);setQuote(null);return;}
      setQuote(result.data);setMessage(null);
    }catch{setQuote(null);setMessage(label(ms.bridgeUnavailable));}
  });}
  async function submit(payload:BridgePostInput){
    let result:Awaited<ReturnType<typeof saveBridgePaymentAction>>;
    try{result=await saveBridgePaymentAction(payload);}catch{setUncertain(true);setRetryable(false);setMessage(label(ms.bridgeUnknown));return;}
    if(result.ok){clearRecovery();setSaved(result.data);setUncertain(false);setRetryable(false);setMessage(null);return;}
    setMessage(result.message);
    if(result.uncertain){setUncertain(true);setRetryable(false);return;}
    // A source refusal before commit allows editing/review; transport failures
    // keep the original command locked until its status has been checked.
    clearRecovery();setCommand(null);setQuote(null);setUncertain(false);setRetryable(false);
  }
  function confirm(){if(!quote || locked)return;startTransition(async()=>{
    const payload:BridgePostInput={
      studentId:quote.student.id,sessionLabel:props.sessionLabel,paymentDate:quote.paymentDate,
      amount:quote.amount,quickDiscountAmount:quote.quickDiscountAmount,lateFeeWaiverAmount:quote.lateFeeWaiverAmount,
      quoteHash:quote.quoteHash,commandId:crypto.randomUUID(),paymentMode:mode,referenceNumber:reference.trim()||null,remarks:remarks.trim()||null,
    };
    try{sessionStorage.setItem(recoveryKey,JSON.stringify(payload));}catch{setMessage(label(ms.bridgeUnavailable));return;}
    setCommand(payload);await submit(payload);
  });}
  function check(){if(!command)return;startTransition(async()=>{
    let result:Awaited<ReturnType<typeof checkBridgePaymentAction>>;
    try{result=await checkBridgePaymentAction(command.commandId);}catch{setMessage(label(ms.bridgeUnknown));return;}
    if(!result.ok){setMessage(result.message);return;}
    if(result.data.status==="completed"){clearRecovery();setSaved(result.data);setUncertain(false);setRetryable(false);setMessage(null);}
    else{setRetryable(true);setMessage(label(ms.bridgeNotFound));}
  });}

  return <section className="mx-auto max-w-3xl space-y-5 px-3 py-5 sm:px-6">
    <header><h1 className="text-2xl font-semibold">{label(ms.bridgeTitle)}</h1><p className="mt-2 text-sm text-slate-600">{label(ms.bridgeLedger)}</p><p className="mt-1 text-sm">{props.sessionLabel}</p></header>
    <a className="inline-block font-medium text-blue-700 underline" href={feesLink}>{label(ms.bridgeOpenFees)}</a>
    {!props.canPost && <p className="rounded-lg bg-amber-50 p-3 text-amber-950">{label(ms.bridgeReadOnly)}</p>}
    {message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">{message}</p>}
    {receipt && !uncertain ? <div className="space-y-3 rounded-xl border border-emerald-300 bg-emerald-50 p-5" role="status">
      <h2 className="text-xl font-semibold">{label(saved?ms.bridgeSaved:ms.bridgeReceipt)}</h2>
      <p>{label(ms.bridgeReceipt)}: <strong>{receipt.receiptNumber}</strong></p><p>{money(receipt.amountReceived)}</p>
      {!saved && openedReceipt?.reversed && <p className="font-semibold text-red-700">{label(ms.bridgeReversed)}</p>}
      {saved && <p>{label(ms.bridgeRemaining)}: {money(saved.remainingBalance)}</p>}
      {officialPrintUrl(receipt.printUrl) && <a className="block font-medium underline" href={officialPrintUrl(receipt.printUrl)!} target="_blank" rel="noopener noreferrer">{label(ms.bridgePrint)}</a>}
      <button className={button} onClick={()=>{setSaved(null);setOpenedReceipt(null);setCommand(null);setQuote(null);setAmount("");setReference("");setRemarks("");}}>{label(ms.bridgeNew)}</button>
    </div> : <>
      <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
        <div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-sm">{label(ms.bridgeSearch)}<input className={field} value={query} maxLength={100} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();search();}}}/></label><button className={button} onClick={()=>search()}>{label(ms.bridgeFind)}</button></div>
        <label className="block text-sm">{label(ms.bridgeStudent)}<select className={field} value={studentId} onChange={event=>{setStudentId(event.target.value);changed();}}><option value="">{label(ms.bridgeChoose)}</option>{students.map(student=><option key={student.id} value={student.id}>{student.name} · {student.srNo} · {student.className}</option>)}</select></label>
        {students.length===0 && <p className="text-sm">{label(ms.bridgeNone)}</p>}
        {cursor && <button className="text-blue-700 underline" onClick={()=>search(true)}>{label(ms.bridgeMore)}</button>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">{label(ms.bridgeAmount)}<input className={field} type="number" min="1" max="10000000" step="1" inputMode="numeric" value={amount} onChange={event=>{setAmount(event.target.value);changed();}}/></label>
          <label className="text-sm">{label(ms.bridgeDate)}<input className={field} type="date" value={date} max={props.today} onChange={event=>{setDate(event.target.value);changed();}}/></label>
          <label className="text-sm">{label(ms.bridgeMode)}<select className={field} value={mode} onChange={event=>{setMode(event.target.value as BridgePostInput["paymentMode"]);}}><option value="cash">{label(ms.bridgeCash)}</option><option value="upi">{label(ms.bridgeUpi)}</option><option value="bank_transfer">{label(ms.bridgeBank)}</option><option value="cheque">{label(ms.bridgeCheque)}</option></select></label>
          <label className="text-sm">{label(ms.bridgeReference)}<input className={field} maxLength={200} value={reference} onChange={event=>setReference(event.target.value)}/></label>
          {props.canDiscount && <label className="text-sm">{label(ms.bridgeDiscount)}<input className={field} type="number" min="0" step="1" inputMode="numeric" value={discount} onChange={event=>{setDiscount(event.target.value);changed();}}/></label>}
          {props.canWaive && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={waive} onChange={event=>{setWaive(event.target.checked);changed();}}/>{label(ms.bridgeWaive)}</label>}
        </div>
        <label className="block text-sm">{label(ms.bridgeNotes)}<textarea className={field} maxLength={1000} value={remarks} onChange={event=>setRemarks(event.target.value)}/></label>
        <button className={button} disabled={!studentId || !amount} onClick={review}>{label(ms.bridgeReview)}</button>
      </fieldset>
      {quote && <div className="space-y-3 rounded-xl border border-slate-200 p-4">
        <h2 className="font-semibold">{quote.student.name} · {quote.student.srNo}</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm"><dt>{label(ms.bridgeFeeDue)}</dt><dd>{money(quote.feesPending)}</dd><dt>{label(ms.bridgeLateDue)}</dt><dd>{money(quote.lateFeePending)}</dd><dt>{label(ms.bridgeWaived)}</dt><dd>{money(quote.lateFeeWaiverAmount)}</dd><dt>{label(ms.bridgeRemaining)}</dt><dd>{money(quote.remainingBalance)}</dd></dl>
        <button className={button} disabled={locked || !props.canPost || !quote.acceptedPaymentModes.includes(mode)} onClick={confirm}>{label(ms.bridgeConfirm)} · {money(quote.amount)}</button>
      </div>}
      {uncertain && <div className="space-y-3 rounded-xl border border-amber-400 bg-amber-50 p-4" role="alert"><p>{label(ms.bridgeUnknown)}</p><p className="break-all font-mono text-xs">{command?.commandId}</p><button className={button} disabled={pending} onClick={check}>{label(ms.bridgeCheck)}</button>{retryable && command && <button className={`${button} ml-2`} disabled={pending || !props.canPost} onClick={()=>startTransition(()=>submit(command))}>{label(ms.bridgeRetry)}</button>}{command && <a className="block text-blue-700 underline" href={`${FEES_ORIGIN}/protected/payments/one-status?${new URLSearchParams({commandId:command.commandId})}`}>{label(ms.bridgeCheckFees)}</a>}</div>}
    </>}
    {pending && <p role="status">{label(ms.bridgeWorking)}</p>}
  </section>;
}
