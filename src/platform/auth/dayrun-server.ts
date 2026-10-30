import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/platform/supabase/admin';
import { createClient } from '@/platform/supabase/server';
import { getCurrentStaff } from '@/platform/auth/current-staff';
import { admitSignedInUser } from '@/platform/auth/admit';
import { toolAccountAccess } from '@/platform/deployment/tool-access';
import { VIEW_AS_COOKIE } from '@/vx/view-as';
import { getRequiredEnvVar } from '@/platform/env';
import { DAYRUN, accountForAlias, assertDayrunEnvironment, assertDayrunOrigin, assertDayrunOwner, parsePairCookie } from '@/platform/auth/dayrun-policy';
import { redeemDayrun, type DayrunPair } from '@/platform/auth/dayrun-redemption';

function requestHasAuthCookie(request:NextRequest) {
 return request.cookies.getAll().some(cookie=>/^sb-wtgxcptmucjerhufzjcf-auth-token(?:\.\d+)?$/.test(cookie.name));
}
export const dayrunHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function dayrunEnvironment(allowExpired=false) {
 assertDayrunEnvironment({supabaseUrl:process.env.NEXT_PUBLIC_SUPABASE_URL,environment:process.env.VPPSONE_ENV,deploymentEnvironment:process.env.VERCEL_ENV,allowExpired});
}
export async function requireDayrunOwner() {
 dayrunEnvironment(true);
 if((await headers()).get('host')!==new URL(DAYRUN.origin).host) throw new Error('Dayrun unavailable');
 const client=await createClient();
 const [{data:verified,error},{data:claims,error:claimsError},staff,jar]=await Promise.all([client.auth.getUser(),client.auth.getClaims(),getCurrentStaff(),cookies()]);
 if(error || claimsError) throw new Error('Dayrun unavailable');
 assertDayrunOwner(staff,verified.user?.id,Boolean(jar.get(VIEW_AS_COOKIE)?.value));
 const sessionId=claims?.claims?.session_id;
 if(typeof sessionId!=='string') throw new Error('Dayrun unavailable');
 const {data:current,error:sessionError}=await createAdminClient().rpc('qa_dayrun_owner_session_valid',{p_session_id:sessionId});
 if(sessionError || current!==true) throw new Error('Dayrun unavailable');
 return staff!;
}
export async function requireActiveDayrun() {
 dayrunEnvironment();
 const {data,error}=await createAdminClient().from('qa_dayrun_runs').select('enabled,revoked_at,expires_at').eq('id',DAYRUN.id).maybeSingle();
 if(error || !data?.enabled || data.revoked_at || Date.parse(data.expires_at)<=Date.now()) throw new Error('Dayrun unavailable');
}
export function dayrunResponse(path:string,status=303,origin:string=DAYRUN.origin) {
 if(origin!==DAYRUN.origin && origin!==DAYRUN.roleOrigin) throw new Error('Dayrun unavailable');
 const response=NextResponse.redirect(new URL(path,origin),status);
 response.headers.set('Cache-Control','private, no-store');
 response.headers.set('Referrer-Policy','no-referrer');
 response.headers.set('X-Content-Type-Options','nosniff');
 return response;
}
export function dayrunRefusal() { return dayrunResponse('/login/dayrun?status=unavailable',303,DAYRUN.roleOrigin); }
export async function requestDayrunPair(request:NextRequest) {
 assertDayrunOrigin(request.headers.get('origin'),request.url,'role');
 await requireActiveDayrun();
 const client=await createClient();
 const {data:claims,error:claimsError}=await client.auth.getClaims();
 if((claimsError && (requestHasAuthCookie(request) || claimsError.name!=='AuthSessionMissingError')) || (requestHasAuthCookie(request) && !claims?.claims?.sub)) throw new Error('Existing session could not be verified');
 if(claims?.claims?.sub) throw new Error('Use a separate signed-out browser');
 const secret=randomBytes(32).toString('base64url');
 const minute=Math.floor(Date.now()/60000);
 const requestKey=dayrunHash(`${DAYRUN.id}:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'unknown'}:${minute}`);
 const {data,error}=await createAdminClient().rpc('qa_dayrun_create_pair',{p_secret_hash:dayrunHash(secret),p_request_key_hash:requestKey,p_target_origin:DAYRUN.roleOrigin});
 if(error || !data?.id) throw new Error('Pairing unavailable');
 const response=dayrunResponse('/login/dayrun',303,DAYRUN.roleOrigin);
 response.cookies.set(DAYRUN.cookie,`${data.id}.${secret}`,{secure:true,httpOnly:true,sameSite:'strict',path:'/',maxAge:300});
 return response;
}
export async function readDayrunPair() {
 if((await headers()).get('host')!==new URL(DAYRUN.roleOrigin).host) throw new Error('Dayrun unavailable');
 await requireActiveDayrun();
 const parsed=parsePairCookie((await cookies()).get(DAYRUN.cookie)?.value);
 if(!parsed) return null;
 const {data,error}=await createAdminClient().from('qa_dayrun_pairs').select('id,status,alias,expires_at').eq('id',parsed.id).eq('secret_hash',dayrunHash(parsed.secret)).eq('target_origin',DAYRUN.roleOrigin).maybeSingle();
 if(error) throw new Error('Pairing unavailable');
 if(!data || Date.parse(data.expires_at)<=Date.now()) return null;
 // Only this nonsecret DTO may reach the page. Never return the hash/cookie.
 return {id:String(data.id),status:String(data.status),alias:data.alias?String(data.alias):null};
}
export async function redeemDayrunPair(request:NextRequest) {
 assertDayrunOrigin(request.headers.get('origin'),request.url,'role');
 await requireActiveDayrun();
 const parsed=parsePairCookie(request.cookies.get(DAYRUN.cookie)?.value);
 if(!parsed) throw new Error('Pairing unavailable');
 const original=await createClient();
 const {data:originalClaims,error:originalError}=await original.auth.getClaims();
 if((originalError && (requestHasAuthCookie(request) || originalError.name!=='AuthSessionMissingError')) || (requestHasAuthCookie(request) && !originalClaims?.claims?.sub)) throw new Error('Existing session could not be verified');
 const admin=createAdminClient();
 // Do not use Next's cookies() for this client: no auth cookies may be sent
 // until exact identity, persisted lease and normal admission all succeed.
 const buffered:Array<{name:string;value:string;options:CookieOptions}>=[];
 const cookieMap=new Map<string,{name:string;value:string}>();
 const cookieStore={
   getAll:()=>[...cookieMap.values()],
   setAll:(values:Array<{name:string;value:string;options:CookieOptions}>)=>{for(const v of values){cookieMap.set(v.name,{name:v.name,value:v.value});buffered.push(v);}},
 };
 const target=createServerClient(DAYRUN.supabaseOrigin,getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),{db:{schema:'vppsone'},cookieOptions:{secure:true,path:'/'},cookies:cookieStore});
 let selectedUserId:string|null=null;
 let selectedStaffId:string|null=null;
 const result=await redeemDayrun({pairId:parsed.id,secretHash:dayrunHash(parsed.secret),alreadySignedIn:Boolean(originalClaims?.claims?.sub),targetOrigin:DAYRUN.roleOrigin}, {
   consume:async(id,hash,origin)=>{
    const {data,error}=await admin.rpc('qa_dayrun_consume_pair',{p_pair_id:id,p_secret_hash:hash,p_target_origin:origin});
    if(error || !data?.user_id) throw new Error('Pairing unavailable');
    selectedUserId=data.user_id;
    selectedStaffId=data.staff_profile_id;
    return data as DayrunPair;
   },
   user:async(id)=>{
    const {data,error}=await admin.auth.admin.getUserById(id);
    if(error || !data.user) throw new Error('Account unavailable');
    return {id:data.user.id,email:data.user.email,appMetadata:data.user.app_metadata};
   },
   mint:async(email)=>{
    // Confined, not banned (D-346): on a production database a day-run seat
    // signs in only as a test account. Checked before a token exists.
    const access=await toolAccountAccess({staffProfileId:selectedStaffId});
    if(!access.ok) throw new Error('Account unavailable');
    const {data,error}=await admin.auth.admin.generateLink({type:'magiclink',email});
    if(error || !data?.properties?.hashed_token || data.user?.id!==selectedUserId) throw new Error('Account unavailable');
    return data.properties.hashed_token;
   },
   verify:async(hash)=>{
    const {data,error}=await target.auth.verifyOtp({type:'magiclink',token_hash:hash});
    if(error || !data.user) throw new Error('Sign-in unavailable');
    const {data:claims,error:claimError}=await target.auth.getClaims();
    const sessionId=claims?.claims?.session_id;
    if(claimError || typeof sessionId!=='string') throw new Error('Session unavailable');
    return {userId:data.user.id,sessionId};
   },
   register:async(pair,sessionId)=>{
    const {data,error}=await admin.rpc('qa_dayrun_complete_pair',{p_pair_id:pair.id,p_session_id:sessionId,p_user_id:pair.user_id});
    if(error || data!==true) throw new Error('Session unavailable');
   },
   admit:async()=>{
    const admitted=await admitSignedInUser(target,selectedUserId!,{signOutScope:'local',expectedStaffProfileId:selectedStaffId!});
    if(!admitted.ok) throw new Error('Account unavailable');
    return {role:admitted.staff.role,staffProfileId:selectedStaffId!};
   },
   invalidate:async(sessionId)=>{
    if(sessionId) {
      const {error}=await admin.rpc('qa_dayrun_revoke_session',{p_session_id:sessionId});
      if(error) throw new Error('Session revocation pending');
    }
    await target.auth.signOut({scope:'local'});
    buffered.length=0;
   },
   fail:async(id)=>{await admin.rpc('qa_dayrun_fail_pair',{p_pair_id:id,p_secret_hash:dayrunHash(parsed.secret)});},
 });
 const response=dayrunResponse(result.landing,303,DAYRUN.roleOrigin);
 for(const item of buffered) response.cookies.set(item.name,item.value,{...item.options,secure:true,path:'/',domain:undefined});
 response.cookies.set(DAYRUN.cookie,'',{secure:true,httpOnly:true,sameSite:'strict',path:'/',maxAge:0});
 return response;
}
export async function administerDayrun(request:NextRequest) {
 assertDayrunOrigin(request.headers.get('origin'),request.url);
 const owner=await requireDayrunOwner();
 const form=await request.formData();
 const operation=form.get('operation');
 const admin=createAdminClient();
 if(operation==='approve') {
  await requireActiveDayrun();
  const alias=form.get('alias'),pairId=form.get('pairId');
  const account=accountForAlias(alias);
  // First rollout deliberately borrows only six existing QA accounts.
  // New identities remain disabled until inherited direct access is reviewed.
  if(!account || account.isNew || typeof pairId!=='string' || !/^[0-9a-f-]{36}$/.test(pairId)) throw new Error('Pairing unavailable');
  const {data,error}=await admin.rpc('qa_dayrun_approve_pair',{p_pair_id:pairId,p_alias:account.alias,p_owner_user_id:owner.userId});
  if(error || data!==true) throw new Error('Approval unavailable');
 } else if(operation==='activate') {
  const {data,error}=await admin.rpc('qa_dayrun_activate',{p_owner_user_id:owner.userId});
  if(error || data!==true) throw new Error('Activation unavailable');
 } else if(operation==='revoke') {
  const {data,error}=await admin.rpc('qa_dayrun_revoke');
  if(error || !data) throw new Error('Revocation unavailable');
 } else throw new Error('Action unavailable');
 return dayrunResponse('/qa/dayrun?status=saved');
}

/** Ends only this QA session; never signs out the owner's other host or existing QA sessions. */
export async function endDayrunSession(request:NextRequest) {
 assertDayrunOrigin(request.headers.get('origin'),request.url,'role');
 dayrunEnvironment(true);
 const client=await createClient();
 const {data,error:claimsError}=await client.auth.getClaims();
 if(claimsError && (requestHasAuthCookie(request) || claimsError.name!=='AuthSessionMissingError')) throw new Error('Session could not be verified');
 const sessionId=data?.claims?.session_id;
 if(typeof sessionId==='string') {
  const admin=createAdminClient();
  const {data:lease,error}=await admin.from('qa_dayrun_sessions').select('session_id').eq('run_id',DAYRUN.id).eq('session_id',sessionId).maybeSingle();
  if(error || !lease) throw new Error('Not a dayrun session');
  const {error:revokeError}=await admin.rpc('qa_dayrun_revoke_session',{p_session_id:sessionId});
  if(revokeError) throw new Error('Session revocation pending');
  const {error:signOutError}=await client.auth.signOut({scope:'local'});
  if(signOutError) throw new Error('Session ended; local sign-out needs retry');
 }
 const response=dayrunResponse('/login/dayrun',303,DAYRUN.roleOrigin);
 response.cookies.set(DAYRUN.cookie,'',{secure:true,httpOnly:true,sameSite:'strict',path:'/',maxAge:0});
 return response;
}

export async function readDayrunOwnerState() {
 const admin=createAdminClient();
 const now=Date.now();
 const [{data:run,error},{data:pairs,error:pairError}]=await Promise.all([
  admin.from('qa_dayrun_runs').select('enabled,expires_at,revoked_at').eq('id',DAYRUN.id).maybeSingle(),
  admin.from('qa_dayrun_pairs').select('id,target_origin,status,expires_at').eq('run_id',DAYRUN.id).eq('status','pending').gt('expires_at',new Date(now).toISOString()).order('created_at',{ascending:false}).limit(25),
 ]);
 if(error || pairError || !run) throw new Error('Dayrun unavailable');
 return {run,pairs,usable:!run.revoked_at && Date.parse(run.expires_at)>now};
}
