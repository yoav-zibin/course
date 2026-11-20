import {test,expect,type APIRequestContext} from '@playwright/test';
import {createUser,loginAs,uniqueName} from './helpers';

const headers=(user:any)=>({'X-User-Id':user.id,'X-User-Password':user.password});
async function profile(request:APIRequestContext,user:any){
  const response=await request.get(`/users/${user.id}`,{headers:headers(user)});
  expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Daily reward acceptance requires a disposable loopback server.');
});

test('a retained verified session claims a real daily reward once and retains it across reloads',async({page,request},info)=>{
  const user={id:`daily-reward-${info.project.name}-${info.retry}`,password:'daily-reward-test-wallet'};
  const before=await profile(request,user);
  expect(before).toMatchObject({token_balance:10,free_tokens_granted:10,is_verified:true});
  const claims:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/auth/daily-login')claims.push(request.url());});
  await loginAs(page,{...before,...user});
  const granted=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/auth/daily-login');
  await page.goto('/portal');const response=await granted;expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({token_balance:20,free_tokens_granted:20,is_verified:true});
  await expect(page.getByTestId('header-token-balance')).toHaveAttribute('aria-label','20 tokens');
  const refresh=page.getByRole('button',{name:'Refresh',exact:true});await refresh.click();await expect(refresh).toBeEnabled();
  await page.reload();await expect(page.getByTestId('header-token-balance')).toHaveAttribute('aria-label','20 tokens');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await refresh.click();await expect(refresh).toBeEnabled();
  expect(claims).toHaveLength(1);
  expect(await profile(request,user)).toMatchObject({token_balance:20,free_tokens_granted:20,last_token_grant_day:new Date().toISOString().slice(0,10)});
});

test('a retained guest session receives no daily reward or daily claim requests',async({page,request})=>{
  const user=await createUser(request,uniqueName('Daily reward guest'));
  const claims:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/auth/daily-login')claims.push(request.url());});
  await loginAs(page,user);await page.goto('/portal');await expect(page.getByTestId('header-token-balance')).toHaveAttribute('aria-label','0 tokens');
  const refresh=page.getByRole('button',{name:'Refresh',exact:true});await refresh.click();await expect(refresh).toBeEnabled();
  await page.reload();await expect(page.getByTestId('header-token-balance')).toHaveAttribute('aria-label','0 tokens');
  await refresh.click();await expect(refresh).toBeEnabled();expect(claims).toHaveLength(0);
  expect(await profile(request,user)).toMatchObject({token_balance:0,free_tokens_granted:0,is_verified:false});
});
