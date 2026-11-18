import { requireNativeModule } from 'expo-modules-core';
import { MAX_SOURCE, MAX_RESULT } from './runtimeSource';

export async function evaluate(source: string): Promise<string> {
  if (source.length > MAX_SOURCE) throw new Error('Game source exceeds its size limit');
  const runtime = requireNativeModule<{evaluate(source: string): Promise<string>}>('BuildPlayRuntime');
  const value = await runtime.evaluate(source);
  if (typeof value !== 'string' || value.length > MAX_RESULT) throw new Error('Game output exceeds its size limit');
  return value;
}
