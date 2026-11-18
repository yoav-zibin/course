import type { Account } from './types';
import { readCampaignCode } from './attribution';
export class ApiError extends Error { constructor(public status: number, message: string, public detail?: any) { super(message); } }
export class PortalApi {
  constructor(public baseUrl: string, private locale: () => string = () => 'en', public fetcher: typeof fetch = fetch) {}
  async request<T = any>(method: string, path: string, body?: any, account?: Account | null, requestId?: string): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) throw new Error('Invalid API path');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const headers: Record<string, string> = { 'Accept-Language': this.locale() };
      const campaign=await readCampaignCode();if(campaign&&campaign!==account?.password)headers['X-Campaign-Code']=campaign;
      if (account) { headers['X-User-Id'] = account.id; headers['X-User-Password'] = account.password; }
      if (requestId) headers['Idempotency-Key'] = requestId;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      // Browser fetch is a Web IDL function: invoking it as this.fetcher binds
      // the PortalApi instance and throws Illegal invocation before networking.
      const fetcher = this.fetcher;
      const response = await fetcher(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
      const text = await response.text(); let value: any;
      try { value = text ? JSON.parse(text) : null; } catch { throw new ApiError(response.status || 502, 'Invalid server response'); }
      if (!response.ok) { const detail = value?.detail; throw new ApiError(response.status, typeof detail === 'string' ? detail : detail?.message || response.statusText || 'Request failed', detail); }
      return value;
    } finally { clearTimeout(timeout); }
  }
}
