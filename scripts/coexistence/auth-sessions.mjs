#!/usr/bin/env node
/** Explicit one-off acceptance sessions, not a QA sign-in endpoint. Existing
 * exact One profiles only: one approved REAL admin for read-only acceptance,
 * TEST identities for TEST payment/denial probes. generateLink + verifyOtp
 * sends no email and does not change passwords, profiles or auth users.
 * Default is a no-network plan. Never print tokens, links, emails or cookies.
 */
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicPrivateJson} from './atomic-private-json.mjs';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {parseEnvText} from '../migrate/lib/env.mjs';
const AUTH='https://wtgxcptmucjerhufzjcf.supabase.co';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const need=(condition,code)=>{if(!condition)throw new Error(code);};
const safeErrors=new Set(['private_d_path_required','private_path_outside_repo_required','explicit_acceptance_purpose_required','owner_and_test_pins_required','invalid_identity_pin','real_owner_admin_required','test_identity_required','role_pin_required','distinct_identity_pins_required','wrong_auth_project','one_auth_keys_required','private_session_writer_required','untrusted_auth_origin','profile_pin_changed','existing_auth_user_required','link_identity_mismatch','session_identity_mismatch','session_verification_failed','session_cookie_missing','cleanup_pin_mismatch','cleanup_failed','session_output_already_exists','session_persist_failed','session_persist_cleanup_failed']);
export function safeSessionFailureCode(error){return error instanceof Error&&safeErrors.has(error.message)?error.message:'session_operation_failed';}
function privatePath(value){
  need(typeof value==='string'&&/^[dD]:[\\/]/.test(value)&&path.isAbsolute(value),'private_d_path_required');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');const rel=path.relative(root,path.resolve(value));
  need(rel==='..'||rel.startsWith(`..${path.sep}`)||path.isAbsolute(rel),'private_path_outside_repo_required');return value;
}
function pins(c){
  need(c?.purpose==='approved-coexistence-api-acceptance','explicit_acceptance_purpose_required');
  need(c.test&&c.owner,'owner_and_test_pins_required');
  const rows=Object.entries(c).filter(([name])=>['owner','test','denied'].includes(name));
  for(const [name,pin]of rows){need(pin&&UUID.test(pin.userId)&&UUID.test(pin.profileId),'invalid_identity_pin');need(name!=='owner'||(pin.role==='admin'&&pin.isTestAccount===false),'real_owner_admin_required');need(name==='owner'||pin.isTestAccount===true,'test_identity_required');need(typeof pin.role==='string'&&pin.role.length>0,'role_pin_required');}
  need(new Set(rows.map(([,p])=>p.userId)).size===rows.length&&new Set(rows.map(([,p])=>p.profileId)).size===rows.length,'distinct_identity_pins_required');return rows;
}
/** @param {Record<string, unknown>} c
 * @param {{execute?:boolean,env?:Record<string,string>,adminFactory?:typeof createClient,userFactory?:typeof createServerClient,fetcher?:typeof fetch,persistSessions?:(value:Record<string,unknown>)=>unknown}} options */
export async function mintAcceptanceSessions(c,{execute=false,env={},adminFactory=createClient,userFactory=createServerClient,fetcher=fetch,persistSessions}={}){
  const rows=pins(c);if(!execute)return {mode:'plan',networkRequests:0,accounts:rows.map(([name])=>name),emailsSent:0,passwordChanges:0};
  need(env.NEXT_PUBLIC_SUPABASE_URL===AUTH,'wrong_auth_project');
  const key=env.SUPABASE_SERVICE_ROLE_KEY;const publicKey=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  need(key&&publicKey,'one_auth_keys_required');
  need(typeof persistSessions==='function','private_session_writer_required');
  const guardedFetch=(input,init)=>{need(new URL(input instanceof Request?input.url:String(input)).origin===AUTH,'untrusted_auth_origin');return fetcher(input,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});};
  const admin=adminFactory(AUTH,key,{db:{schema:'vppsone'},auth:{persistSession:false,autoRefreshToken:false},global:{fetch:guardedFetch}});
  const profile=async(pin)=>{const result=await admin.from('staff_profiles').select('id,user_id,role,is_active,is_test_account').eq('id',pin.profileId).eq('user_id',pin.userId).maybeSingle();const row=result.data;need(!result.error&&row?.id===pin.profileId&&row.user_id===pin.userId&&row.is_active&&row.is_test_account===pin.isTestAccount&&row.role===pin.role,'profile_pin_changed');};
  // Verify every existing identity before generating any link. Unknown emails
  // are never accepted, so generateLink cannot create a replacement account.
  const users=new Map();
  for(const [name,pin]of rows){await profile(pin);const result=await admin.auth.admin.getUserById(pin.userId);const user=result.data?.user;need(!result.error&&user?.id===pin.userId&&user.email&&!user.is_anonymous&&(!user.banned_until||new Date(user.banned_until)<=new Date()),'existing_auth_user_required');users.set(name,user);}
  const output={version:1,projectRef:'wtgxcptmucjerhufzjcf',createdAt:new Date().toISOString(),oneAuthKey:publicKey,accounts:{}};
  for(const [name,pin]of rows){
    const generated=await admin.auth.admin.generateLink({type:'magiclink',email:users.get(name).email});
    need(!generated.error&&generated.data?.user?.id===pin.userId&&generated.data?.properties?.hashed_token,'link_identity_mismatch');
    const jar=new Map();
    const client=userFactory(AUTH,publicKey,{auth:{autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:guardedFetch},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>{for(const entry of values){if(entry.value)jar.set(entry.name,entry.value);else jar.delete(entry.name);}}}});
    const verified=await client.auth.verifyOtp({type:'magiclink',token_hash:generated.data.properties.hashed_token});
    const session=verified.data?.session;
    need(!verified.error&&verified.data?.user?.id===pin.userId&&session?.access_token&&session.expires_at,'session_identity_mismatch');
    const fresh=await client.auth.getUser(session.access_token);need(!fresh.error&&fresh.data?.user?.id===pin.userId,'session_verification_failed');
    await profile(pin);need(jar.size>0,'session_cookie_missing');
    output.accounts[name]={actorId:pin.userId,profileId:pin.profileId,isTestAccount:pin.isTestAccount,oneAccessToken:session.access_token,oneCookieHeader:[...jar].map(([name,value])=>`${name}=${value}`).join('; '),expiresAt:session.expires_at};
    // Persist each completed session before attempting another identity, so a
    // later failure still leaves the operator the exact local-session cleanup.
    try{await persistSessions(structuredClone(output));}
    catch{
      // Never strand an unrecorded acceptance login when Windows/disk output
      // fails. Revoke exactly this new session, never the user's other logins.
      try{const cleanup=await admin.auth.admin.signOut(session.access_token,'local');need(!cleanup.error,'session_persist_cleanup_failed');}
      catch{throw new Error('session_persist_cleanup_failed');}
      throw new Error('session_persist_failed');
    }
  }
  return output;
}
/** @param {Record<string, unknown>} c @param {Record<string,unknown>} sessions
 * @param {{env?:Record<string,string>,adminFactory?:typeof createClient,fetcher?:typeof fetch}} options */
export async function revokeAcceptanceSessions(c,sessions,{env={},adminFactory=createClient,fetcher=fetch}={}){
  const rows=pins(c);need(sessions?.projectRef==='wtgxcptmucjerhufzjcf'&&env.NEXT_PUBLIC_SUPABASE_URL===AUTH,'wrong_auth_project');
  const guardedFetch=(input,init)=>{
    need(new URL(input instanceof Request?input.url:String(input)).origin===AUTH,'untrusted_auth_origin');
    return fetcher(input,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});
  };
  const admin=adminFactory(AUTH,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:guardedFetch}});
  let count=0;
  for(const [name,pin]of rows){const session=sessions.accounts?.[name];if(!session)continue;need(session.actorId===pin.userId&&session.profileId===pin.profileId,'cleanup_pin_mismatch');const result=await admin.auth.admin.signOut(session.oneAccessToken,'local');need(!result.error,'cleanup_failed');count++;}
  return {revokedAcceptanceSessions:count,scope:'local',existingSessionsUnchanged:true};
}
async function main(){
  const args=process.argv.slice(2);const arg=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  if(args.includes('--help')){console.log('auth-sessions.mjs --config D:\\private\\auth-config.json [--execute --output D:\\private\\sessions.json] [--revoke D:\\private\\sessions.json]');return;}
  const c=JSON.parse(readFileSync(privatePath(arg('--config')),'utf8'));
  const execute=args.includes('--execute')||!!arg('--revoke');
  const env=execute?parseEnvText(readFileSync(privatePath(c.oneEnvFile),'utf8')):{};
  if(arg('--revoke')){console.log(JSON.stringify(await revokeAcceptanceSessions(c,JSON.parse(readFileSync(privatePath(arg('--revoke')),'utf8')),{env})));return;}
  const output=execute?privatePath(arg('--output')):null;
  if(output)need(!existsSync(output),'session_output_already_exists');
  const persistSessions=output?value=>atomicPrivateJson(output,value):undefined;
  const result=await mintAcceptanceSessions(c,{execute,env,persistSessions});
  if(!execute){console.log(JSON.stringify(result));return;}
  console.log(JSON.stringify({mode:'sessions_created',accounts:Object.keys(result.accounts).length,emailsSent:0,passwordChanges:0,output:'private_file'}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({ok:false,code:safeSessionFailureCode(error)}));process.exitCode=1;});
