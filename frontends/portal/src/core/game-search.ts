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

export function gameSuggestionMatches(games: Game[], query: string, limit = 6) {
  const words=gameSearchWords(query);
  if(!words.length)return [];
  const phrase=words.join(' ');
  const score=(name:string)=>{
    const title=gameSearchWords(name),joined=title.join(' ');
    if(!words.every(word=>title.some(part=>part.startsWith(word))))return Infinity;
    return joined===phrase?0:joined.startsWith(phrase)?1:2;
  };
  const unique=new Map<string,{game:Game;score:number;alternativeName?:string}>();
  for(const game of games){
    if(!game||typeof game.id!=='string'||typeof game.name!=='string')continue;
    const sourceName=game._sourceText?.name;
    let rank=Math.min(score(game.name),typeof sourceName==='string'?score(sourceName):Infinity);
    let alternativeName:string|undefined;
    for(const name of game.alternative_names??[]){
      if(typeof name!=='string')continue;
      const alternativeRank=score(name);
      if(alternativeRank<rank){
        rank=alternativeRank;
        alternativeName=name;
      }
    }
    const existing=unique.get(game.id);
    if(Number.isFinite(rank)&&(!existing||rank<existing.score||(rank===existing.score&&existing.alternativeName&&!alternativeName))){
      unique.set(game.id,{game,score:rank,alternativeName});
    }
  }
  return [...unique.values()].sort((a,b)=>a.score-b.score||a.game.name.localeCompare(b.game.name)).slice(0,limit);
}

export function gameSuggestions(games: Game[], query: string, limit = 6): Game[] {
  return gameSuggestionMatches(games,query,limit).map(({game})=>game);
}
