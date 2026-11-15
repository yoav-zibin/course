import {test,expect} from '@playwright/test';

test('native accessible names stay separate from artwork and hide covered identities',async({page},info)=>{
  await page.goto('/static/declarative-test.html');
  const spec=await page.locator('#spec').inputValue().then(JSON.parse);
  spec.ui_code=`const gameUI={reduce(message){
    const m=message.type==='ui_event'?message.state_changed:message;
    const label=(m.strings||{}).counter||'Alice’s counter at A1';
    return {scene:{pieces:[
      {id:'front',type:'mark',board:'board',position:{cell:'0'},text:'1',aria_label:label,actions:['tap','rotate']},
      {id:'back',type:'mark',board:'board',position:{cell:'4'},text:'SECRET FACE',aria_label:'SECRET OWNER',face:'back',actions:[]},
      {id:'hidden',type:'mark',board:'board',position:{cell:'6'},aria_label:'HIDDEN IDENTITY',hidden:true,actions:[]}
    ],targets:[{id:'destination',board:'board',position:{cell:'1'},label:'2',aria_label:(m.strings||{}).column||'Column two'}]},
    ...(message.type==='ui_event'&&message.event.id==='destination'?{make_move:{clicked:message.event.id}}:{})};
  }};`;
  const message=JSON.parse(await page.locator('#message').inputValue());
  await page.locator('#spec').fill(JSON.stringify(spec));
  await page.locator('#render').click();
  const front=page.locator('#preview [data-ui-id="front"]');
  const target=page.locator('#preview [data-ui-id="destination"]');
  await expect(front).toHaveAccessibleName('Alice’s counter at A1: Click, Rotate');
  await expect(front.locator('text').first()).toHaveText('1');
  await expect(target).toHaveAccessibleName('Column two');
  await expect(target.locator('text')).toHaveText('2');
  const back=page.locator('#preview .declarative-piece[aria-label="Covered piece"]');
  await expect(back).toHaveCount(1);await expect(back).not.toContainText('SECRET');
  await expect(page.locator('#preview [aria-label*="SECRET"],#preview [aria-label*="HIDDEN"]')).toHaveCount(0);
  await expect(page.locator('#preview [data-ui-id="hidden"]')).toHaveCount(0);
  await front.click();await expect(page.locator('#preview [data-piece-action="rotate"]')).toHaveAccessibleName('Rotate Alice’s counter at A1');
  await page.locator('#reset').click();
  message.strings={counter:'قطعة أليس في أ١',column:'العمود الثاني'};
  message.locale='ar';message.direction='rtl';
  await page.locator('#message').fill(JSON.stringify(message));await page.locator('#render').click();
  await expect(front).toHaveAttribute('aria-label',/قطعة أليس في أ١/);
  await expect(target).toHaveAccessibleName('العمود الثاني');
  await expect(front.locator('text').first()).toHaveText('1');
  for(const mode of ['spectator','replay','waiting','ended']){
    const readonly={...message,acting_for_player_index:null,
      status:mode==='waiting'?'waiting_for_players':mode==='ended'?'over':'ongoing',
      ...(mode==='replay'?{replay:{index:1,total:2}}:{})};
    await page.locator('#message').fill(JSON.stringify(readonly));await page.locator('#render').click();
    await expect(front).toHaveAttribute('aria-disabled','true');
    await expect(front).toHaveAttribute('aria-label',/قطعة أليس في أ١/);
    await front.focus();await front.press('Enter');await expect(page.locator('#messages')).toBeEmpty();
  }
  message.locale='en';message.direction='ltr';delete message.strings;
  await page.locator('#message').fill(JSON.stringify(message));await page.locator('#render').click();
  await expect(front).toHaveAccessibleName('Alice’s counter at A1: Click, Rotate');
  await expect(target).toHaveAccessibleName('Column two');
  const literal='<img src=x onerror=alert(1)>';
  message.strings={counter:literal,column:literal};
  await page.locator('#message').fill(JSON.stringify(message));await page.locator('#render').click();
  await expect(target).toHaveAccessibleName(literal);
  await expect(page.locator('#preview img')).toHaveCount(0);
  message.strings={counter:'W'.repeat(200),column:'Column two'};
  await page.locator('#message').fill(JSON.stringify(message));await page.locator('#render').click();
  await front.click();
  const tools=page.locator('#preview .declarative-piece-actions');
  await expect(tools).toBeVisible();
  expect(await tools.evaluate(element=>{
    const bounds=element.getBoundingClientRect(),css=getComputedStyle(element);
    const parent=element.parentElement!,outer=parent.getBoundingClientRect(),parentStyle=getComputedStyle(parent);
    const contentLeft=outer.left+parseFloat(parentStyle.borderLeftWidth)+parseFloat(parentStyle.paddingLeft);
    const contentRight=outer.right-parseFloat(parentStyle.borderRightWidth)-parseFloat(parentStyle.paddingRight);
    if(bounds.left<contentLeft-1||bounds.right>contentRight+1)return false;
    const left=bounds.left+parseFloat(css.borderLeftWidth)+parseFloat(css.paddingLeft);
    const right=bounds.right-parseFloat(css.borderRightWidth)-parseFloat(css.paddingRight);
    return [...element.children].every(child=>{const r=child.getBoundingClientRect();return r.left>=left-1&&r.right<=right+1;});
  })).toBe(true);
  await info.attach('native-accessible-labels',{body:await page.screenshot({path:info.outputPath('native-accessible-labels.png')}),contentType:'image/png'});
});
