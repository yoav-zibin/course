// CI substitutes this entry into a disposable copy of the release app.
import React, {useEffect} from 'react';
import {Text} from 'react-native';
import {registerRootComponent} from 'expo';
// The probe is copied to the portal root before Metro resolves these imports.
import {publishNativeView} from './src/platform/native-analytics';
import {setItem} from './src/platform/storage';

function Probe() {
  useEffect(() => {
    requestIdleCallback(async () => {
      const results = [];
      try {
        for (const [id, screen] of [['ci-analytics-probe', 'games'], ['ci-analytics-probe', 'match'], [null, 'games']]) {
          const start = performance.now();
          const pending = publishNativeView(id, screen);
          const submitted = performance.now();
          const status = await pending;
          results.push({screen, status, submitMs: submitted - start, completeMs: performance.now() - start});
        }
      } catch (failure) {
        results.push({error: String(failure)});
      }
      await setItem('ci.analytics.probe', JSON.stringify(results));
    });
  }, []);
  return React.createElement(Text, null, 'Analytics verification');
}
registerRootComponent(Probe);
