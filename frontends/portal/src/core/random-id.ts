export function requestId():string{return globalThis.crypto?.randomUUID?.()??`portal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;}
