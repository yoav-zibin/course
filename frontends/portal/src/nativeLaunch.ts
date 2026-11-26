import { Linking } from 'react-native';
import { portal } from './core';
import { playerLink } from './core/links';
import { readLocalUiTest } from './platform/legacy';

let launch: Promise<{url: string | null; matchId?: string; bootstrap: Promise<void>}> | undefined;

export function nativeLaunch() {
  if (!launch) {
    const initialUrl=Linking.getInitialURL().then(url=>url??null,()=>null);
    const bootstrap=portal.bootstrap(undefined,readLocalUiTest(),initialUrl,true);
    void bootstrap.catch(()=>{});
    launch=initialUrl.then(url=>{
      const target=url && playerLink(url,process.env.EXPO_PUBLIC_API_URL || 'https://buildplay.fun');
      return {url,matchId:target && target.kind==='match' ? target.id : undefined,bootstrap};
    });
  }
  return launch;
}
