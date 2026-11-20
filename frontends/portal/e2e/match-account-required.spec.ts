import {test,expect} from '@playwright/test';
import {createGame,uniqueName} from './helpers';

test('all three match kinds require choosing an account before creation',async({page,request,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Account checks require a disposable loopback server.');
  const game=await createGame(request,uniqueName('Account-required game'));
  await page.goto(`/portal#game=${game}`);
  for(const mode of ['play-computer','play-online','play-pass']){
    await page.getByTestId(mode).getByRole('button',{name:mode==='play-computer'?'Play against the computer':mode==='play-online'?'Invite your friends to play':'Pass and play',exact:true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#game=${game}$`));
    await expect(page.getByTestId('game-stage')).toHaveCount(0);
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  }
});
