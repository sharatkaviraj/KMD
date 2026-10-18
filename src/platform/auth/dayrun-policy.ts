import { DAYRUN_ORIGINS } from '@/platform/config/app-origins';

/** Fixed, owner-approved test scope. These identifiers are not credentials. */
export const DAYRUN = {
  id: 'overnight-20261019',
  origin: DAYRUN_ORIGINS.owner,
  roleOrigin: DAYRUN_ORIGINS.role,
  supabaseOrigin: 'https://wtgxcptmucjerhufzjcf.supabase.co',
  ownerStaffId: '30c6b4d7-df2d-4ae2-873f-221e3d2ee55d',
  ownerUserId: '94751583-3fbd-422b-b748-9104e85c1644',
  expiresAt: '2026-10-19T07:00:00Z',
  cookie: '__Host-vpps-dayrun-pair',
  aliases: ['admin','accountant','academic','exam','teacher','teacher2'],
} as const;
export type DayrunAccount = {alias:string;email:string;role:string;landing:string;isNew:boolean;userId?:string;staffProfileId?:string};
const EXISTING: readonly DayrunAccount[] = [
  {alias:'admin',email:'qa.admin@qa.vpps.local',role:'admin',landing:'/dashboard',isNew:false,userId:'3f64f814-5d57-4b1c-a860-725eb65efda7',staffProfileId:'1520b49a-5e25-4a53-8f3d-210a4d35fbeb'},
  {alias:'accountant',email:'qa.fees@qa.vpps.local',role:'accountant',landing:'/accounts',isNew:false,userId:'f8d35f69-debd-4273-8c03-13efca8a20d2',staffProfileId:'c96ffb1a-e9ef-4ced-abb5-54587bbb4908'},
  {alias:'academic',email:'qa.academic@qa.vpps.local',role:'academic_coordinator',landing:'/academics',isNew:false,userId:'8973f5dd-5f3b-4c15-9534-e804cab8db31',staffProfileId:'0f2ecc32-6c5a-4f90-b741-8dad29b77c4b'},
  {alias:'exam',email:'qa.exam@qa.vpps.local',role:'exam_coordinator',landing:'/exam-office',isNew:false,userId:'1b07ce9c-8f87-4d65-953a-91e2fddb4244',staffProfileId:'119ee211-fd46-421e-a6b2-9ea2aab4e5f7'},
  {alias:'teacher',email:'qa.teacher@qa.vpps.local',role:'teacher',landing:'/teach',isNew:false,userId:'392a7a49-5ec3-44db-a605-9f8dc057a292',staffProfileId:'29d76340-1929-4848-ad4f-8a3ae5653a43'},
  {alias:'teacher2',email:'qa.teacher2@qa.vpps.local',role:'teacher',landing:'/teach',isNew:false,userId:'cb4848e1-155c-44dd-b0b2-9d7b9815972e',staffProfileId:'b9805a93-f3ee-4e53-a0df-e053b5fcb795'},
];
export function accountForAlias(alias:unknown):DayrunAccount|null {
  if(typeof alias!=='string') return null;
  const existing=EXISTING.find(a=>a.alias===alias);
  if(existing) return {...existing};
  return null;
}
export function assertDayrunEnvironment(input:{supabaseUrl?:string;environment?:string;deploymentEnvironment?:string;now?:number;allowExpired?:boolean}):void {
  const now=input.now??Date.now();
  let url:URL; try {url=new URL(input.supabaseUrl??'');} catch {throw new Error('Dayrun unavailable');}
  if(url.origin!==DAYRUN.supabaseOrigin || url.username || url.password || url.pathname!=='/' || url.search || url.hash || input.environment!=='dev' || input.deploymentEnvironment!=='production' || !Number.isFinite(now) || (!input.allowExpired && now>=Date.parse(DAYRUN.expiresAt))) throw new Error('Dayrun unavailable');
}
export function assertDayrunOwner(staff:{id:string;userId:string;role:string;isActive:boolean}|null,verifiedUserId:string|undefined,previewing:boolean):void {
  if(!staff?.isActive || staff.role!=='admin' || staff.id!==DAYRUN.ownerStaffId || staff.userId!==DAYRUN.ownerUserId || verifiedUserId!==DAYRUN.ownerUserId || previewing) throw new Error('Dayrun unavailable');
}
export function assertDayrunOrigin(origin:string|null,url:string,kind:'owner'|'role'='owner'):void {
  const expected=kind==='owner'?DAYRUN.origin:DAYRUN.roleOrigin;
  if(origin!==expected || new URL(url).origin!==expected) throw new Error('Dayrun unavailable');
}
export function parsePairCookie(raw:string|undefined):{id:string;secret:string}|null {
  if(!raw) return null;
  const match=/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/.exec(raw);
  return match?{id:match[1],secret:match[2]}:null;
}
export function pairMatchesAccount(pair:{alias:string;email:string;role:string;user_id:string;staff_profile_id:string;is_new:boolean}):boolean {
  const a=accountForAlias(pair.alias);
  return Boolean(a && a.email===pair.email && a.role===pair.role && a.isNew===pair.is_new && a.userId===pair.user_id && a.staffProfileId===pair.staff_profile_id);
}
