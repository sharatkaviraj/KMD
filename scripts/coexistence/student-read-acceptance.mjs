#!/usr/bin/env node
/** GET-only live read acceptance. Defaults offline; exact origins and existing
 * identity pins only. Private fixtures may contain PII; results never do. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAcceptanceConfig } from './acceptance.mjs';

const FEES='https://fees.vpps.co.in';
const ONE='https://one.vpps.co.in';
const AUTH='https://wtgxcptmucjerhufzjcf.supabase.co';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const need=(value,code)=>{if(!value)throw new Error(code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const plan=['identity','complete_directory','filtered_directory','profile_and_financial_parity','photo_source_proxy_parity','missing_photo','receipt_detail','native_one_pages','permission_denials'];
const safeError=error=>error instanceof Error&&/^[a-z0-9_]+$/.test(error.message)?error.message:'read_check_failed';
function partialEqual(actual,expected){
  if(expected===null||typeof expected!=='object')return Object.is(actual,expected);
  if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((v,i)=>partialEqual(actual[i],v));
  return actual&&typeof actual==='object'&&Object.entries(expected).every(([key,value])=>partialEqual(actual[key],value));
}
function privateTokensAbsent(body,c){return ![c.bridgeKey,c.oneAccessToken,c.deniedActorAccessToken,c.oneCookieHeader].filter(Boolean).some(secret=>body.includes(secret));}
function htmlHas(body,value){
  const text=String(value);return body.includes(text)||body.includes(text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#x27;'))||body.includes(JSON.stringify(text).slice(1,-1));
}
export async function runStudentReadAcceptance(raw,{execute=false,fetcher=fetch}={}){
  const c=validateAcceptanceConfig(raw);
  need(c.oneCookieHeader,'existing_one_cookie_required');
  need(Number.isInteger(c.expectedStudentCount)&&c.expectedStudentCount>0,'expected_count_required');
  need(Array.isArray(c.samples)&&c.samples.length>0&&c.samples.length<=12&&c.samples.every(s=>UUID.test(s.studentId)),'sample_pins_required');
  if(!execute)return {mode:'plan',networkRequests:0,checks:plan,mutations:0};
  const checks=[];let networkRequests=0;
  const check=async(name,fn)=>{const start=performance.now();try{const details=await fn();checks.push({name,status:'passed',ms:Math.round(performance.now()-start),...details});return true;}catch(error){checks.push({name,status:'failed',ms:Math.round(performance.now()-start),code:safeError(error)});return false;}};
  async function request(origin,route,{token=c.oneAccessToken,cookie=c.oneCookieHeader,key=c.bridgeKey,authKey=false,image=false,pdf=false,anonymous=false}={}){
    need([FEES,ONE,AUTH].includes(origin)&&route.startsWith('/')&&!route.startsWith('//'),'untrusted_origin');
    const url=new URL(route,origin);need(url.origin===origin,'untrusted_origin');
    const headers=anonymous?{}:origin===ONE?{Cookie:cookie}:origin===AUTH?{apikey:c.oneAuthKey,Authorization:`Bearer ${token}`}:{Authorization:`Bearer ${token}`,...(key?{'X-One-Bridge-Key':key}:{})};
    need(!authKey,'unsupported_request');networkRequests++;
    const response=await fetcher(url,{method:'GET',headers,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(60000)});
    need(response.status<300||response.status>=400,'unexpected_redirect');
    const limit=pdf?2*1024*1024:image?512*1024:origin===ONE?12_000_000:4_000_000;
    const reader=response.body?.getReader();need(reader||response.status!==200,'empty_response');let size=0;const chunks=[];
    if(reader)try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;need(size<=limit,'response_too_large');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
    const bytes=Buffer.concat(chunks);const body=image||pdf?'':bytes.toString('utf8');
    need(privateTokensAbsent(body,c),'private_token_in_response');
    return {status:response.status,body,bytes,cache:response.headers.get('cache-control')??'',mime:response.headers.get('content-type')?.split(';')[0]??'',vary:response.headers.get('vary')??''};
  }
  async function api(route,options){
    need(/^\/(directory|students\/[0-9a-f-]+\/workspace|receipts\/[0-9a-f-]+\/detail)(?:\?|$)/i.test(route),'unsupported_probe_route');
    const r=await request(FEES,`/api/one/v1${route}`,options);const envelope=JSON.parse(r.body);
    need(envelope.version===1&&r.cache.includes('no-store'),'invalid_contract_or_cache');return {...r,envelope};
  }
  const ok=r=>{need(r.status===200&&r.envelope.data,'source_read_failed');return r.envelope.data;};
  const session=encodeURIComponent(c.sessionLabel);
  const actor=await check('identity',async()=>{const r=await request(AUTH,'/auth/v1/user');const u=JSON.parse(r.body);need(r.status===200&&u.id===c.actorId&&!u.is_anonymous,'actor_pin_mismatch');return {};});
  if(!actor)return {mode:'executed',ok:false,mutations:0,networkRequests,checks};
  const directoryRows=[];let firstDirectory;
  await check('complete_directory',async()=>{
    for(let page=1;page<=50;page++){
      const data=ok(await api(`/directory?session=${session}&page=${page}&pageSize=100&sort=name&status=all`));
      need(data.sessionLabel===c.sessionLabel&&data.pagination.page===page&&data.pagination.totalCount===c.expectedStudentCount,'directory_pins_mismatch');
      need(data.students.length<=100&&data.students.every(s=>UUID.test(s.id)&&typeof s.hasPhoto==='boolean'),'directory_shape_invalid');
      firstDirectory??=data;directoryRows.push(...data.students);
      if(!data.pagination.hasMore)break;
      need(data.students.length>0&&page<50,'directory_pagination_incomplete');
    }
    need(directoryRows.length===c.expectedStudentCount&&new Set(directoryRows.map(s=>s.id)).size===directoryRows.length,'directory_count_or_duplicate');
    if(c.expectedPhotoCount!==undefined)need(directoryRows.filter(s=>s.hasPhoto).length===c.expectedPhotoCount,'directory_photo_count_mismatch');
    if(c.expectedDirectoryRows){need(c.expectedDirectoryRows.length===directoryRows.length,'fixture_directory_incomplete');const byId=new Map(directoryRows.map(s=>[s.id,s]));need(c.expectedDirectoryRows.every(row=>partialEqual(byId.get(row.id),row)),'directory_values_differ_from_source');}
    if(c.expectedSummary)need(partialEqual(firstDirectory.summary,c.expectedSummary),'directory_summary_differs_from_source');
    return {students:directoryRows.length,photos:directoryRows.filter(s=>s.hasPhoto).length,pages:Math.ceil(directoryRows.length/100)};
  });
  if(directoryRows.length)await check('filtered_directory',async()=>{
    const row=directoryRows[0];const data=ok(await api(`/directory?session=${session}&page=1&pageSize=100&classId=${row.classId}&query=${encodeURIComponent(row.admissionNo)}&sort=class&status=all`));
    need(data.students.some(s=>s.id===row.id)&&data.students.every(s=>s.classId===row.classId),'filtered_directory_mismatch');return {matches:data.students.length};
  });
  const workspaces=[];
  for(const [i,sample]of c.samples.entries())await check(`workspace_${i+1}`,async()=>{
    const data=ok(await api(`/students/${sample.studentId}/workspace?session=${session}`));
    need(data.studentId===sample.studentId&&data.student.id===sample.studentId&&data.sessionLabel===c.sessionLabel&&data.student.classSessionLabel===c.sessionLabel,'workspace_pins_mismatch');
    need(!('photoPath'in data.student),'storage_path_exposed');
    if(sample.expected)need(partialEqual(data,sample.expected),'workspace_values_differ_from_source');
    if(sample.requiredSections)for(const name of sample.requiredSections)need(data[name]!==null&&data[name]!==undefined,'workspace_section_missing');
    need(data.financialSummary?.studentId===sample.studentId&&data.financialSummary?.sessionLabel===c.sessionLabel,'financial_identity_mismatch');
    need(data.installmentBalances?.every(row=>row.studentId===sample.studentId&&(row.sessionLabel===c.sessionLabel||(row.isCarryForward&&row.targetSessionLabel===c.sessionLabel))),'installment_identity_mismatch');
    if(sample.expectedInstallmentTotals){
      const fields={cashPaid:'appliedAmount',feesPending:'pendingAmount',lateFeePending:'lateFeePending',totalPending:'totalPending'};
      for(const [name,field]of Object.entries(fields)){
        need(data.installmentBalances.every(row=>Number.isFinite(row[field])),'installment_amount_invalid');
        const actual=data.installmentBalances.reduce((sum,row)=>sum+row[field],0);
        need(Number.isFinite(sample.expectedInstallmentTotals[name])&&Math.abs(actual-sample.expectedInstallmentTotals[name])<0.000001,'installment_totals_differ_from_source');
      }
    }
    if(sample.hasPhoto!==undefined)need(data.student.hasPhoto===sample.hasPhoto,'profile_photo_mismatch');
    workspaces.push({sample,data});return {profileFields:Object.keys(data.student).length,installments:data.installmentBalances?.length??0,receipts:data.pagination.receipts?.totalCount??0,payments:data.pagination.ledgerPayments?.totalCount??0};
  });
  for(const [i,{sample,data}]of workspaces.entries()){
    if(sample.nativeProfile)await check(`native_profile_${i+1}`,async()=>{
      const r=await request(ONE,`/students/${sample.studentId}?tab=info`);
      need(r.status===200&&!/NEXT_REDIRECT;|NEXT_HTTP_ERROR_FALLBACK;404/.test(r.body)&&r.body.includes('data-student-source-section="profile"'),'native_profile_missing');
      need(htmlHas(r.body,data.student.fullName)&&(sample.nativeProfileExpected??[]).every(value=>htmlHas(r.body,value)),'native_profile_values_mismatch');
      return {httpStatus:r.status,verifiedValues:(sample.nativeProfileExpected??[]).length};
    });
    await check(`complete_history_${i+1}`,async()=>{
      const specs=[
        {name:'receipts',param:'receiptsPage',rows:d=>d.receipts,page:d=>d.pagination.receipts},
        {name:'payments',param:'ledgerPage',rows:d=>d.ledger?.payments,page:d=>d.pagination.ledgerPayments},
        {name:'adjustments',param:'ledgerPage',rows:d=>d.ledger?.adjustments,page:d=>d.pagination.ledgerAdjustments},
        {name:'finance',param:'financePage',rows:d=>d.financeHistory,page:d=>d.pagination.financeHistory},
        ...['contacts','attempts','reminders','notices','documents'].map(name=>({name,param:`${name}Page`,rows:d=>d.history?.[name]?.rows,page:d=>d.history?.[name]?.pagination})),
      ].filter(spec=>spec.page(data));
      const seen=new Map(specs.map(spec=>[spec.name,new Set()]));
      let current=data;let lastPage=1;
      for(let n=1;n<=100;n++){
        for(const spec of specs){const meta=spec.page(current);const initial=spec.page(data);const rows=spec.rows(current);
          need(meta&&meta.totalCount===initial.totalCount&&meta.page===n&&Array.isArray(rows),'history_pagination_changed');
          need(rows.length<=meta.pageSize&&(!meta.hasMore||rows.length>0),'history_page_incomplete');
          for(const row of rows){const id=row.id??row.sendId;need(UUID.test(id),'history_invalid_identity');const identity=`${row.kind??''}:${id}`;need(!seen.get(spec.name).has(identity),'history_duplicate');seen.get(spec.name).add(identity);}
        }
        lastPage=n;
        if(specs.every(spec=>!spec.page(current).hasMore))break;
        need(n<100,'history_page_limit');
        const params=new URLSearchParams({session:c.sessionLabel});for(const spec of specs)params.set(spec.param,String(n+1));
        current=ok(await api(`/students/${sample.studentId}/workspace?${params}`));
        need(current.studentId===sample.studentId&&current.sessionLabel===c.sessionLabel,'history_identity_mismatch');
      }
      need(specs.every(spec=>seen.get(spec.name).size===spec.page(data).totalCount),'history_count_mismatch');
      return {sections:specs.length,pages:lastPage,rows:[...seen.values()].reduce((sum,ids)=>sum+ids.size,0)};
    });
    if(data.student.hasPhoto)await check(`photo_parity_${i+1}`,async()=>{
      const suffix=`/students/${sample.studentId}/photo?session=${session}&variant=thumb`;
      const source=await request(FEES,`/api/one/v1${suffix}`,{image:true});const target=await request(ONE,`/api/fees-bridge${suffix}`,{image:true});
      need(source.status===200&&target.status===200&&source.bytes.length>0&&source.mime===target.mime&&['image/jpeg','image/png','image/webp'].includes(source.mime),'photo_response_invalid');
      need(hash(source.bytes)===hash(target.bytes),'photo_bytes_differ');need(source.cache.includes('no-store')&&target.cache.includes('no-store')&&target.vary.toLowerCase().includes('cookie'),'photo_cache_policy_invalid');
      return {bytes:target.bytes.length,mime:target.mime,sha256:hash(target.bytes)};
    });
    else await check(`missing_photo_${i+1}`,async()=>{const r=await request(ONE,`/api/fees-bridge/students/${sample.studentId}/photo?session=${session}`,{image:true});need(r.status===404,'missing_photo_not_404');return {};});
    const document=data.history?.documents?.rows.find(row=>row.available);
    if(document)await check(`stored_document_${i+1}`,async()=>{
      need(UUID.test(document.sendId),'invalid_document_identity');const suffix=`/students/${sample.studentId}/documents/${document.sendId}?session=${session}`;
      const source=await request(FEES,`/api/one/v1${suffix}`,{pdf:true});const target=await request(ONE,`/api/fees-bridge${suffix}`,{pdf:true});
      need(source.status===200&&target.status===200&&source.mime==='application/pdf'&&target.mime==='application/pdf'&&target.bytes.subarray(0,5).toString()==='%PDF-','document_response_invalid');
      need(hash(source.bytes)===hash(target.bytes),'document_bytes_differ');need(source.cache.includes('no-store')&&target.cache.includes('no-store'),'document_cache_policy_invalid');
      const denial=await request(ONE,`/api/fees-bridge${suffix}`,{pdf:true,anonymous:true});need([401,403,404].includes(denial.status)&&denial.bytes.length===0,'anonymous_document_exposed');
      return {bytes:target.bytes.length,sha256:hash(target.bytes)};
    });
  }
  const first=workspaces[0];
  if(first){
    const id=first.sample.studentId;
    for(const [name,route,contains]of [
      ['directory','/students?view=fees',[]],['profile',`/students/${id}?tab=info`,[first.data.student.fullName]],
      ['fees',`/students/${id}?tab=fees`,[first.data.student.fullName]],['household',`/students/${id}?tab=family`,[first.data.student.fullName]],
    ])await check(`native_one_${name}`,async()=>{const r=await request(ONE,route);need(r.status===200&&!/name=["']password["']/.test(r.body)&&!r.body.includes('NEXT_REDIRECT;')&&!r.body.includes('NEXT_HTTP_ERROR_FALLBACK;404'),'native_page_failed');need(contains.every(v=>htmlHas(r.body,v)),'native_page_data_missing');need(!/fees unavailable|fees could not be loaded|couldn.t load fees/i.test(r.body),'native_fees_unavailable');
      if(name!=='directory')need(r.body.includes(`data-student-source-section="${name}"`),'native_section_missing');
      if(name==='profile'&&first.data.student.hasPhoto)need(r.body.includes(`/api/fees-bridge/students/${id}/photo`),'native_photo_missing');
      if(c.nativeExpected?.[name])need(c.nativeExpected[name].every(value=>htmlHas(r.body,value)),'native_values_differ_from_source');return {httpStatus:r.status};});
    const receipt=first.data.receipts?.[0];
    if(receipt)await check('native_receipt',async()=>{
      const data=ok(await api(`/receipts/${receipt.id}/detail?session=${session}`));need(data.receiptId===receipt.id&&data.studentId===id&&data.detail.receiptNumber===receipt.receiptNumber,'receipt_pins_mismatch');
      const r=await request(ONE,`/receipts/${encodeURIComponent(receipt.receiptNumber)}?receiptId=${receipt.id}&session=${session}`);
      need(r.status===200&&!r.body.includes('NEXT_REDIRECT;')&&r.body.includes('data-student-source-section="receipt"')&&htmlHas(r.body,receipt.receiptNumber)&&htmlHas(r.body,first.data.student.fullName),'native_receipt_missing');return {allocations:data.detail.breakdown.length};
    });
    await check('anonymous_photo_denied',async()=>{const r=await request(ONE,`/api/fees-bridge/students/${id}/photo?session=${session}`,{anonymous:true,image:true});need([401,403,404].includes(r.status)&&r.bytes.length===0,'anonymous_photo_exposed');return {};});
    await check('wrong_session_denied',async()=>{const r=await api(`/students/${id}/workspace?session=${encodeURIComponent(c.deniedSessionLabel)}`);need([400,403,404].includes(r.status)&&r.envelope.error&&!r.envelope.data,'wrong_session_exposed');return {};});
    await check('missing_bridge_key_denied',async()=>{const r=await api(`/students/${id}/workspace?session=${session}`,{key:null});need(r.status===401&&!r.envelope.data,'missing_key_accepted');return {};});
    if(c.deniedActorAccessToken)await check('unmapped_actor_denied',async()=>{const auth=await request(AUTH,'/auth/v1/user',{token:c.deniedActorAccessToken});need(auth.status===200&&JSON.parse(auth.body).id===c.deniedActorId,'denied_actor_pin_mismatch');const r=await api(`/students/${id}/workspace?session=${session}`,{token:c.deniedActorAccessToken});need(r.status===403&&!r.envelope.data,'unmapped_actor_exposed');return {};});
  }
  return {mode:'executed',ok:checks.every(check=>check.status==='passed'),mutations:0,networkRequests,checks};
}
function privatePath(value){
  need(typeof value==='string'&&/^[dD]:[\\/]/.test(value)&&path.isAbsolute(value),'private_d_path_required');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');const rel=path.relative(root,path.resolve(value));
  need(rel==='..'||rel.startsWith(`..${path.sep}`)||path.isAbsolute(rel),'private_path_outside_repo_required');return value;
}
async function main(){
  const args=process.argv.slice(2);const arg=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const c=JSON.parse(readFileSync(privatePath(arg('--config')),'utf8'));
  const result=await runStudentReadAcceptance(c,{execute:args.includes('--execute')});
  if(arg('--output'))writeFileSync(privatePath(arg('--output')),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));if(result.ok===false)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({ok:false,code:safeError(error)}));process.exitCode=1;});
