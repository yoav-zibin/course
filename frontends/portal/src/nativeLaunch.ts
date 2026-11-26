import { Linking } from 'react-native';
import { portal } from './core';
import { readLocalUiTest } from './platform/legacy';

let launch: Promise<{url: string | null; bootstrap: Promise<void>}> | undefined;

export function nativeLaunch() {
  return launch ??= Linking.getInitialURL().catch(() => null).then(url => {
    const bootstrap = portal.bootstrap(undefined, readLocalUiTest(), url ?? undefined);
    // The root observes failures when it mounts, including a failure before mount.
    void bootstrap.catch(() => {});
    return {url: url ?? null, bootstrap};
  });
}
