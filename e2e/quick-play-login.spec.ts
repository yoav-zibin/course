import { test, expect } from '@playwright/test';

test('Quick Play is optional and switching back restores standard login', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#welcome-guest-name')).toBeVisible();
  await page.getByText('Try Quick Play login').click();
  await expect(page.getByRole('button',{name:'Play as a guest'})).toBeVisible();
  await expect(page.locator('#welcome-guest-name')).toHaveCount(0);
  await page.getByText('Use standard login').click();
  await expect(page.locator('#welcome-guest-name')).toBeVisible();
});
test('guest signup preserves the invitation and return destination',async({page})=>{
  await page.route('**/invites/example',r=>r.fulfill({json:{game_name:'Chess'}}));
  await page.goto('/?login=quick-play&next='+encodeURIComponent('/static/portal.html#invite=example'));
  await expect(page.getByText('You’re invited to play Chess.')).toBeVisible();
  const request=page.waitForRequest(r=>new URL(r.url()).pathname==='/users' && r.method()==='POST');
  await page.route('**/users',r=>r.fulfill({json:{id:'guest1',password:'mock',display_name:'Guest 1'}}));
  await page.getByRole('button',{name:'Play as a guest'}).click();
  expect((await request).postDataJSON().invite_token).toBe('example');
  await expect(page).toHaveURL(/portal.html#invite=example/);
});
test('phone verification supports changing destination, resending, and returning to a match',async({page})=>{
  await page.route('**/auth/config',r=>r.fulfill({json:{phone_login_enabled:true,email_login_enabled:true}}));
  let sends=0;
  await page.route('**/auth/phone/start',r=>r.fulfill({json:{verification_id:'v'+(++sends),expires_in_seconds:600}}));
  await page.route('**/auth/phone/verify',r=>r.fulfill({json:{user_id:'demo',password:'mock',display_name:'Demo',linked_accounts:[]}}));
  await page.goto('/?login=quick-play&next='+encodeURIComponent('/static/portal.html#match=test'));
  await page.getByText('Sign in to an existing account').click();
  await expect(page.getByText('Continue with Google')).toHaveCount(0);
  await page.getByText('Continue with phone').click();
  await page.getByLabel('Phone number').fill('+15551234567');
  await page.getByText('Text me a code').click();
  await expect(page.getByText(/Sent to •••• 4567/)).toBeVisible();
  await page.getByText('Change number').click();
  await page.getByLabel('Phone number').fill('+15551234568');
  await page.getByText('Text me a code').click();
  await page.getByText('Send another code').click();
  await expect.poll(()=>sends).toBe(3);
  await expect(page.locator(".quick-play-actions")).not.toHaveAttribute("aria-busy","true");
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByText('Verify and join').click();
  await expect(page).toHaveURL(/portal.html#match=test/);
});
