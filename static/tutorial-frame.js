/* Build a self-contained, sandboxed tutorial document. No account data is passed. */
(function(root){
 function bootstrap(words,locale,direction){
  function localize(){
   document.documentElement.lang=locale;document.documentElement.dir=direction;
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   while(walker.nextNode()){
    const n=walker.currentNode;if(n.parentElement.closest('script,style,template'))continue;
    const key=n.data.trim();if(Object.hasOwn(words,key))n.data=n.data.replace(key,()=>words[key]);
   }
   for(const e of document.body.querySelectorAll('*'))for(const a of ['alt','title','aria-label','placeholder']){
    const key=e.getAttribute(a)?.trim();if(key && Object.hasOwn(words,key))e.setAttribute(a,words[key]);
   }
   const table=JSON.parse(document.getElementById('i18n-strings')?.textContent || '{}');
   const strings=Object.fromEntries(Object.entries(table).map(([k,v])=>[k,words[v] || v]));
   window.dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'tutorial_locale',locale,direction,strings}}));
  }
  window.addEventListener('load',localize,{once:true});
 }
 function documentSource(html,words={},locale='en',direction='ltr'){
  const args=JSON.stringify([words,locale,direction]).replaceAll('<','\\u003c');
  const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  return `<meta http-equiv="Content-Security-Policy" content="${policy}"><script>(${bootstrap.toString()})(...${args});<\/script>`+html;
 }
 root.TutorialFrame={documentSource};
})(globalThis);
