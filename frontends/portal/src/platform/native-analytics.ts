import {requireOptionalNativeModule} from 'expo-modules-core';
import {createWorkletRuntime, runOnRuntimeAsync} from 'react-native-worklets';
import type {AnalyticsScreen} from './analytics-session';

interface AnalyticsBinding {
  access(operation: string, id: string, screen: string): void;
}

function update(binding: AnalyticsBinding, id: string, screen: string) {
  'worklet';
  binding.access('view', id, screen);
}

function initialize() {
  const module = requireOptionalNativeModule<{installAnalyticsWorklet(): void}>('LegacyPortal');
  if (!module?.installAnalyticsWorklet) return null;
  module.installAnalyticsWorklet();
  const globals = globalThis as typeof globalThis & {__buildPlayAnalyticsBinding?: AnalyticsBinding};
  const binding = globals.__buildPlayAnalyticsBinding;
  delete globals.__buildPlayAnalyticsBinding;
  if (!binding) return null;
  const runtime = createWorkletRuntime({name: 'Firebase Analytics', enableEventLoop: false});
  return {binding, runtime};
}

let worker: ReturnType<typeof initialize> | undefined;
export function publishNativeView(id: string | null, screen: AnalyticsScreen) {
  // The Worklet owns the SDK calls. Identity and a fixed screen name are the
  // only values handed off from React. Games and storage use separate runtimes.
  if (worker === undefined) worker = initialize();
  if (worker) void runOnRuntimeAsync(worker.runtime, update, worker.binding, id ?? '', screen).catch(() => {});
}
