import {toSvg} from 'html-to-image';
/** Rasterize the viewport after preserving nested native-web scroll positions.
 * html-to-image clones styles and inputs, but omits scrollTop/scrollLeft. */
export async function captureBugScreenshot():Promise<string> {
  const width=window.innerWidth,height=window.innerHeight,scale=Math.min(1,1280/width,1600/height);
  const scrolls:Array<{node:Element;id:string;top:number;left:number}>=[];
  for(const node of [document.body,...Array.from(document.body.querySelectorAll('*'))]) {
    if(node.scrollTop||node.scrollLeft){const id=String(scrolls.length);scrolls.push({node,id,top:node.scrollTop,left:node.scrollLeft});node.setAttribute('data-bug-scroll-id',id);}
  }
  let svg:string;
  try {
    svg=await toSvg(document.body,{width,height,backgroundColor:'#10141f',skipFonts:true,
      imagePlaceholder:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      filter:node=>!(node instanceof Element&&(['NOSCRIPT','SCRIPT'].includes(node.tagName)||node.hasAttribute('data-bug-overlay')||node.getAttribute('type')==='password'||node.getAttribute('data-private')==='true')),
    });
  } finally {for(const {node} of scrolls)node.removeAttribute('data-bug-scroll-id');}
  const documentCopy=new DOMParser().parseFromString(decodeURIComponent(svg.slice(svg.indexOf(',')+1)),'image/svg+xml');
  for(const {id,top,left} of scrolls) {
    const container=documentCopy.querySelector(`[data-bug-scroll-id="${id}"]`);if(!container)continue;
    // Translating children preserves flex layout and clipping without changing
    // any live UI. Every direct child moves by the same scroll offset.
    for(const child of Array.from(container.children)) {
      const element=child as HTMLElement;element.style.transform=`translate(${-left}px, ${-top}px) ${element.style.transform==='none'?'':element.style.transform}`;
    }
    container.removeAttribute('data-bug-scroll-id');
  }
  if(window.scrollY||window.scrollX){const body=documentCopy.querySelector('body');if(body)for(const child of Array.from(body.children)){const element=child as HTMLElement;element.style.transform=`translate(${-window.scrollX}px, ${-window.scrollY}px) ${element.style.transform==='none'?'':element.style.transform}`;}}
  const image=new window.Image();image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(documentCopy))}`;
  await image.decode();
  const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
  const context=canvas.getContext('2d');if(!context)throw new Error('Screenshot capture is unavailable in this browser.');
  context.drawImage(image,0,0,canvas.width,canvas.height);
  for(const quality of [.7,.45,.25,.1]) {const result=canvas.toDataURL('image/jpeg',quality);if(result.length<=500000)return result;}
  const small=document.createElement('canvas');small.width=Math.round(canvas.width/2);small.height=Math.round(canvas.height/2);
  const smallContext=small.getContext('2d');if(!smallContext)throw new Error('Screenshot capture is unavailable in this browser.');
  smallContext.drawImage(canvas,0,0,small.width,small.height);
  const result=small.toDataURL('image/jpeg',.35);if(result.length<=500000)return result;
  throw new Error('The screenshot is too large. You can still send the report.');
}
