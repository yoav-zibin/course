import { requireOptionalNativeModule } from 'expo-modules-core';
import type { LegacyPortalExport } from './legacy.types';

export type { LegacyPortalExport, LegacyPortalUser } from './legacy.types';

interface LegacyPortalModule {
  readLegacyPortal(baseUrl: string): Promise<string>;
  readLocalUiTest(): boolean;
}

export function readLocalUiTest(): boolean {
  return requireOptionalNativeModule<LegacyPortalModule>('LegacyPortal')?.readLocalUiTest() === true;
}

export async function readLegacyPortal(baseUrl: string): Promise<LegacyPortalExport> {
  const module = requireOptionalNativeModule<LegacyPortalModule>('LegacyPortal');
  if (!module) return {};
  try {
    return JSON.parse(await module.readLegacyPortal(baseUrl)) as LegacyPortalExport;
  } catch {
    return { errors: ['The previous app data could not be read. Its original files and account have been preserved.'] };
  }
}
