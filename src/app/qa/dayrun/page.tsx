import { notFound } from 'next/navigation';
import { DAYRUN, accountForAlias } from '@/platform/auth/dayrun-policy';
import { requireDayrunOwner, readDayrunOwnerState } from '@/platform/auth/dayrun-server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const metadata={title:'Overnight test launcher',robots:{index:false,follow:false}};
export default async function DayrunOwnerPage() {
 await requireDayrunOwner().catch(()=>notFound());
 const {run,pairs,usable}=await readDayrunOwnerState().catch(()=>notFound());
 return <div className="vx" style={{minHeight:'100dvh',background:'var(--bg)',color:'var(--fg)',padding:32}}><main style={{maxWidth:760,margin:'auto',display:'grid',gap:16}}>
  <h1>Overnight test launcher</h1>
  <p>Raj-only control for six existing QA accounts. No accounts, profiles, class assignments or passwords are created. Teacher accounts retain their existing Class 1 and Class 6 mappings.</p>
  <p>Run: {run.revoked_at?'Revoked':run.enabled?'Enabled':'Disabled'}. VPPS One application-route access expires at 12:30 PM IST on 19 October 2026.</p>
  <p>Each test session is separately leased and revocable here. Direct Supabase access, including VPPS One tables, public-schema data and Storage, retains the existing QA permissions. Expiry and revocation here apply only to application routes, not raw database or Storage access. Existing non-launcher sessions keep their normal access.</p>
  {!run.enabled && usable?<form method="post" action="/api/qa/dayrun"><input type="hidden" name="operation" value="activate"/><button className="tap btn pri" type="submit">Enable this bounded test run</button></form>:null}
  {run.enabled && usable?<><a href={DAYRUN.roleOrigin+'/login/dayrun'} target="_blank" rel="noreferrer">Open the separate QA hostname</a><p>In that tab, request a session. Match its reference and hostname below before approving. This screen never displays a credential.</p>
   {pairs?.map(pair=><form key={pair.id} method="post" action="/api/qa/dayrun" className="card" style={{padding:16,display:'grid',gap:12}}>
    <strong style={{overflowWrap:'anywhere'}}>{pair.id}</strong><span>{pair.target_origin}</span><span>Expires: {pair.expires_at}</span>
    <input type="hidden" name="operation" value="approve"/><input type="hidden" name="pairId" value={pair.id}/>
    <label>QA role <select name="alias" defaultValue="teacher">{DAYRUN.aliases.map(alias=><option key={alias} value={alias}>{alias} · {accountForAlias(alias)?.role}</option>)}</select></label>
    <button className="tap btn pri" type="submit">Approve this exact pairing</button>
   </form>)}<a href="/qa/dayrun">Refresh pairing requests</a></>:null}
  {!run.revoked_at?<form method="post" action="/api/qa/dayrun"><input type="hidden" name="operation" value="revoke"/><button className="tap btn" type="submit">Revoke the whole test run</button></form>:null}
  <a href="/dashboard">Return to admin dashboard</a>
 </main></div>;
}
