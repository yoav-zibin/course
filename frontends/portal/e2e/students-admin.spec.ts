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
      average_score:score,total_score:score===null?0:score*2,status_counts:{open:1,handled:2},top:score===null?[]:[report],lowest:score===null?[]:[report]}};
}
const payload={generated_at:'2026-11-21T10:30:00Z',cache_seconds:60,
  roster_source_url:'https://docs.google.com/spreadsheets/d/test-roster/edit',roster_fetched_at:'2026-11-21T10:20:00Z',
  students:[person('course-alice','Alice Example',9,3),person('course-bruno','Bruno Sample',0,5),person('course-casey','Casey Guest',null,0)]};

test.beforeEach(async({page,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Requires a disposable loopback server.');
  await page.setExtraHTTPHeaders(E2E_ADMIN_HEADERS);
  await loginAdmin(page);
});

test('admin students tab keeps identities, metrics and report examples in one wide table',async({page},testInfo)=>{
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
  await expect(dashboard.locator('.leaderboard-table')).toHaveCount(1);
  await expect(dashboard.locator('.leaderboard-table tbody > tr')).toHaveCount(3);
  await expect(dashboard.locator('.student-detail')).toHaveCount(0);
  const alice=dashboard.locator('.student-row[data-student-id="course-alice"]');
  await expect(alice.locator('[data-column="institutional_email"]')).toContainText('course-alice@university.example');
  await expect(alice.locator('[data-column="personal_email"]')).toHaveText('Not provided');
  const accounts=alice.locator('[data-column="accounts"]');
  await expect(accounts).toContainText('account-course-alice');
  await expect(accounts).toContainText('google');
  await expect(accounts).toContainText('Match: email; first name');
  await expect(alice.locator('[data-column="computer"]')).toHaveText('2');
  await expect(alice.locator('[data-column="pass_and_play"]')).toHaveText('1');
  await expect(alice.locator('[data-column="multiplayer"]')).toHaveText('3');
  await expect(alice.locator('[data-column="manual_reports"]')).toHaveText('2');
  await expect(alice.locator('[data-column="automatic_reports"]')).toHaveText('1');
  const top=alice.locator('[data-column="top"]');
  await expect(top).toContainText('A useful report <img src=x onerror=alert(1)>');
  await expect(top.locator('.report-card').first()).toContainText('Automatic');
  await expect(top).toContainText('Clear reproduction steps.');
  await expect(top).toContainText('Updated the game logic.');
  await expect(top.locator('img')).toHaveCount(0);
  await expect(alice.locator('td').last()).toHaveAttribute('data-column','links');
  await expect(alice.getByRole('link',{name:"Browse this person's reports"})).toHaveAttribute('href','/bug-reports?student=course-alice');
  await expect(top.getByRole('link',{name:'Open full report'}).first()).toHaveAttribute('href','/bug-reports?student=course-alice&report=report-course-alice');
  const frame=page.frames().find(frame=>frame.url().includes('/admin/students?'))!;
  expect(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const geometry=await frame.evaluate(()=>{
    const wrap=document.querySelector('.table-wrap') as HTMLElement;
    const table=document.querySelector('.leaderboard-table')!;
    const row=document.querySelector('.student-row')!;
    wrap.scrollTop=0;
    const before=row.firstElementChild!.getBoundingClientRect().left;
    const heading=document.querySelector('.leaderboard-table thead th')!;
    const headingBefore=heading.getBoundingClientRect().top;
    wrap.scrollLeft=wrap.scrollWidth;
    wrap.scrollTop=100;
    return {overflows:wrap.scrollWidth>wrap.clientWidth,scroll:wrap.scrollLeft,
      tableDisplay:getComputedStyle(table).display,rowDisplay:getComputedStyle(row).display,
      pinnedName:Math.abs(row.firstElementChild!.getBoundingClientRect().left-before)<2,
      pinnedHeader:Math.abs(heading.getBoundingClientRect().top-headingBefore)<2};
  });
  expect(geometry.overflows).toBe(true);
  expect(geometry.scroll).toBeGreaterThan(0);
  expect(geometry.tableDisplay).toBe('table');
  expect(geometry.rowDisplay).toBe('table-row');
  expect(geometry.pinnedName).toBe(true);
  await frame.evaluate(()=>{
    const main=document.querySelector('main')!;
    const wrap=document.querySelector('.table-wrap') as HTMLElement;
    main.scrollTop=wrap.offsetTop-main.offsetTop;
    wrap.scrollTop=0;
  });
  expect(geometry.pinnedHeader).toBe(true);
  await page.screenshot({path:testInfo.outputPath('students-wide-table.png')});
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
  const tableViewport=page.getByTestId('students-table-scroll');
  await tableViewport.evaluate(node=>{node.scrollLeft=700;});
  await page.getByRole('searchbox',{name:'Find a person or account',exact:true}).fill('account-course-alice');
  await expect(rows).toHaveCount(1);
  expect(await tableViewport.evaluate(node=>node.scrollLeft)).toBe(700);
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(rows).toContainText('Alice Example');
  await expect(rows.locator('[data-column="accounts"]')).toContainText('account-course-alice');
  await expect(rows.locator('button[aria-expanded]')).toHaveCount(0);
  await page.getByRole('searchbox').fill('no-such-person');
  await expect(page.getByText('No people match this search.',{exact:true})).toBeVisible();
  expect(requests).toBe(1);
});

test('students dashboard retries failed loading and highlights a linked person',async({page})=>{
  let requests=0;
  await page.route('**/admin/students/data',route=>++requests===1?route.fulfill({status:503,json:{detail:'Temporary roster failure'}}):route.fulfill({json:payload}));
  await page.goto('/admin/students?student=course-casey');
  await expect(page.getByRole('alert')).toHaveText('Could not load the students leaderboard. Select Refresh to try again.');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('alert')).toBeHidden();
  const selected=page.locator('.student-row[data-student-id="course-casey"]');
  await expect(selected).toHaveClass(/is-selected/);
  await expect(selected).toBeFocused();
  await expect(selected.locator('[data-column="top"]')).toContainText('No assessed reports yet.');
  await expect(page.locator('#freshness')).toContainText('cached for up to 60 seconds');
});

test('long account lists and report examples stay readable within a single bounded row',async({page})=>{
  const alice=payload.students[0];
  const longPerson={...alice,accounts:Array.from({length:30},(_,index)=>({...alice.accounts[0],id:`account-alias-${index}`})),
    reports:{...alice.reports,top:alice.reports.top.map(report=>({...report,text:'Detailed report evidence.\n'.repeat(100)}))}};
  await page.route('**/admin/students/data',route=>route.fulfill({json:{...payload,students:[longPerson]}}));
  await page.goto('/admin/students');
  const row=page.locator('.student-row');
  await expect(row).toHaveCount(1);
  const accounts=row.locator('.account-list'),reports=row.locator('[data-column="top"] .report-examples');
  await expect(accounts).toHaveAttribute('tabindex','0');
  await expect(reports).toHaveAttribute('tabindex','0');
  await expect(accounts).toHaveAttribute('aria-label',/Alice Example/);
  await expect(reports).toHaveAttribute('aria-label',/Alice Example/);
  expect(await row.evaluate(node=>node.getBoundingClientRect().height)).toBeLessThan(380);
  for(const cell of [accounts,reports]){
    const dimensions=await cell.evaluate(node=>{
      node.scrollTop=node.scrollHeight;
      return {height:node.clientHeight,content:node.scrollHeight,scrolled:node.scrollTop};
    });
    expect(dimensions.content).toBeGreaterThan(dimensions.height);
    expect(dimensions.scrolled).toBeGreaterThan(0);
  }
  await expect(accounts).toContainText('account-alias-29');
  await expect(reports).toContainText('Detailed report evidence.');
});

test('top score summary includes all thirteen people and ranks exact sums independently of detailed filters',async({page},testInfo)=>{
  const teacher=person('course-teacher','Instructor Example',2,0);
  teacher.role='instructor';
  teacher.reports={...teacher.reports,total:105,assessed:100,unassessed:5,total_score:200};
  const precision=person('course-precision','Precision Example',1.33,0);
  precision.reports={...precision.reports,total:4,assessed:3,unassessed:1,total_score:4};
  const highAverage=person('course-high-average','High Average Example',10,0);
  highAverage.reports={...highAverage.reports,total:1,assessed:1,unassessed:0,total_score:10};
  const zero=person('course-zero','Zero Score Example',0,0);
  const unassessed=person('course-unassessed','Unassessed Example',null,0);
  const remaining=Array.from({length:8},(_,index)=>person(`course-other-${index}`,`Other Student ${index}`,null,0));
  const tied=remaining[0];
  tied.name='Alphabetical Tie Example';
  tied.reports={...tied.reports,total:2,assessed:2,unassessed:0,average_score:5,total_score:10};
  let requests=0;
  await page.route('**/admin/students/data',route=>{
    requests++;
    return route.fulfill({json:{...payload,students:[unassessed,precision,zero,highAverage,...remaining,teacher]}});
  });
  await page.goto('/admin/students');
  const summary=page.locator('.score-summary-table');
  const rows=summary.locator('.score-summary-row');
  await expect(rows).toHaveCount(13);
  await expect(summary.getByRole('columnheader')).toHaveText(['Person','Total score','Bug reports','Average score']);
  const ids=await rows.evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.studentId));
  expect(ids.slice(0,4)).toEqual(['course-teacher','course-other-0','course-high-average','course-precision']);
  const teacherRow=summary.locator('[data-student-id="course-teacher"]');
  await expect(teacherRow).toContainText('Instructor Example');
  await expect(teacherRow.locator('[data-column="total_score"]')).toHaveText('200');
  await expect(teacherRow.locator('[data-column="reports"]')).toHaveText('105');
  await expect(teacherRow.locator('[data-column="average_score"]')).toHaveText('2/10');
  const precisionRow=summary.locator('[data-student-id="course-precision"]');
  await expect(precisionRow.locator('[data-column="total_score"]')).toHaveText('4');
  await expect(precisionRow.locator('[data-column="reports"]')).toHaveText('4');
  await expect(precisionRow.locator('[data-column="average_score"]')).toHaveText('1.33/10');
  await expect(summary.locator('[data-student-id="course-zero"] [data-column="average_score"]')).toHaveText('0/10');
  await expect(summary.locator('[data-student-id="course-unassessed"] [data-column="average_score"]')).toHaveText('—');
  expect(await summary.evaluate(node=>node.getBoundingClientRect().top<document.getElementById('leaderboard')!.getBoundingClientRect().top)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await summary.evaluate(node=>{
    const average=node.querySelector('thead [data-column="average_score"]')!.getBoundingClientRect();
    const viewport=node.parentElement!.getBoundingClientRect();
    return average.right<=viewport.right+1;
  })).toBe(true);
  await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('average_score');
  await page.getByRole('combobox',{name:'Order',exact:true}).selectOption('asc');
  await page.getByRole('searchbox').fill('no-such-person');
  await expect(page.locator('.student-row')).toHaveCount(0);
  await expect(rows).toHaveCount(13);
  expect(await rows.evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.studentId))).toEqual(ids);
  expect(requests).toBe(1);
  await page.locator('main').evaluate(node=>{node.scrollTop=0;});
  await page.screenshot({path:testInfo.outputPath('students-score-summary.png')});
});
