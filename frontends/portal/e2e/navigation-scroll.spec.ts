import {test,expect} from '@playwright/test';

test('footer navigation opens Preferences at the top after a long saved-game list',async({page,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Navigation checks require a disposable loopback server.');
  await page.goto('/portal');
  for(let i=0;i<3;i++){
    await page.getByRole('button',{name:'On this device',exact:true}).click();
    await page.getByRole('button',{name:'Pass and play',exact:true}).click();
    await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  }
  await page.getByRole('button',{name:'On this device',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open match',exact:true})).toHaveCount(3);
  await page.getByRole('button',{name:'Preferences',exact:true}).last().click();
  await expect(page.getByRole('heading',{name:'Preferences',exact:true})).toBeInViewport({ratio:1});
  await expect(page.getByRole('button',{name:'Navigation layout: Top navigation',exact:true})).toBeInViewport({ratio:1});
  // Opening a dialog retains the page underneath; switching destinations does not.
  await page.getByRole('button',{name:'Log in',exact:true}).click();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Preferences',exact:true})).toBeInViewport({ratio:1});
  await page.getByRole('button',{name:'On this device',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open match',exact:true})).toHaveCount(3);
});
