#!/usr/bin/env node
/** Deployed acceptance using existing One sessions. Default is a no-network plan.
 * No grants, configuration, credentials, real payments or sends are written.
 * The optional disabled-command probe uses TEST only and an absent nil UUID.
 * Config/output must be private D: paths outside the repo; only redacted
 * statuses/counts are returned. Never save upstream HTML or response bodies.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const FEES='https://fees.vpps.co.in';
const ONE='https://one.vpps.co.in';
const AUTH='https://wtgxcptmucjerhufzjcf.supabase.co';
const NIL='00000000-0000-0000-0000-000000000000';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const need=(condition,code)=>{if(!condition)throw new Error(code);};
const plan=[
  'verify_one_actor','sessions','classes','students','student_detail','quote',
  'receipt_optional','unknown_command','missing_key_rejected','invalid_actor_rejected',
  'wrong_session_rejected','unmapped_actor_optional','one_authenticated_pages_optional',
  'test_disabled_command_optional',
];

export function validateAcceptanceConfig(c){
  need(c && typeof c==='object','config_required');
  need(typeof c.bridgeKey==='string'&&c.bridgeKey.length>=32,'bridge_key_required');
  need(typeof c.oneAuthKey==='string'&&c.oneAuthKey.length>20,'one_public_auth_key_required');
  need(typeof c.oneAccessToken==='string'&&c.oneAccessToken.length>20,'existing_one_session_required');
  need(UUID.test(c.actorId),'actor_pin_required');
  need(/^\d{4}-\d{2}$/.test(c.sessionLabel),'explicit_real_read_session_required');
  need(/^(?:TEST-|UAT-|DEMO-)?\d{4}-\d{2}$/.test(c.deniedSessionLabel)&&c.deniedSessionLabel!==c.sessionLabel,'denied_session_required');
  if(c.studentId)need(UUID.test(c.studentId),'invalid_student_id');
  if(c.receiptId)need(UUID.test(c.receiptId),'invalid_receipt_id');
  if(c.deniedActorAccessToken)need(UUID.test(c.deniedActorId)&&c.deniedActorId!==c.actorId,'denied_actor_pin_required');
  if(c.testAccessToken)need(UUID.test(c.testActorId)&&c.testActorId!==c.actorId,'test_actor_pin_required');
  if(c.oneCookieHeader)need(typeof c.oneCookieHeader==='string'&&!/[\r\n]/.test(c.oneCookieHeader),'invalid_cookie_header');
  // No caller-provided destination exists: credentials can reach only these
  // three exact origins, with redirects disabled.
  return c;
}

export async function runAcceptance(raw,{execute=false,probeDisabledCommands=false,fetcher=fetch}={}){
  const c=validateAcceptanceConfig(raw);
  if(!execute)return {mode:'plan',networkRequests:0,checks:plan,disabledCommandProbe:probeDisabledCommands?'TEST absent nil UUID only':'off'};
  const checks=[];let networkRequests=0;
  const check=async(name,fn)=>{
    const start=Date.now();
    try{const detail=await fn();checks.push({name,status:'passed',ms:Date.now()-start,...detail});return true;}
    catch(e){checks.push({name,status:'failed',ms:Date.now()-start,code:e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'request_failed'});return false;}
  };
  const skip=(name,reason)=>checks.push({name,status:'skipped',reason});
  async function request(url,init={}){
    need([FEES,ONE,AUTH].includes(new URL(url).origin),'untrusted_origin');
    networkRequests++;
    const response=await fetcher(url,{...init,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
    need(response.status<300||response.status>=400,'unexpected_redirect');
    const body=await response.text();need(Buffer.byteLength(body)<2_000_000,'response_too_large');
    return {status:response.status,body,cache:response.headers.get('cache-control')};
  }
  async function user(token,id){
    const r=await request(`${AUTH}/auth/v1/user`,{headers:{apikey:c.oneAuthKey,Authorization:`Bearer ${token}`}});
    need(r.status===200,'one_auth_failed');const u=JSON.parse(r.body);need(u.id===id&&!u.is_anonymous,'one_actor_mismatch');
  }
  async function api(route,{method='GET',body,token=c.oneAccessToken,key=c.bridgeKey}={}){
    need(/^\/(sessions|classes|students|quote|receipts|commands|payments)(?:[/?]|$)/.test(route),'unsupported_probe_route');
    const r=await request(`${FEES}/api/one/v1${route}`,{method,headers:{Authorization:`Bearer ${token}`,...(key?{'X-One-Bridge-Key':key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const envelope=JSON.parse(r.body);need(envelope.version===1,'wrong_contract');need(r.cache?.includes('no-store'),'cache_policy_missing');
    return {...r,envelope};
  }
  function ok(r){need(r.status===200&&r.envelope.data!==undefined,'source_read_failed');return r.envelope.data;}
  function rejected(r,codes,statuses){need(statuses.includes(r.status)&&codes.includes(r.envelope.error?.code),'negative_probe_accepted_or_wrong_error');}
  const actorVerified=await check('verify_one_actor',async()=>{await user(c.oneAccessToken,c.actorId);return {};});
  if(!actorVerified)return {mode:'executed',ok:false,networkRequests,checks};
  await check('sessions',async()=>{const data=ok(await api('/sessions'));need(data.sessions.some(s=>s.sessionLabel===c.sessionLabel),'session_grant_missing');return {count:data.sessions.length};});
  await check('classes',async()=>{const data=ok(await api(`/classes?session=${encodeURIComponent(c.sessionLabel)}`));need(Array.isArray(data.classes)&&data.classes.every(row=>row.sessionLabel===c.sessionLabel),'class_session_mismatch');return {count:data.classes.length};});
  let studentId=c.studentId;
  await check('students',async()=>{const data=ok(await api(`/students?session=${encodeURIComponent(c.sessionLabel)}&limit=10`));need(Array.isArray(data.students)&&data.students.length>0&&data.students.every(row=>row.sessionLabel===c.sessionLabel),'student_session_mismatch');studentId??=data.students[0].id;return {count:data.students.length,paginated:!!data.nextCursor};});
  if(studentId){
    await check('student_detail',async()=>{const data=ok(await api(`/students/${studentId}?session=${encodeURIComponent(c.sessionLabel)}`));need(data.student.id===studentId&&data.student.sessionLabel===c.sessionLabel,'student_detail_mismatch');need(['feesPending','lateFeePending','totalPending','totalPaid'].every(k=>Number.isFinite(data.standing?.[k])&&data.standing[k]>=0),'standing_invalid');return {};});
    await check('quote',async()=>{const paymentDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const data=ok(await api('/quote',{method:'POST',body:{studentId,sessionLabel:c.sessionLabel,paymentDate,amount:1,quickDiscountAmount:0,lateFeeWaiverAmount:0}}));need(data.student.id===studentId&&data.student.sessionLabel===c.sessionLabel&&data.amount===1&&/^[a-f0-9]{32}$/.test(data.quoteHash),'quote_identity_mismatch');return {};});
  }else{skip('student_detail','no_student');skip('quote','no_student');}
  if(c.receiptId)await check('receipt',async()=>{const data=ok(await api(`/receipts/${c.receiptId}?session=${encodeURIComponent(c.sessionLabel)}`));need(data.receiptId===c.receiptId&&data.student.sessionLabel===c.sessionLabel,'receipt_identity_mismatch');need(new URL(data.printUrl,FEES).origin===FEES,'receipt_destination_mismatch');return {};});
  else skip('receipt','receipt_id_not_supplied');
  await check('unknown_command',async()=>{const id=randomUUID();const data=ok(await api(`/commands/${id}`));need(data.commandId===id&&data.status==='not_found','command_status_mismatch');return {};});
  await check('missing_key_rejected',async()=>{rejected(await api('/sessions',{key:null}),['unauthorized'],[401]);return {};});
  await check('invalid_actor_rejected',async()=>{rejected(await api('/sessions',{token:'invalid.synthetic.token'}),['unauthorized'],[401]);return {};});
  await check('wrong_session_rejected',async()=>{rejected(await api(`/students?session=${encodeURIComponent(c.deniedSessionLabel)}&limit=1`),['forbidden'],[403]);return {};});
  if(c.deniedActorAccessToken)await check('unmapped_actor_rejected',async()=>{await user(c.deniedActorAccessToken,c.deniedActorId);rejected(await api('/sessions',{token:c.deniedActorAccessToken}),['forbidden'],[403]);return {};});
  else skip('unmapped_actor_rejected','separate_unmapped_session_not_supplied');
  if(c.oneCookieHeader){
    for(const route of ['/payments','/accounts','/admissions'])await check(`one_page_${route.slice(1)}`,async()=>{
      const r=await request(`${ONE}${route}`,{headers:{Cookie:c.oneCookieHeader}});need(r.status===200,'one_page_not_authenticated');
      need(!/name=["']password["']/.test(r.body),'one_page_showed_login');
      if(route==='/payments')need(/Live payment desk|लाइव भुगतान डेस्क/.test(r.body),'one_live_desk_missing');
      return {httpStatus:r.status};
    });
  }else skip('one_authenticated_pages','existing_one_cookie_not_supplied');
  if(probeDisabledCommands){
    await check('test_disabled_command',async()=>{
      need(c.testAccessToken&&c.testActorId,'separate_test_session_required');
      await user(c.testAccessToken,c.testActorId);
      // This exact source TEST session is immutable in the harness. Absence is
      // proven before even a rejecting command. No real student ID is accepted.
      const sessionLabel='TEST-2026-27';
      rejected(await api(`/students/${NIL}?session=${sessionLabel}`,{token:c.testAccessToken}),['not_found'],[404]);
      const r=await api('/payments',{method:'POST',token:c.testAccessToken,body:{studentId:NIL,sessionLabel,paymentDate:'2026-11-01',amount:1,quickDiscountAmount:0,lateFeeWaiverAmount:0,commandId:randomUUID(),quoteHash:'0'.repeat(32),paymentMode:'cash',referenceNumber:null,remarks:'Synthetic disabled-gate probe'}});
      rejected(r,['commands_disabled'],[503]);return {session:'TEST-2026-27'};
    });
  }else skip('test_disabled_command','not_requested');
  return {mode:'executed',ok:checks.every(row=>row.status!=='failed'),networkRequests,checks};
}

function privatePath(value){
  need(typeof value==='string'&&/^[dD]:[\\/]/.test(value)&&path.isAbsolute(value),'private_d_drive_path_required');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const relative=path.relative(root,path.resolve(value));need(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative),'private_path_outside_repo_required');return value;
}
async function main(){
  const args=process.argv.slice(2);const value=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
  if(args.includes('--help')){console.log('node scripts/coexistence/acceptance.mjs --config D:\\private\\acceptance.json [--execute] [--probe-disabled-commands] [--output D:\\private\\result.json]');return;}
  const config=JSON.parse(readFileSync(privatePath(value('--config')),'utf8'));
  const result=await runAcceptance(config,{execute:args.includes('--execute'),probeDisabledCommands:args.includes('--probe-disabled-commands')});
  if(value('--output'))writeFileSync(privatePath(value('--output')),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));if(result.ok===false)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Acceptance failed; check private configuration and endpoint availability. No response bodies were logged.');process.exitCode=1;});
