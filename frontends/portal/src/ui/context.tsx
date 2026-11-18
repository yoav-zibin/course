import React, {createContext, useContext} from 'react';
import {usePortal} from '../core';
import {t} from '../platform/i18n';

export type Portal = ReturnType<typeof usePortal>;
export type Screen = 'games' | 'matches' | 'local' | 'invites' | 'settings';
export type AppContext = { p: Portal; notify: (message: string) => void; run: (task: () => Promise<unknown>) => Promise<void>; openAccount: () => void; navigate: (screen: Screen) => void; openGame: (id: string) => Promise<void>; openMatch: (id: string) => Promise<void> };
export const Context = createContext<AppContext | null>(null);
export function useApp() { const value = useContext(Context); if (!value) throw new Error('App context missing'); return value; }

// Keep the established locale keys so the same translation catalog serves every client.
export function text(p: Portal, key: string, fallback: string, params: Record<string, unknown> = {}) {
  return t(key, params, fallback);
}
