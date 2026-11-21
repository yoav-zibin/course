import {test,expect} from '@playwright/test';
import {E2E_ADMIN_HEADERS,loginAdmin} from './helpers';

const matches=(computer=0,pass_and_play=0,multiplayer=0)=>({computer,pass_and_play,multiplayer,total:computer+pass_and_play+multiplayer,waiting:2});
function person(id:string,name:string,score:number|null,recruits:number){
  const report={id:`report-${id}`,text:'A useful report <img src=x onerror=alert(1)>',score,
    score_rationale:'Clear reproduction steps.',status:'handled',resolution:'Fixed and verified.',
    changes_summary:'Updated the game logic.',created_at:'2026-11-21T10:00:00Z',reporter_user_id:`account-${id}`};
  return {id,name,role:'student',institutional_email:`${id}@university.example`,personal_email:null,
    emails:[`${id}@university.example`],accounts:[{id:`account-${id}`,display_name:name,
      canonical_user_id:`account-${id}`,emails:[`${id}@personal.example`],login_methods:['google','email'],
      match_reasons:['email','first name'],created_at:'2026-11-01T10:00:00Z'}],
    matches:matches(2,1,3),other_players:4,direct_recruits:2,transitive_recruits:recruits,
    recruits_matches:matches(3,0,4),reports:{total:3,assessed:score===null?0:2,unassessed:score===null?3:1,
      average_score:score,status_counts:{open:1,handled:2},top:score===null?[]:[report],lowest:score===null?[]:[report]}};
}
const payload={generated_at:'2026-11-21T10:30:00Z',cache_seconds:60,
  roster_source_url:'https://docs.google.com/spreadsheets/d/test-roster/edit',roster_fetched_at:'2026-11-21T10:20:00Z',
  students:[person('course-alice','Alice Example',9,3),person('course-bruno','Bruno Sample',0,5),person('course-casey','Casey Guest',null,0)]};

test.beforeEach(async({page,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Requires a disposable loopback server.');
  await page.setExtraHTTPHeaders(E2E_ADMIN_HEADERS);
  await loginAdmin(page);
});

test('admin students tab shows matched identities and safe report examples',async({page},testInfo)=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const withSources={...payload,students:payload.students.map((student,index)=>index?student:{...student,reports:{
    ...student.reports,manual:2,automatic:1,top:student.reports.top.map(report=>({...report,automatic:true})),
  }})};
  await page.route('**/admin/students/data',route=>route.fulfill({json:withSources}));
  await page.goto('/admin#students');
  await expect(page.getByRole('tab',{name:'Students leaderboard',exact:true})).toHaveAttribute('aria-selected','true');
  const dashboard=page.frameLocator('iframe[data-tab="students"]');
  await expect(dashboard.locator('.student-row')).toHaveCount(3);
  await page.screenshot({path:testInfo.outputPath('students-overview.png')});
  await dashboard.getByRole('button',{name:'Alice Example',exact:true}).click();
  const detail=dashboard.locator('#student-detail-course-alice');
  await expect(detail).toContainText('course-alice@university.example');
  await expect(detail).toContainText('account-course-alice');
  await expect(detail).toContainText('google');
  await expect(detail).toContainText('Match: email; first name');
  await expect(detail).toContainText('Not provided');
  await expect(detail).toContainText('A useful report <img src=x onerror=alert(1)>');
  await expect(detail.locator('.breakdown div').filter({has:dashboard.getByText('Manual reports',{exact:true})})).toContainText('2');
  await expect(detail.locator('.breakdown div').filter({has:dashboard.getByText('Automatic reports',{exact:true})})).toContainText('1');
  await expect(detail.locator('.report-card').first()).toContainText('Automatic');
  await expect(detail).toContainText('The average includes assessed manual and automatic reports; unassessed reports are excluded.');
  await expect(detail.locator('img')).toHaveCount(0);
  await expect(detail.getByRole('link',{name:"Browse this person's reports"})).toHaveAttribute('href','/bug-reports?student=course-alice');
  await expect(detail.getByRole('link',{name:'Open full report'}).first()).toHaveAttribute('href','/bug-reports?student=course-alice&report=report-course-alice');
  const frame=page.frames().find(frame=>frame.url().includes('/admin/students?'))!;
  expect(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await frame.evaluate(()=>document.querySelector('.student-row:has(button[aria-expanded="true"])')?.scrollIntoView({block:'start'}));
  await page.screenshot({path:testInfo.outputPath('students-expanded.png')});
  expect(errors).toEqual([]);
});

test('student sorting includes zero scores and keeps unassessed last; search finds account IDs',async({page})=>{
  let requests=0;
  await page.route('**/admin/students/data',route=>{requests++;return route.fulfill({json:payload});});
  await page.goto('/admin/students');
  const rows=page.locator('.student-row');
  await expect(rows.first()).toContainText('Bruno Sample');
  await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('average_score');
  await page.getByRole('combobox',{name:'Order',exact:true}).selectOption('asc');
  await expect(rows.first()).toContainText('Bruno Sample');
  await expect(rows.first()).toContainText('0/10');
  await expect(rows.last()).toContainText('Casey Guest');
  await page.getByRole('combobox',{name:'Order',exact:true}).selectOption('desc');
  await expect(rows.first()).toContainText('Alice Example');
  await expect(rows.last()).toContainText('Casey Guest');
  await page.getByRole('searchbox',{name:'Find a person or account',exact:true}).fill('account-course-alice');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Alice Example');
  const name=page.getByRole('button',{name:'Alice Example',exact:true});
  await name.focus();
  await page.keyboard.press('Enter');
  await expect(name).toHaveAttribute('aria-expanded','true');
  await page.getByRole('searchbox').fill('no-such-person');
  await expect(page.getByText('No people match this search.',{exact:true})).toBeVisible();
  expect(requests).toBe(1);
});

test('students dashboard retries failed loading and opens a linked person',async({page})=>{
  let requests=0;
  await page.route('**/admin/students/data',route=>++requests===1?route.fulfill({status:503,json:{detail:'Temporary roster failure'}}):route.fulfill({json:payload}));
  await page.goto('/admin/students?student=course-casey');
  await expect(page.getByRole('alert')).toHaveText('Could not load the students leaderboard. Select Refresh to try again.');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByRole('button',{name:'Casey Guest',exact:true})).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#student-detail-course-casey')).toContainText('No assessed reports yet.');
  await expect(page.locator('#freshness')).toContainText('cached for up to 60 seconds');
});
