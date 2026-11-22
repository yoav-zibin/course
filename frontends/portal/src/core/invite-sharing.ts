export type InviteShareChannel='copy_code'|'share_link';
export type InviteShareResult='shared'|'copied'|'cancelled';

/** Record successful share/copy actions without waiting for analytics delivery. */
export async function performInviteShare(channel:InviteShareChannel,action:()=>Promise<InviteShareResult>,record:(channel:InviteShareChannel)=>Promise<unknown>):Promise<InviteShareResult>{
  const result=await action();
  if(result!=='cancelled')void Promise.resolve().then(()=>record(channel)).catch(()=>{});
  return result;
}
