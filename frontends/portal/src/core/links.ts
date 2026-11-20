export type PlayerLink = {kind: 'match' | 'game' | 'invite' | 'rematch' | 'app-login'; id: string} | {kind: 'screen'; id: 'games' | 'matches' | 'local'};

/** Shared by cold starts, native URL events and browser history navigation. */
export function playerLink(raw: string, baseUrl: string): PlayerLink | null {
  try {
    const base = new URL(baseUrl), url = new URL(raw, base);
    if (url.username || url.password || (url.protocol !== 'buildplay:' && (!['https:', 'http:'].includes(url.protocol) || url.origin !== base.origin))) return null;
    const path = url.protocol === 'buildplay:' && url.hostname === 'invite' ? `/invite${url.pathname}` : url.pathname;
    const canonicalInvite = /^\/invite\/([a-z]{4})\/?$/.exec(path);
    if (canonicalInvite) return {kind: 'invite', id: canonicalInvite[1]};
    const legacyInvite = /^\/i\/([A-Za-z0-9_-]+)$/.exec(path);
    if (legacyInvite) return {kind: 'invite', id: legacyInvite[1]};
    if (!['', '/', '/portal', '/static/portal.html', '/static/app/', '/static/app/index.html'].includes(path)) return null;
    const fragment = new URLSearchParams(url.hash.slice(1));
    for (const kind of ['app-login', 'rematch', 'invite', 'match', 'game'] as const) {
      const id = fragment.get(kind) || (kind !== 'app-login' ? url.searchParams.get(kind) : null);
      if (id && /^[A-Za-z0-9_-]{1,128}$/.test(id)) return {kind, id};
    }
    const screen = url.hash.slice(1);
    if (['games', 'matches', 'local'].includes(screen)) return {kind: 'screen', id: screen as 'games' | 'matches' | 'local'};
    // Retired Portal destinations return to the catalog. An empty fragment
    // leaves cold-start restoration of a saved match undisturbed.
    return screen ? {kind: 'screen', id: 'games'} : null;
  } catch { return null; }
}

export function matchInviteUrl(code: string, baseUrl: string): string | null {
  if (!/^[a-z]{4}$/.test(code)) return null;
  try { return `${new URL(baseUrl).origin}/invite/${code}`; } catch { return null; }
}
