import {test,expect} from '@playwright/test';
import es from '../../../locales/es.json';
import fr from '../../../locales/fr.json';

test.beforeEach(async({page})=>{
  // Review tests never need the real course roster or its network dependency.
  await page.route('**/admin/students/data',route=>route.fulfill({json:{students:[]}}));
});

test('private bug report review displays evidence safely and records an escalation',async({page,context,request,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Requires a disposable loopback server.');
  const description=`Review report ${Date.now()} ${Math.random()} <img src=x onerror=alert(1)>`;
  const screenshot='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  const sent=await request.post('/bug-reports',{data:{text:description,screenshot,diagnostics:{logs:[{message:'A useful diagnostic <script>alert(1)</script>'}]}}});
  expect(sent.status()).toBe(201);
  const id=(await sent.json()).id;
  await context.setHTTPCredentials({username:'review-test',password:'e2e-test-master'});
  await page.goto('/admin#bug-reports');
  const review=page.frameLocator('iframe[data-tab="bug-reports"]');
  await review.getByRole('combobox',{name:'Status',exact:true}).selectOption('open');
  const report=review.locator('article').filter({hasText:description});
  await expect(report).toBeVisible();
  await report.getByText('Screenshot, diagnostics and resolution',{exact:true}).click();
  const preview=report.getByRole('img',{name:'Screen captured before opening the bug reporter'});
  await expect(preview).toHaveAttribute('src',screenshot);
  await report.getByText('User and app diagnostics',{exact:true}).click();
  await expect(report.locator('pre')).toContainText('A useful diagnostic <script>alert(1)</script>');
  await expect(report.locator('script')).toHaveCount(0);
  await report.getByRole('button',{name:'Escalate to owner',exact:true}).click();
  await expect(report.getByRole('alert')).toHaveText("Enter the resolution or the reason this needs the owner's decision.");
  await report.getByRole('textbox',{name:'Resolution or escalation reason',exact:true}).fill('Needs owner decision before changing game behavior.');
  await report.getByRole('button',{name:'Escalate to owner',exact:true}).click();
  await expect(report).toHaveCount(0);
  await review.getByRole('combobox',{name:'Status',exact:true}).selectOption('escalated');
  const escalated=review.locator('article').filter({hasText:id});
  await expect(escalated).toBeVisible();
  await escalated.getByText('Screenshot, diagnostics and resolution',{exact:true}).click();
  await expect(escalated.getByRole('textbox',{name:'Resolution or escalation reason',exact:true})).toHaveValue('Needs owner decision before changing game behavior.');
});

test('report filters include later pages, attribute merged accounts and distinguish zero from unassessed',async({page,context,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Requires a disposable loopback server.');
  await context.setHTTPCredentials({username:'report-filters',password:'e2e-test-master'});
  const errors:string[]=[];
  const requests:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const student={id:'student-one',name:'Example Learner',emails:['example@university.invalid','personal@example.invalid'],
    accounts:[{id:'old-account',canonical_user_id:'current-account'},{id:'current-account',canonical_user_id:'current-account'}]};
  await page.route('**/admin/students/data',route=>route.fulfill({json:{students:[student]}}));
  const row=(id:string,score:number|null,userId:string|null,extra:Record<string,unknown>={})=>({
    id,score,text:`Description ${id} <img src=x onerror=alert(1)>`,reporter_user_id:userId,
    user:userId?{id:userId,display_name:'Different display name'}:null,status:'open',
    created_at:'2026-11-20T12:00:00Z',updated_at:'2026-11-20T12:00:00Z',
    score_rationale:'Independent assessment',changes_summary:'',resolution:'',...extra,
  });
  const first=row('first-page',null,null);
  const low=row('later-zero',0,'old-account',{changes_summary:'Fixed the board layout',status:'handled'});
  const high=row('later-high',10,'current-account',{changes_summary:'Fixed reconnect retry'});
  await page.route(/\/admin\/bug-reports\?/,route=>{
    const query=new URL(route.request().url()).searchParams;
    requests.push(query.get('cursor')||'first');
    expect(query.get('status')).toBe('all');
    return route.fulfill({json:query.has('cursor')?{items:[low,high],next_cursor:null}:{items:[first],next_cursor:'later-page'}});
  });
  await page.route('**/admin/bug-reports/later-zero',route=>route.fulfill({json:{...low,screenshot:null,diagnostics:{}}}));
  await page.goto('/bug-reports?student=student-one&report=later-zero');
  await expect(page.locator('#summary')).toContainText('2 of 3 reports match');
  await expect(page.locator('#summary')).toContainText('Average score 5.00/10 across 2 assessed reports');
  const zero=page.locator('#report-later-zero');
  await expect(zero).toContainText('Example Learner');
  await expect(zero.locator('.report-score')).toHaveText('Score: 0/10');
  await expect(zero.locator('details').first()).toHaveAttribute('open','');
  await expect(zero).toContainText('Fixed the board layout');
  await expect(zero.locator('img')).toHaveCount(0);
  await page.getByRole('combobox',{name:'Score',exact:true}).selectOption('low');
  await expect(page.locator('#reports article')).toHaveCount(1);
  await expect(page.locator('#summary')).toContainText('Average score 0.00/10');
  await page.getByRole('combobox',{name:'Score',exact:true}).selectOption('unassessed');
  await expect(page.locator('#reports')).toContainText('No reports match these filters.');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(page.locator('#reports article')).toHaveCount(3);
  await expect(page.locator('#report-first-page .report-score')).toHaveText('Score: Not assessed');
  await page.getByRole('searchbox').fill('personal@example.invalid');
  await expect(page.locator('#reports article')).toHaveCount(2);
  await page.getByRole('combobox',{name:'Sort',exact:true}).selectOption('highest');
  await expect(page.locator('#reports article').first()).toHaveAttribute('id','report-later-high');
  await page.getByRole('combobox',{name:'Changes',exact:true}).selectOption('no');
  await expect(page.locator('#reports article')).toHaveCount(0);
  expect(requests).toEqual(['first','later-page']);
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('student attribution failure leaves all reports available and does not broaden student filters',async({page,context,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Requires a disposable loopback server.');
  await context.setHTTPCredentials({username:'report-filters',password:'e2e-test-master'});
  await page.route('**/admin/students/data',route=>route.fulfill({status:503,json:{detail:'Roster unavailable'}}));
  await page.route(/\/admin\/bug-reports\?/,route=>route.fulfill({json:{items:[{
    id:'anonymous-report',text:'Visitor found a board problem',reporter_user_id:null,user:null,score:null,status:'open',created_at:'2026-11-20T12:00:00Z',
  }],next_cursor:null}}));
  await page.goto('/bug-reports?student=student-one');
  await expect(page.locator('#student-warning')).toContainText('Course account attribution could not be loaded.');
  await expect(page.locator('#reports article')).toHaveCount(0);
  await expect(page.locator('#reports')).toContainText('Student filtering requires the course account list.');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(page.locator('#reports article')).toHaveCount(1);
  await expect(page.locator('#reports')).toContainText('Anonymous reporter');
});

test('admin report copy and revised privacy text translate while resolution drafts survive language changes',async({page,context,request,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Requires a disposable loopback server.');
  const description=`Localization report ${Date.now()} ${Math.random()}`;
  expect((await request.post('/bug-reports',{data:{text:description,diagnostics:{}}})).status()).toBe(201);
  await context.setHTTPCredentials({username:'translation-test',password:'e2e-test-master'});
  await page.addInitScript(()=>{if(!localStorage.getItem('game-platform.locale.v1'))localStorage.setItem('game-platform.locale.v1',JSON.stringify('es'));});
  await page.goto('/admin#bug-reports');
  await expect(page.getByRole('tab',{name:es['ui.admin.tab_bug_reports'],exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:es['ui.admin.tab_legacy_feedback'],exact:true})).toBeVisible();
  await page.goto('/bug-reports');
  const review=page,report=review.locator('article').filter({hasText:description});
  await report.getByText(es['ui.bug_reports.evidence'],{exact:true}).click();
  const notes=report.getByRole('textbox',{name:es['ui.bug_reports.resolution'],exact:true});
  await notes.fill('Keep this unfinished resolution across language changes.');
  await review.locator('#language-picker').selectOption('fr');
  await expect(report.getByText(fr['ui.bug_reports.evidence'],{exact:true})).toBeVisible();
  await expect(report.getByRole('textbox',{name:fr['ui.bug_reports.resolution'],exact:true})).toHaveValue('Keep this unfinished resolution across language changes.');
  await expect(report.getByRole('button',{name:fr['ui.bug_reports.handle'],exact:true})).toBeVisible();
  await expect(report.getByPlaceholder(fr['ui.bug_reports.commit_placeholder'],{exact:true})).toBeVisible();
  await page.evaluate(()=>localStorage.setItem('game-platform.locale.v1',JSON.stringify('fr')));
  await page.goto('/static/privacy.html');
  await expect(page.locator('[data-i18n="ui.privacy.bug_reports"]')).toHaveText(fr['ui.privacy.bug_reports']);
  await expect(page.locator('[data-i18n="ui.privacy.use"]')).toHaveText(fr['ui.privacy.use']);
  await expect(page.locator('[data-i18n="ui.privacy.retention"]')).toHaveText(fr['ui.privacy.retention']);
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('#language-picker')).toHaveCount(0);
});
