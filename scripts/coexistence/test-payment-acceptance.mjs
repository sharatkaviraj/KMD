#!/usr/bin/env node
/** Positive acceptance is limited to one explicitly approved source TEST
 * fixture and Rs1, never a real student. Source TEST commands skip message
 * maintenance. Save the original immutable command BEFORE dispatch; any
 * interruption resumes by status and the SAME ID/payload. No grants or auth
 * configuration are changed. Root independently verifies source SQL counts
 * using the exact command/student/session in the private checkpoint.
 */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {atomicPrivateJson} from './atomic-private-json.mjs';
const FEES='https://fees.vpps.co.in';
const AUTH='https://wtgxcptmucjerhufzjcf.supabase.co';
const SESSION='TEST-2026-27';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const need=(condition,code)=>{if(!condition)throw new Error(code);};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function configOf(c){
  need(c?.purpose==='approved-test-only-payment-acceptance'&&c.fixtureApproved===true,'explicit_test_fixture_approval_required');
  need(c.sessionLabel===SESSION&&UUID.test(c.sourceTestStudentId)&&UUID.test(c.actorId),'exact_test_identity_required');
  need(UUID.test(c.sourceRealStudentId)&&c.sourceRealStudentId!==c.sourceTestStudentId,'separate_real_id_negative_pin_required');
  need(typeof c.oneAccessToken==='string'&&c.oneAccessToken.length>20&&typeof c.oneAuthKey==='string'&&c.oneAuthKey.length>20&&typeof c.bridgeKey==='string'&&c.bridgeKey.length>=32,'existing_session_and_keys_required');
  need(typeof c.deniedActorAccessToken==='string'&&UUID.test(c.deniedActorId)&&c.deniedActorId!==c.actorId,'separate_denied_actor_required');
  return c;
}
export function validatePaymentCheckpoint(checkpoint,c){
  const p=checkpoint?.payload;
  need(checkpoint?.version===1&&checkpoint.actorId===c.actorId&&checkpoint.sourceTestStudentId===c.sourceTestStudentId,'checkpoint_identity_mismatch');
  need(checkpoint.receiptPrefix==='TST','checkpoint_test_receipt_prefix_required');
  need(p&&p.studentId===c.sourceTestStudentId&&p.sessionLabel===SESSION&&p.amount===1&&p.quickDiscountAmount===0&&p.lateFeeWaiverAmount===0&&p.paymentMode==='cash'&&p.referenceNumber===null&&p.remarks==='Synthetic One coexistence acceptance'&&UUID.test(p.commandId)&&/^[a-f0-9]{32}$/.test(p.quoteHash)&&/^\d{4}-\d{2}-\d{2}$/.test(p.paymentDate),'checkpoint_payload_mismatch');
  need(Object.keys(p).sort().join(',')===['studentId','sessionLabel','amount','quickDiscountAmount','lateFeeWaiverAmount','paymentMode','referenceNumber','remarks','commandId','quoteHash','paymentDate'].sort().join(','),'checkpoint_extra_fields');
  need(Number.isFinite(checkpoint.before?.totalPaid)&&Number.isFinite(checkpoint.before?.totalPending)&&checkpoint.before.totalPending>=1,'checkpoint_baseline_missing');
  return checkpoint;
}
/** @param {Record<string, unknown>} raw
 * @param {{execute?:boolean,checkpoint?:Record<string,unknown>|null,persistCheckpoint?:(value:Record<string,unknown>)=>unknown,fetcher?:typeof fetch}} options */
export async function runTestPaymentAcceptance(raw,{execute=false,checkpoint=null,persistCheckpoint,fetcher=fetch}={}){
  const c=configOf(raw);
  if(!execute)return {mode:'plan',networkRequests:0,session:SESSION,amount:1,positiveCommands:1,replaySameCommand:true,sourceCountProof:'root_readonly_sql',sendActionsRequested:0};
  need(typeof persistCheckpoint==='function','durable_checkpoint_writer_required');
  if(checkpoint)validatePaymentCheckpoint(checkpoint,c);
  let state=checkpoint,networkRequests=0;const checks=[];
  const save=async()=>{await persistCheckpoint(structuredClone(state));};
  const record=(name)=>checks.push({name,status:'passed'});
  async function request(url,init={}){
    need([FEES,AUTH].includes(new URL(url).origin),'untrusted_origin');networkRequests++;
    const response=await fetcher(url,{...init,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(45000)});
    need(response.status<300||response.status>=400,'unexpected_redirect');
    const body=await response.text();need(Buffer.byteLength(body)<1_000_000,'response_too_large');
    return {status:response.status,body:JSON.parse(body),cache:response.headers.get('cache-control')};
  }
  async function auth(token,id){const r=await request(`${AUTH}/auth/v1/user`,{headers:{apikey:c.oneAuthKey,Authorization:`Bearer ${token}`}});need(r.status===200&&r.body.id===id&&!r.body.is_anonymous,'one_actor_mismatch');}
  async function api(route,{method='GET',body,token=c.oneAccessToken}={}){
    need(/^\/(sessions|students|quote|payments|commands|receipts)(?:[/?]|$)/.test(route),'unsupported_route');
    // Absolute guard on every payment request, including negative probes.
    if(route==='/payments')need(state?.receiptPrefix==='TST'&&body?.studentId===c.sourceTestStudentId&&body.sessionLabel===SESSION&&body.amount===1&&body.quickDiscountAmount===0&&body.lateFeeWaiverAmount===0,'non_test_payment_refused');
    const r=await request(`${FEES}/api/one/v1${route}`,{method,headers:{Authorization:`Bearer ${token}`,'X-One-Bridge-Key':c.bridgeKey,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    need(r.body.version===1&&r.cache?.includes('no-store'),'source_contract_or_cache_mismatch');return r;
  }
  const ok=r=>{need(r.status===200&&r.body.data!==undefined,'source_request_refused');return r.body.data;};
  const rejection=(r,codes,statuses)=>need(statuses.includes(r.status)&&codes.includes(r.body.error?.code),'negative_probe_failed');
  const matchesResult=result=>need(result?.status==='completed'&&result.commandId===state.payload.commandId&&result.studentId===c.sourceTestStudentId&&result.sessionLabel===SESSION&&result.amountReceived===1&&UUID.test(result.receiptId)&&/^TST(?:[-/])/.test(result.receiptNumber??''),'payment_result_mismatch');
  try{
    await auth(c.oneAccessToken,c.actorId);await auth(c.deniedActorAccessToken,c.deniedActorId);record('one_actor_pins');
    const sessions=ok(await api('/sessions')).sessions;
    need(Array.isArray(sessions)&&sessions.length===1&&sessions[0].sessionLabel===SESSION,'source_grant_not_test_only');record('test_only_source_grant');
    const detail=ok(await api(`/students/${c.sourceTestStudentId}?session=${SESSION}`));
    need(detail.student?.id===c.sourceTestStudentId&&detail.student.sessionLabel===SESSION&&detail.student.status==='active','source_fixture_not_active_test');
    need(Number.isFinite(detail.standing?.totalPaid)&&Number.isFinite(detail.standing?.totalPending),'source_standing_invalid');record('source_test_fixture');
    // All denials precede a new positive command. Real IDs occur only in a
    // read-only quote; no /payments request can contain one.
    rejection(await api('/sessions',{token:c.deniedActorAccessToken}),['forbidden'],[403]);record('unmapped_actor_rejected');
    const quoteInput={studentId:c.sourceTestStudentId,sessionLabel:SESSION,paymentDate:state?.payload.paymentDate??today(),amount:1,quickDiscountAmount:0,lateFeeWaiverAmount:0};
    rejection(await api('/quote',{method:'POST',body:{...quoteInput,sessionLabel:'2026-27'}}),['forbidden'],[403]);record('real_session_rejected');
    rejection(await api('/quote',{method:'POST',body:{...quoteInput,studentId:c.sourceRealStudentId}}),['student_session_mismatch'],[400]);record('forged_real_student_rejected');
    if(!state){
      need(detail.standing.totalPending>=1,'fixture_needs_positive_dues');
      const quote=ok(await api('/quote',{method:'POST',body:quoteInput}));
      need(quote.student?.id===c.sourceTestStudentId&&quote.student.sessionLabel===SESSION&&quote.amount===1&&quote.quickDiscountAmount===0&&quote.lateFeeWaiverAmount===0&&/^[a-f0-9]{32}$/.test(quote.quoteHash)&&quote.acceptedPaymentModes?.includes('cash'),'test_quote_mismatch');
      need(quote.receiptPrefix==='TST','test_receipt_prefix_required');
      state={version:1,actorId:c.actorId,sourceTestStudentId:c.sourceTestStudentId,receiptPrefix:'TST',createdAt:new Date().toISOString(),stage:'prepared',before:{totalPaid:detail.standing.totalPaid,totalPending:detail.standing.totalPending,asOfDate:detail.standing.asOfDate},payload:{...quoteInput,commandId:randomUUID(),quoteHash:quote.quoteHash,paymentMode:'cash',referenceNumber:null,remarks:'Synthetic One coexistence acceptance'}};
      validatePaymentCheckpoint(state,c);await save();record('command_durably_prepared');
    }
    const status=ok(await api(`/commands/${state.payload.commandId}`));
    need(status.commandId===state.payload.commandId,'command_identity_mismatch');
    let result;
    if(status.status==='completed'){matchesResult(status);result=status;record('existing_command_recovered');}
    else{
      need(status.status==='not_found','unknown_command_status');
      // Recheck current numbering even when resuming an earlier prepared
      // command. A policy change must never consume the real SVP sequence.
      const currentQuote=ok(await api('/quote',{method:'POST',body:quoteInput}));
      need(currentQuote.receiptPrefix==='TST','test_receipt_prefix_required');
      need(currentQuote.quoteHash===state.payload.quoteHash,'original_quote_changed');
      rejection(await api('/payments',{method:'POST',body:{...quoteInput,commandId:randomUUID(),quoteHash:'invalid-quote',paymentMode:'cash',referenceNumber:null,remarks:'Synthetic One coexistence acceptance'}}),['invalid_request'],[400]);record('invalid_quote_rejected');
      state.stage='dispatching';await save();
      const response=await api('/payments',{method:'POST',body:state.payload});
      result=ok(response);matchesResult(result);record('one_rupee_test_payment');
    }
    state.stage='completed';state.result=result;await save();
    const replay=ok(await api('/payments',{method:'POST',body:state.payload}));matchesResult(replay);need(replay.receiptId===result.receiptId&&replay.receiptNumber===result.receiptNumber,'same_id_replay_mismatch');record('same_command_replay');
    const finalStatus=ok(await api(`/commands/${state.payload.commandId}`));matchesResult(finalStatus);need(finalStatus.receiptId===result.receiptId,'status_receipt_mismatch');record('canonical_command_status');
    const receipt=ok(await api(`/receipts/${result.receiptId}?session=${SESSION}`));
    need(receipt.receiptId===result.receiptId&&/^TST(?:[-/])/.test(receipt.receiptNumber??'')&&receipt.student?.id===c.sourceTestStudentId&&receipt.student.sessionLabel===SESSION&&receipt.amountReceived===1&&!receipt.reversed&&new URL(receipt.printUrl,FEES).origin===FEES,'canonical_receipt_mismatch');record('canonical_receipt');
    const after=ok(await api(`/students/${c.sourceTestStudentId}?session=${SESSION}`));
    need(after.student?.id===c.sourceTestStudentId&&after.student.sessionLabel===SESSION&&after.standing.asOfDate===state.before.asOfDate&&after.standing.totalPaid===state.before.totalPaid+1&&after.standing.totalPending===state.before.totalPending-1,'canonical_standing_delta_mismatch');record('source_one_rupee_delta');
    state.stage='verified';state.verifiedAt=new Date().toISOString();state.checks=checks;await save();
    return {ok:true,mode:'executed',session:SESSION,amount:1,networkRequests,checks,sourceSqlCountProof:'pending_root_readonly_check',sendActionsRequested:0};
  }catch(error){
    // Every previously prepared command remains intact. An unknown response
    // never replaces the ID, edits the payload, or automatically starts anew.
    const code=error instanceof Error&&/^[a-z0-9_]+$/.test(error.message)?error.message:'request_failed';
    if(state){state.lastFailure=code;await save();}
    return {ok:false,mode:'executed',session:SESSION,amount:1,networkRequests,checks,code,checkpointPreserved:!!state};
  }
}

function privatePath(value){
  need(typeof value==='string'&&/^[dD]:[\\/]/.test(value)&&path.isAbsolute(value),'private_d_path_required');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');const rel=path.relative(root,path.resolve(value));need(rel==='..'||rel.startsWith(`..${path.sep}`)||path.isAbsolute(rel),'private_path_outside_repo_required');return path.resolve(value);
}
function checkpointWriter(file){return state=>atomicPrivateJson(file,state);}
async function main(){
  const args=process.argv.slice(2);const arg=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  if(args.includes('--help')){console.log('test-payment-acceptance.mjs --config D:\\private\\test-config.json --checkpoint D:\\private\\original-command.json [--execute] [--output D:\\private\\redacted-result.json]');return;}
  const c=JSON.parse(readFileSync(privatePath(arg('--config')),'utf8'));const file=privatePath(arg('--checkpoint'));
  const result=await runTestPaymentAcceptance(c,{execute:args.includes('--execute'),checkpoint:existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null,persistCheckpoint:checkpointWriter(file)});
  if(arg('--output'))writeFileSync(privatePath(arg('--output')),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result.ok===false)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('TEST acceptance failed; inspect the existing private checkpoint before retrying. No credential or record bodies were logged.');process.exitCode=1;});
