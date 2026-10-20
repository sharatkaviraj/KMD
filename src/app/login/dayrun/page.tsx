import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { DAYRUN } from '@/platform/auth/dayrun-policy';
import { readDayrunPair, dayrunEnvironment } from '@/platform/auth/dayrun-server';
import { createClient } from '@/platform/supabase/server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const metadata={title:'Overnight test sign-in',robots:{index:false,follow:false}};
export default async function DayrunLoginPage() {
 try { dayrunEnvironment(true); } catch { notFound(); }
 if((await headers()).get('host')!==new URL(DAYRUN.roleOrigin).host) notFound();
 const {data}=await (await createClient()).auth.getClaims();
 const signedIn=Boolean(data?.claims?.sub);
 const pair=signedIn?null:await readDayrunPair().catch(()=>undefined);
 if(pair===undefined) notFound();
 return <div className="vx" style={{minHeight:'100dvh',background:'var(--bg)',color:'var(--fg)',padding:32}}><main style={{maxWidth:620,margin:'auto',display:'grid',gap:16}}>
  <h1>Overnight test sign-in</h1>
  <p>Existing fictional QA accounts only. Application-route access through this launcher ends at 12:30 PM IST on 19 October 2026. Your admin tab stays signed in on the main hostname.</p>
  {signedIn?<><p>A session is already signed in on this test hostname.</p><a href="/dashboard">Return to the app</a><form method="post" action="/login/dayrun/end"><button className="tap btn" type="submit">End this test session</button></form></>:pair?<>
   <p>Pairing reference (not a password):</p><strong style={{overflowWrap:'anywhere'}}>{pair.id}</strong>
   <p>Ask Raj to approve this reference on the main hostname. This request expires after five minutes.</p>
   {pair.status==='authorized'?<form method="post" action="/login/dayrun/redeem"><button className="tap btn pri" type="submit">Open approved {pair.alias} session</button></form>:<><p>Status: {pair.status}</p><a href="/login/dayrun">Refresh approval status</a></>}
   <form method="post" action="/login/dayrun/request"><button className="tap btn" type="submit">Start a new pairing</button></form>
  </>:<form method="post" action="/login/dayrun/request"><button className="tap btn pri" type="submit">Request a test session</button></form>}
  <p>Only this hostname, {new URL(DAYRUN.roleOrigin).hostname}, receives the QA session. No sign-in link, password or key is copied.</p>
 </main></div>;
}
