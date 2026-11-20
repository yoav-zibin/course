import {test,expect} from '@playwright/test';

test('destination navigation resets scrolling after a long saved-game list without a footer',async({page,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Navigation checks require a disposable loopback server.');
  await page.goto('/portal');
  for(let i=0;i<3;i++){
    await page.goto('/portal#local');
    await page.getByRole('button',{name:'Pass and play',exact:true}).click();
    await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  }
  await page.goto('/portal#local');
  await expect(page.getByRole('button',{name:'Open match',exact:true})).toHaveCount(3);
  await expect(page.getByRole('button',{name:'Preferences',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Privacy',exact:true})).toHaveCount(0);
  await expect(page.getByText('● Online',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Matches',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeInViewport({ratio:1});
  // Opening a dialog retains the page underneath; switching destinations does not.
  await page.getByTestId('header-account').click();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Matches',exact:true})).toBeInViewport({ratio:1});
  await page.goto('/portal#local');
  await expect(page.getByRole('button',{name:'Open match',exact:true})).toHaveCount(3);
  await page.goto('/portal#settings');
  await expect(page.getByRole('combobox',{name:'Search games',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Preferences',exact:true})).toHaveCount(0);
});
