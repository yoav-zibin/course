import replacement from './reviewedBackgammon.json';

type Game = {id?:string;server_code?:string | null;declarative_ui?:unknown};
export type Digest = (source:string)=>Promise<string>;
const gameId='5f5293c3-2a3a-4eec-b631-9debf59be0ca';
const ruleHashes=new Set(['0206fffd96b1447a457f63431d013c6de5d5337dfc40285157304a95204b3c4e','9c372d98d8556a52c564cf03f061a50025070740e79dab9acf36617d76dcfb76']);
const uiHashes=new Set(['bb690c066a3f779a8a0a9e13a7bda77c6f48fccb14d859508d4ddb32a986b843','4bee425e8a8b1690212fb1e018370d2a8badbc3c6a825d2f34d8a91d28107c21','40463fb1a19489a19055c9824951edda17ec821b7ea718c8978eab18c05fd314']);
const replacementHash='34094a02eb9678b6ce612034f4ccd407eb02b577081e8cda9ec9634a8a1a3c24';

// Match Python's sort_keys=True, ensure_ascii=False, separators=(',', ':').
// Building the object text explicitly retains the sort order of numeric keys.
export function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function reviewedPresentation(game:Game|null|undefined,digest:Digest):Promise<unknown> {
  const original=game?.declarative_ui;
  if(game?.id!==gameId||!original||typeof game.server_code!=='string')return original;
  try {
    if(!ruleHashes.has(await digest(game.server_code))||!uiHashes.has(await digest(canonical(original))))return original;
    if(await digest(canonical(replacement))!==replacementHash)return original;
    // Only this exact reviewed presentation changes. Pinned rules, schemas,
    // game versions and cached authored packages remain untouched.
    return JSON.parse(JSON.stringify(replacement));
  }catch{return original;}
}
