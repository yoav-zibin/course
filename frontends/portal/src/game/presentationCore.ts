import replacement from './reviewedBackgammon.json';
import connectFourReplacement from './reviewedConnectFour.json';

type Game = {id?:string;version?:number;server_code?:string | null;declarative_ui?:unknown};
export type Digest = (source:string)=>Promise<string>;
const gameId='5f5293c3-2a3a-4eec-b631-9debf59be0ca';
const ruleHashes=new Set(['0206fffd96b1447a457f63431d013c6de5d5337dfc40285157304a95204b3c4e','9c372d98d8556a52c564cf03f061a50025070740e79dab9acf36617d76dcfb76','6e798d6da75524ed6829e5c3e057401af72542a185e3f3b7a0cb822a3b13c0f4']);
const uiHashes=new Set(['bb690c066a3f779a8a0a9e13a7bda77c6f48fccb14d859508d4ddb32a986b843','4bee425e8a8b1690212fb1e018370d2a8badbc3c6a825d2f34d8a91d28107c21','40463fb1a19489a19055c9824951edda17ec821b7ea718c8978eab18c05fd314','34094a02eb9678b6ce612034f4ccd407eb02b577081e8cda9ec9634a8a1a3c24']);
const modernBackgammonRulesHash='f7044be96b2a162fe084edc82fedc7d0451d8856121be19bf31cfa69aa12e4e8';
const modernBackgammonUIHash='a1bdcb5339cfc42f8eb1be318aa3e96bd223f41b336f3534cb078131fb4a66da';
const backgammonVersion9UIHash='58df9b17cf4a7928aec6c1b776594c18e836d6c802e7b732cb687de61da555be';
const connectFourId='e299b14e-480d-44f3-8132-74282a46cebc';
const connectFourRulesHash='e4fce270f9481cb7eb22d34c98c12441b7e4db8f859f4ec43019311f41135ae3';
const connectFourUIHash='49688ae52421550f0a14a92cf2914ebea961a147e344c71d70d80be394aca284';
const connectFourReplacementHash='1450713baa36d87bdd7b6aa23fba1263c0db48912bbc3bfec9b55f35a9da4d75';
const replacementHash='7cb050f0acd41efe25a71bb772f6ccd671a62efdeba1783d6fb703d7e7356ee5';
// These published packages have identical malformed wood-grain paths.
const brokenBoardPackages=new Set(['666936dafaf8b31d82caecad96e94e4f3d40a83b1c3071687148de36e37a25e3','c2f66c7dc590a6ab547f9a5425725fd55cb1064d76f104af4e2cc168bf769caf']);

// Match Python's sort_keys=True, ensure_ascii=False, separators=(',', ':').
// Building the object text explicitly retains the sort order of numeric keys.
export function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function reviewedPresentation(game:Game|null|undefined,digest:Digest):Promise<unknown> {
  const original=game?.declarative_ui;
  if(!original||typeof game?.server_code!=='string')return original;
  try {
    if(game.id===connectFourId){
      if(await digest(game.server_code)!==connectFourRulesHash||await digest(canonical(original))!==connectFourUIHash)return original;
      if(await digest(canonical(connectFourReplacement))!==connectFourReplacementHash)return original;
      return JSON.parse(JSON.stringify(connectFourReplacement));
    }
    if(game.id!==gameId)return original;
    const rulesHash=await digest(game.server_code),uiHash=await digest(canonical(original));
    const version9=game.version===9&&uiHash===backgammonVersion9UIHash;
    if(rulesHash===modernBackgammonRulesHash&&(version9||brokenBoardPackages.has(uiHash))){
      const repaired=JSON.parse(JSON.stringify(original));
      repaired.assets.board_art={...replacement.assets.board_art};
      if(version9)repaired.piece_types.die.action_outline='rect';
      return repaired;
    }
    const modern=rulesHash===modernBackgammonRulesHash&&uiHash===modernBackgammonUIHash;
    if(!modern&&(!ruleHashes.has(rulesHash)||!uiHashes.has(uiHash)))return original;
    if(await digest(canonical(replacement))!==replacementHash)return original;
    // Only this exact reviewed presentation changes. Pinned rules, schemas,
    // game versions and cached authored packages remain untouched.
    return JSON.parse(JSON.stringify(replacement));
  }catch{return original;}
}
