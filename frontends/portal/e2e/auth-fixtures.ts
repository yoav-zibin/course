import {expect,type Page} from '@playwright/test';

/** Disposable-loopback provider fixture; no Google, email or SMS service runs. */
export async function verifiedSignInFixtures(page:Page,accounts:any[]){
  await page.route('**/auth/config',route=>route.fulfill({json:{google_client_id:'fixture-google-client',email_login_enabled:true,phone_login_enabled:true}}));
  await page.addInitScript(()=>{
    if(window!==window.top)return;
    const state={token:'',callbacks:[] as ((result:any)=>void)[],current:null as null|((result:any)=>void)};
    (window as any).__testGoogle=state;
    (window as any).google={accounts:{id:{
      initialize({callback}:any){state.current=callback;state.callbacks.push(callback);},
      renderButton(holder:HTMLElement){const button=document.createElement('button');button.textContent='Test Google sign-in';button.onclick=()=>state.current?.({credential:state.token});holder.appendChild(button);},
    }}};
  });
  await page.route('**/auth/google',async route=>{
    const account=accounts.find(account=>account.id===route.request().postDataJSON().id_token);
    if(!account)return route.fulfill({status:401,json:{detail:'Unknown disposable provider fixture'}});
    await route.fulfill({json:{...account,user_id:account.id,linked_accounts:account.linked?.length?account.linked:[{kind:'google'}]}});
  });
}

export async function seedAccounts(page:Page,accounts:any[]){
  await page.addInitScript(accounts=>{
    if(window!==window.top||sessionStorage.getItem('auth-fixture-seeded'))return;
    localStorage.setItem('game-platform.accounts.v1',JSON.stringify(accounts));localStorage.setItem('game-platform.current-account.v1',accounts[0].id);sessionStorage.setItem('auth-fixture-seeded','yes');
  },accounts);
}

export async function signInWithGoogleFixture(page:Page,account:any){
  await page.evaluate(id=>{(window as any).__testGoogle.token=id;},account.id);
  await page.getByRole('button',{name:'Test Google sign-in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(account.display_name);
  await expect(page.getByRole('button',{name:'Test Google sign-in',exact:true})).toHaveCount(0);
}

export async function logoutAndSignIn(page:Page,account:any){
  const logout=page.getByRole('button',{name:'Log out',exact:true});
  if(!await logout.isVisible())await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await logout.click();
  await expect(page.getByRole('button',{name:'Log in',exact:true}).first()).toBeEnabled();
  await page.getByRole('button',{name:'Log in',exact:true}).first().click();
  await signInWithGoogleFixture(page,account);
}
