import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { PortalApi } from '../core/api';
import { loginSession, callbackCode } from './browser-login-protocol';
export async function browserLogin(baseUrl: string): Promise<any> {
  const verifier = Array.from(await Crypto.getRandomBytesAsync(32)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  const challenge = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier);
  const api = new PortalApi(baseUrl);
  const session = loginSession(baseUrl, await api.request('POST', '/auth/app-sessions', { challenge }));
  const result = await WebBrowser.openAuthSessionAsync(session.loginUrl, 'buildplay://auth');
  if (result.type !== 'success') throw new Error('Browser sign-in was cancelled.');
  const code = callbackCode(session.sessionId, result.url);
  // The verifier and API credential never appear in a URL or the game runtime.
  return api.request('POST', `/auth/app-sessions/${encodeURIComponent(session.sessionId)}/exchange`, { verifier, code });
}
