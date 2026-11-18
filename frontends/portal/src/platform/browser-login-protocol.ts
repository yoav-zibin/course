const opaque = /^[A-Za-z0-9_-]{43,128}$/;
function parseUrl(value: string): URL { try { return new URL(value); } catch { throw new Error('The sign-in service returned an invalid URL.'); } }
export function loginSession(baseUrl: string, response: any): { sessionId: string; loginUrl: string } {
  if (typeof response?.session_id !== 'string' || !opaque.test(response.session_id) || typeof response?.login_url !== 'string') throw new Error('The sign-in service returned an invalid session.');
  const base = parseUrl(baseUrl), target = parseUrl(response.login_url);
  if (!['https:', 'http:'].includes(base.protocol) || target.origin !== base.origin || target.username || target.password || target.pathname !== '/portal' || target.search || target.hash !== `#app-login=${response.session_id}`) throw new Error('The sign-in page does not match this server.');
  return { sessionId: response.session_id, loginUrl: target.href };
}
export function callbackCode(sessionId: string, url: string): string {
  const callback = parseUrl(url); const code = callback.searchParams.get('code');
  if (callback.protocol !== 'buildplay:' || callback.hostname !== 'auth' || callback.username || callback.password || callback.port || !['','/'].includes(callback.pathname) || callback.hash || callback.searchParams.getAll('session').length !== 1 || callback.searchParams.get('session') !== sessionId || callback.searchParams.getAll('code').length !== 1 || !code || !opaque.test(code) || [...callback.searchParams.keys()].some(key => key !== 'session' && key !== 'code')) throw new Error('Sign-in returned an unexpected session or authorization code. Please try again.');
  return code;
}
