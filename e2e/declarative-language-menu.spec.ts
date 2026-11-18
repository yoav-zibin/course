import fs from 'node:fs';
import {test, expect} from '@playwright/test';
import {createGame, createUser, loginAs, uniqueName} from './helpers';

declare const frame: any;
declare const state: any;
declare function render(): void;

test('visible account Preferences switch all locales without leaving or remounting native play', async ({page, request}, testInfo) => {
  test.setTimeout(120000);
  const game = await createGame(request, uniqueName('Native language menu'));
  const account = await createUser(request, uniqueName('Language player'));
  // Optional private sink for local audit runners that filter browser errors.
  if (process.env.E2E_ACCOUNT_SECRETS_FILE)
    fs.writeFileSync(process.env.E2E_ACCOUNT_SECRETS_FILE, JSON.stringify(account), {mode:0o600});
  await loginAs(page, account);
  await page.goto(`/static/portal.html#game=${game}`, {waitUntil:'domcontentloaded'});
  await page.locator('#practice').click();
  const stage = page.locator('#game-box .declarative-stage');
  await expect(stage).toBeVisible();
  await page.evaluate(() => {
    (window as any).languageMount = {host:frame.declarative, stage:document.querySelector('#game-box .declarative-stage'), id:state.match.id};
    (window as any).languageMessages = [];
    const send = frame.declarative.send.bind(frame.declarative);
    frame.declarative.send = async (message:any, options:any) => {
      const result = await send(message, options);
      (window as any).languageMessages.push({locale:message.locale, direction:message.direction, strings:message.strings});
      return result;
    };
  });
  await page.locator('#match-menu-toggle').click();
  await expect(page.locator('.match-toolbar #account-menu .auth-menu-button')).toBeVisible();
  for (const locale of ['es','en','fr','de','pt','zh','hi','ar','en']) {
    const toggle = page.locator('#account-menu .auth-menu-button');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const picker = page.locator('#portal-language-slot select');
    await picker.scrollIntoViewIfNeeded();
    await expect(picker).toBeVisible();
    await picker.focus();
    await page.evaluate(() => {for(let i=0;i<3;i++)render();});
    await expect(picker).toBeFocused();
    const saved = page.waitForResponse(response => response.request().method()==='PATCH' &&
      new URL(response.url()).pathname===`/users/${account.id}` && response.request().postDataJSON()?.locale===locale);
    await picker.selectOption(locale);
    expect((await saved).status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect.poll(() => page.evaluate(() => (window as any).languageMessages.at(-1)?.locale)).toBe(locale);
    await expect.poll(() => page.evaluate(() => frame.declarative.whenIdle().then(() => (window as any).languageMessages.at(-1)?.direction))).toBe(locale==='ar'?'rtl':'ltr');
    // Compare the actual packaged dictionary, including English's absent strings.
    const dictionary = locale==='en' ? null : await (await request.get(`/games/${game}/versions/1/strings?lang=${locale}`)).json();
    const observed = await page.evaluate(() => (window as any).languageMessages.at(-1));
    if (locale==='en') expect(observed.strings).toBeUndefined();
    else expect(observed.strings).toEqual(dictionary.strings);
    const title = dictionary?.strings?.title || 'Tic-tac-toe';
    await expect(page.locator('#game-box .declarative-scene-status')).toContainText(title);
    expect(await page.evaluate(() => {
      const old=(window as any).languageMount;
      return old.host===frame.declarative && old.stage===document.querySelector('#game-box .declarative-stage') && old.stage.isConnected && old.id===state.match.id && state.match.move_count===0;
    })).toBe(true);
    expect((await (await request.get(`/users/${account.id}`, {headers:{'X-User-Id':account.id,'X-User-Password':account.password}})).json()).locale).toBe(locale);
    for (const selector of ['#account-menu .auth-menu-button','#portal-language-slot select']) {
      const box=await page.locator(selector).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(32);expect(box!.height).toBeGreaterThanOrEqual(32);
    }
    const panel=await page.locator('#account-menu .auth-menu-panel').boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x+panel!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
  }
  await page.screenshot({path:testInfo.outputPath('native-language-preferences.png')});
  await page.locator('#account-menu .auth-menu-button').click();
  for (const viewport of [{width:320,height:480},{width:844,height:390},{width:768,height:1024},{width:1024,height:768}]) {
    await page.setViewportSize(viewport);
    const controls=page.locator('.match-toolbar > button:visible, .match-toolbar #account-menu .auth-menu-button');
    for (const control of await controls.all()) {
      await expect(control).toBeVisible();
      const bounds=(await control.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(32);expect(bounds.height).toBeGreaterThanOrEqual(32);
      expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width+1);
      expect(await control.evaluate(element=>{const b=element.getBoundingClientRect();return element.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
    }
    await page.screenshot({path:testInfo.outputPath(`native-menu-${viewport.width}x${viewport.height}.png`)});
  }
  await page.locator('#match-back').click();
  await expect(page.locator('body > .topbar #account-menu .auth-menu-button')).toBeVisible();
  await expect(page.locator('#account-menu')).toHaveCount(1);
});
