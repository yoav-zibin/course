import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {createUser,loginAs,uniqueName} from './helpers';
import copy from '../src/platform/ui-copy.json';

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Deletion checks require a disposable loopback server.');
});
const headers=(user:any)=>({'X-User-Id':user.id,'X-User-Password':user.password});
async function profile(request:APIRequestContext,user:any){const response=await request.get(`/users/${user.id}`,{headers:headers(user)});expect(response.ok()).toBeTruthy();return response.json();}
async function openAccount(page:Page){await page.getByRole('button',{name:'Account menu',exact:true}).click();return page.getByRole('dialog');}
const deletionResponse=(page:Page,method:string)=>page.waitForResponse(response=>response.request().method()===method&&new URL(response.url()).pathname==='/users/me/deletion-request');

test('public deletion instructions explain login, profile, confirmation and the undo window',async({page})=>{
  await page.goto('/delete-account');
  await expect(page.getByRole('heading',{name:'Delete your BuildPlay account',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Open BuildPlay',exact:true})).toHaveAttribute('href','/portal');
  await expect(page.locator('ol')).toContainText('log in to the account you want to delete');
  await expect(page.locator('ol')).toContainText('Open your profile');
  await expect(page.locator('ol')).toContainText('Confirm account deletion');
  await expect(page.getByRole('heading',{name:'How to undo a request',exact:true})).toBeVisible();
  await expect(page.locator('body')).toContainText('permanent deletion may take up to another hour');
  await expect(page.locator('body')).not.toContainText('Send an email');
});

test('confirmation dismissals do not mutate and a confirmed request survives reload until undo',async({page,request,context})=>{
  const user=await createUser(request,uniqueName('Deletion undo'));
  await loginAs(page,user);await page.goto('/portal');
  const mutations:string[]=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/users/me/deletion-request')mutations.push(r.method());});
  let dialog=await openAccount(page);
  await dialog.getByRole('button',{name:'Request account deletion',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Delete this account?',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('deletion-confirmation.png')});
  await dialog.getByRole('button',{name:'Keep my account',exact:true}).click();
  expect(mutations).toEqual([]);expect((await profile(request,user)).deletion_scheduled_at).toBeNull();
  await dialog.getByRole('button',{name:'Request account deletion',exact:true}).click();
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  expect(mutations).toEqual([]);
  dialog=await openAccount(page);
  await expect(dialog.getByTestId('account-deletion-confirmation')).toHaveCount(0);
  await context.setOffline(true);
  await expect(dialog.getByRole('button',{name:'Request account deletion',exact:true})).toBeDisabled();
  await context.setOffline(false);
  await expect(dialog.getByRole('button',{name:'Request account deletion',exact:true})).toBeEnabled({timeout:15000});
  await dialog.getByRole('button',{name:'Request account deletion',exact:true}).click();
  const scheduled=deletionResponse(page,'POST');
  await dialog.getByRole('button',{name:'Confirm account deletion',exact:true}).click();
  const response=await scheduled;expect(response.status()).toBe(200);const accepted=await response.json();
  await expect(dialog.getByTestId('account-deletion-status')).toContainText('Account deletion scheduled');
  const deadline=await page.evaluate(value=>new Date(value).toLocaleString('en'),accepted.deletion_scheduled_at);
  await expect(dialog.getByTestId('account-deletion-status')).toContainText(deadline);
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByTestId('account-deletion-warning')).toBeVisible();
  await page.screenshot({path:test.info().outputPath('deletion-scheduled.png')});
  await page.reload();
  await expect(page.getByTestId('account-deletion-warning')).toContainText(deadline,{timeout:15000});
  expect((await profile(request,user)).deletion_scheduled_at).toBe(accepted.deletion_scheduled_at);
  const undone=deletionResponse(page,'DELETE');
  await page.getByTestId('account-deletion-warning').getByRole('button',{name:'Undo account deletion',exact:true}).click();
  expect((await undone).status()).toBe(200);
  await expect(page.getByTestId('account-deletion-warning')).toHaveCount(0);
  expect((await profile(request,user)).deletion_scheduled_at).toBeNull();
  dialog=await openAccount(page);await expect(dialog.getByRole('button',{name:'Request account deletion',exact:true})).toBeVisible();
  expect(mutations).toEqual(['POST','DELETE']);
});

test('a saved request and its confirmation remain isolated to the selected account',async({page,request})=>{
  const alice=await createUser(request,uniqueName('Deletion Alice')),bob=await createUser(request,uniqueName('Deletion Bob'));
  await page.addInitScript(({alice,bob})=>{localStorage.setItem('game-platform.accounts.v1',JSON.stringify([alice,bob]));localStorage.setItem('game-platform.current-account.v1',alice.id);},{alice,bob});
  await page.goto('/portal');let dialog=await openAccount(page);
  await dialog.getByRole('button',{name:'Request account deletion',exact:true}).click();
  const accepted=deletionResponse(page,'POST');await dialog.getByRole('button',{name:'Confirm account deletion',exact:true}).click();expect((await accepted).status()).toBe(200);
  await dialog.getByRole('button',{name:bob.display_name,exact:true}).click();
  await expect(dialog).toHaveCount(0);dialog=await openAccount(page);
  await expect(dialog.getByRole('heading',{name:bob.display_name,exact:true})).toBeVisible();
  await expect(dialog.getByTestId('account-deletion-status')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Request account deletion',exact:true}).click();
  await expect(dialog.getByTestId('account-deletion-confirmation')).toBeVisible();
  await dialog.getByRole('button',{name:alice.display_name,exact:true}).click();
  await expect(dialog).toHaveCount(0);dialog=await openAccount(page);
  await expect(dialog.getByTestId('account-deletion-confirmation')).toHaveCount(0);
  await expect(dialog.getByTestId('account-deletion-status')).toBeVisible();
  expect((await profile(request,bob)).deletion_scheduled_at).toBeNull();
  const undone=deletionResponse(page,'DELETE');await dialog.getByRole('button',{name:'Undo account deletion',exact:true}).click();expect((await undone).status()).toBe(200);
  expect((await profile(request,alice)).deletion_scheduled_at).toBeNull();
});

test('the translated profile confirmation can be dismissed without a deletion request',async({page,request})=>{
  const user=await createUser(request,uniqueName('Deletion Arabic'));await loginAs(page,user);await page.goto('/portal');
  const dialog=await openAccount(page);await dialog.getByRole('button').filter({hasText:'العربية'}).last().click();
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await dialog.getByRole('button',{name:copy['Request account deletion'].ar,exact:true}).click();
  await expect(dialog.getByRole('button',{name:copy['Confirm account deletion'].ar,exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:copy['Keep my account'].ar,exact:true}).click();
  expect((await profile(request,user)).deletion_scheduled_at).toBeNull();
});
