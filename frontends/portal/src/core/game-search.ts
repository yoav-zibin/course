import type {Game} from './types';

// Upper/lower expansion handles caseless word prefixes (including ß and final
// sigma) before bounding the query sent to the backend's word-prefix index.
export function gameSearchWords(value: string): string[] {
  return value.normalize('NFC').toUpperCase().toLowerCase().replace(/ß/g,'ss').replace(/ς/g,'σ').match(/[\p{L}\p{N}_]+/gu) || [];
}

export function gameSearchPrefix(value: string): string | null {
  const word=gameSearchWords(value).filter(word=>Array.from(word).length>=2).sort((a,b)=>Array.from(b).length-Array.from(a).length)[0];
  return word ? Array.from(word).slice(0,24).join('') : null;
}

export function gameSuggestions(games: Game[], query: string, limit = 6): Game[] {
  const words=gameSearchWords(query);
  if(!words.length)return [];
  const phrase=words.join(' ');
  const score=(name:string)=>{
    const title=gameSearchWords(name),joined=title.join(' ');
    if(!words.every(word=>title.some(part=>part.startsWith(word))))return Infinity;
    return joined===phrase?0:joined.startsWith(phrase)?1:2;
  };
  const unique=new Map<string,{game:Game;score:number}>();
  for(const game of games){
    if(!game||typeof game.id!=='string'||typeof game.name!=='string')continue;
    const names=[game.name,game._sourceText?.name,...(game.alternative_names??[])];
    const rank=Math.min(...names.filter((name):name is string=>typeof name==='string').map(score));
    if(Number.isFinite(rank)&&(!unique.has(game.id)||rank<unique.get(game.id)!.score))unique.set(game.id,{game,score:rank});
  }
  return [...unique.values()].sort((a,b)=>a.score-b.score||a.game.name.localeCompare(b.game.name)).slice(0,limit).map(item=>item.game);
}
