import {expect, Locator, Page} from '@playwright/test';

// Camera navigation uses the same native buttons as a keyboard/touch user.
// SVG nodes can exist outside the viewBox, where locator.isVisible() alone
// does not prove they can receive a real click.
export async function revealDeclarativeTarget(page:Page, target:Locator) {
  const host=target.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," declarative-game ")][1]');
  for(let i=0;i<64;i++){
    await host.locator('.declarative-stage').scrollIntoViewIfNeeded();
    const direction=await target.evaluate(node=>{
      const stage=node.closest('svg') as SVGSVGElement;
      const r=(node.querySelector('.declarative-target-area')||node.querySelector(':scope > g')||node).getBoundingClientRect();
      const p=stage.createSVGPoint(),v=stage.viewBox.baseVal,m=stage.getScreenCTM()!;
      p.x=v.x;p.y=v.y;const first=p.matrixTransform(m);p.x+=v.width;p.y+=v.height;const last=p.matrixTransform(m);
      const x=r.x+r.width/2,y=r.y+r.height/2;
      return x<first.x+2?'left':x>last.x-2?'right':y<first.y+2?'up':y>last.y-2?'down':null;
    });
    if(!direction)return;
    const button=host.locator(`[data-camera-action="${direction}"]`);
    await expect(button).toBeEnabled();await button.click();
  }
  throw new Error('Native camera navigation could not reach the scene target');
}
