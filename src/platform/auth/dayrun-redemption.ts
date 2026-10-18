import { accountForAlias, pairMatchesAccount } from './dayrun-policy';
export type DayrunPair = {id:string;alias:string;email:string;role:string;is_new:boolean;user_id:string;staff_profile_id:string;target_origin:string};
export type RedemptionPorts = {
 consume:(id:string,hash:string,origin:string)=>Promise<DayrunPair>;
 user:(id:string)=>Promise<{id:string;email:string|undefined;appMetadata:Record<string,unknown>}>;
 mint:(email:string)=>Promise<string>;
 verify:(hash:string)=>Promise<{userId:string;sessionId:string}>;
 register:(pair:DayrunPair,sessionId:string)=>Promise<void>;
 admit:()=>Promise<{role:string;staffProfileId:string}>;
 invalidate:(sessionId:string|null)=>Promise<void>;
 fail:(id:string)=>Promise<void>;
};
/** Never returns a credential. Caller must not emit its buffered cookies on failure. */
export async function redeemDayrun(input:{pairId:string;secretHash:string;alreadySignedIn:boolean;targetOrigin:string},ports:RedemptionPorts):Promise<{landing:string;alias:string}> {
 if(input.alreadySignedIn) throw new Error('Use a separate signed-out browser');
 let sessionId:string|null=null;
 let consumed=false;
 try {
  const pair=await ports.consume(input.pairId,input.secretHash,input.targetOrigin);
  consumed=true;
  if(!pairMatchesAccount(pair) || pair.id!==input.pairId || pair.target_origin!==input.targetOrigin) throw new Error('Unapproved identity');
  const account=accountForAlias(pair.alias)!;
  const user=await ports.user(pair.user_id);
  if(user.id!==pair.user_id || user.email?.toLowerCase()!==account.email) throw new Error('Unapproved identity');
  const hash=await ports.mint(account.email);
  const verified=await ports.verify(hash);
  sessionId=verified.sessionId;
  if(verified.userId!==pair.user_id || !sessionId) throw new Error('Identity changed');
  await ports.register(pair,sessionId);
  const admitted=await ports.admit();
  if(admitted.role!==account.role || admitted.staffProfileId!==pair.staff_profile_id) throw new Error('Role changed');
  return {landing:account.landing,alias:account.alias};
 } catch {
  // Deny in our lease registry first; refresh revocation is a second barrier.
  if(consumed) {
   await ports.invalidate(sessionId).catch(()=>undefined);
   await ports.fail(input.pairId).catch(()=>undefined);
  }
  throw new Error('Sign-in was not completed. Start a new pairing.');
 }
}
