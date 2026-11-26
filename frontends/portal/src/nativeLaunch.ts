import { Linking } from 'react-native';
import { portal } from './core';
import { playerLink } from './core/links';
import { readLocalUiTest } from './platform/legacy';

let launch: Promise<{url: string | null; matchId?: string; bootstrap: Promise<void>}> | undefined;

export function nativeLaunch() {
  return launch ??= Linking.getInitialURL().catch(() => null).then(url => {
    const target=url && playerLink(url,process.env.EXPO_PUBLIC_API_URL || 'https://buildplay.fun');
    const matchId=target && target.kind==='match' ? target.id : undefined;
    const bootstrap = portal.bootstrap(undefined, readLocalUiTest(), url ?? undefined, matchId);
    // The root observes failures when it mounts, including a failure before mount.
    void bootstrap.catch(() => {});
    return {url: url ?? null, matchId, bootstrap};
  });
}
