import type {AccountData} from './types';

const knownGame=(value:any)=>typeof value?.game_id==='string'&&value.game_id.length>0&&Number.isSafeInteger(value.game_version)&&value.game_version>=1;
export function protectedResponsePaths(data: AccountData, activeGame?: {id: string; version?: number}): Set<string> {
  const matches = new Set([...Object.keys(data.queues), ...Object.keys(data.conflicts), ...Object.keys(data.local), ...(data.selectedId ? [data.selectedId] : [])]);
  const knownGames = new Set<string>();
  const paths = new Set<string>(); const visited = new Set<object>(); let inspected = 0, conservative = false;
  const inspect = (value: any, depth = 0) => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    if (depth > 40 || ++inspected > 20000) {conservative=true;return;}
    visited.add(value);
    if(typeof value.id==='string'&&(Array.isArray(value.moves)||value.conflict||value.source)){matches.add(value.id);if(knownGame(value.match))knownGames.add(value.id);}
    if (knownGame(value)) {
      paths.add(`/games/${value.game_id}/versions/${value.game_version}`);
      paths.add(`/games/${encodeURIComponent(value.game_id)}/versions/${value.game_version}`);
      if (typeof value.id === 'string') {matches.add(value.id);knownGames.add(value.id);}
    }
    for (const [key, child] of Object.entries(value)) {if (/^\/games\/[^/]+\/versions\/[^/?]+$/.test(key)) paths.add(key); inspect(child,depth+1);}
  };
  inspect(data.local); inspect(data.archives); inspect(data.archivedMatches);
  for (const id of matches) {
    const references=[data.local[id],data.responses[`/matches/${id}`],data.responses[`/matches/${encodeURIComponent(id)}`],data.conflicts[id]?.remote];
    if(references.some(knownGame))knownGames.add(id);
    for(const value of references)inspect(value);
    if(!knownGames.has(id))conservative=true;
  }
  for (const path of Object.keys(data.responses)) {
    const match = /^\/(?:v2\/)?matches\/([^/?]+)(?:\/(?:history|moves))?(?:\?|$)/.exec(path);
    let id = match?.[1]; try {if (id) id=decodeURIComponent(id);} catch { /* Retain the literal identity. */ }
    if (id && matches.has(id)) paths.add(path);
    if (activeGame && (path === `/games/${activeGame.id}` || path === `/games/${encodeURIComponent(activeGame.id)}`
      || (activeGame.version === undefined ? path.startsWith(`/games/${encodeURIComponent(activeGame.id)}/versions/`) : path === `/games/${encodeURIComponent(activeGame.id)}/versions/${activeGame.version}`))) paths.add(path);
    if (conservative) paths.add(path);
  }
  return paths;
}
