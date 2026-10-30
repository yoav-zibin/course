import {test,expect} from '@playwright/test';
import {createUser,loginAs,uniqueName} from './helpers';
test('guided builder saves a draft, restores it, and never approves an empty step',async({page,request})=>{
 const user=await createUser(request,uniqueName('Designer'));await loginAs(page,user);
 await page.goto('/static/guided-builder.html');
 await page.getByRole('button',{name:'+ New game',exact:true}).click();
 await expect(page.locator('#workspace')).toBeVisible();
 await expect(page.locator('#steps button')).toHaveCount(6);
 await expect(page.locator('#approve')).toBeDisabled();
 const url=page.url();await page.reload();
 await expect(page.locator('#workspace')).toBeVisible();expect(page.url()).toBe(url);
 await page.locator('#steps button').nth(3).click();
 await expect(page.locator('#propose')).toBeDisabled();
 await page.locator('#steps button').first().click();
 await page.locator('#correction').fill('Count to three, a one-player game.');
 // Exercise a provider outage without invoking any paid generation.
 await page.route('**/workflow/propose',route=>route.fulfill({status:503,json:{detail:'Model unavailable for this test'}}));
 await page.locator('#propose').click();
 await expect(page.locator('#page-error')).toContainText('Model unavailable');
 await expect(page.locator('#approve')).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
