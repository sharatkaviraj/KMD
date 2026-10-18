import { test } from 'vitest';
import assert from 'node:assert/strict';
import { assertDayrunEnvironment, assertDayrunOwner, assertDayrunOrigin, accountForAlias, parsePairCookie, DAYRUN } from '../src/platform/auth/dayrun-policy';
const valid={supabaseUrl:'https://wtgxcptmucjerhufzjcf.supabase.co',environment:'dev',deploymentEnvironment:'production',now:Date.parse('2026-10-18T20:00:00Z')};
const owner={id:'30c6b4d7-df2d-4ae2-873f-221e3d2ee55d',userId:'94751583-3fbd-422b-b748-9104e85c1644',role:'admin',isActive:true};
test('exact dev project and finite overnight window are required',()=>{
 assert.doesNotThrow(()=>assertDayrunEnvironment(valid));
 for(const change of [{supabaseUrl:'https://vgqyilgstjvgohrsiwkb.supabase.co'},{supabaseUrl:'http://127.0.0.1:54321'},{supabaseUrl:'https://wtgxcptmucjerhufzjcf.supabase.co.evil.test'},{supabaseUrl:'https://evil.test/?wtgxcptmucjerhufzjcf'},{environment:'live'},{environment:undefined},{deploymentEnvironment:'preview'},{deploymentEnvironment:undefined},{now:Date.parse('2026-10-19T07:00:00Z')},{now:NaN}]) assert.throws(()=>assertDayrunEnvironment({...valid,...change}));
});
test('exact live-verified owner identity, role and non-preview state required',()=>{
 assert.doesNotThrow(()=>assertDayrunOwner(owner,owner.userId,false));
 for(const change of [{id:'different'},{userId:'different'},{role:'teacher'},{isActive:false}]) assert.throws(()=>assertDayrunOwner({...owner,...change},owner.userId,false));
 assert.throws(()=>assertDayrunOwner(owner,'different',false));
 assert.throws(()=>assertDayrunOwner(owner,owner.userId,true));
 assert.throws(()=>assertDayrunOwner(null,owner.userId,false));
});
test('POST origin is exact, HTTPS and present; hostile forwarded hosts irrelevant',()=>{
 assert.doesNotThrow(()=>assertDayrunOrigin('https://vppsone.vercel.app','https://vppsone.vercel.app/login/dayrun/request'));
 for(const origin of [null,'null','http://vppsone.vercel.app','https://vppsone.vercel.app.evil.test','https://evil.test','https://vppsone.vercel.app/']) assert.throws(()=>assertDayrunOrigin(origin,'https://vppsone.vercel.app/login/dayrun/request'));
 assert.throws(()=>assertDayrunOrigin('https://vppsone.vercel.app','https://preview.vercel.app/login/dayrun/request'));
});
test('fixed role aliases cannot substitute arbitrary emails or external landings',()=>{
 assert.equal(accountForAlias('accountant')?.email,'qa.fees@qa.vpps.local');
 assert.equal(accountForAlias('teacher03'),null);
 for(const key of ['teacher13','admin@example.com','teacher/../admin','__proto__','constructor','']) assert.equal(accountForAlias(key),null);
 for(const alias of DAYRUN.aliases) assert.match(accountForAlias(alias)!.landing,/^\/(teach|accounts|academics|exam-office|dashboard)$/);
});
test('pair cookie requires exact UUID plus opaque 256-bit secret',()=>{
 const id='3020e46b-8fc9-4f4c-b9a0-cdf9514f1311',secret='a'.repeat(43);
 assert.deepEqual(parsePairCookie(`${id}.${secret}`),{id,secret});
 for(const raw of [undefined,'',id,`${id}.short`,`${id}.${secret}.extra`,`notuuid.${secret}`]) assert.equal(parsePairCookie(raw),null);
});

test('role origin cannot impersonate owner origin or cross-post between allowed origins',()=>{assert.doesNotThrow(()=>assertDayrunOrigin(DAYRUN.roleOrigin,DAYRUN.roleOrigin+'/login/dayrun/request','role'));assert.throws(()=>assertDayrunOrigin(DAYRUN.origin,DAYRUN.roleOrigin+'/login/dayrun/request','role'));assert.throws(()=>assertDayrunOrigin(DAYRUN.roleOrigin,DAYRUN.origin+'/api/qa/dayrun'));});
