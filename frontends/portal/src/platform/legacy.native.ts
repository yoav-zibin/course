import { requireOptionalNativeModule } from 'expo-modules-core';
import type { LegacyPortalExport } from './legacy.types';

export type { LegacyPortalExport, LegacyPortalUser } from './legacy.types';

interface LegacyPortalModule {
  readLegacyPortal(baseUrl: string): Promise<string>;
  readLocalUiTest(): boolean;
  protectBugControlGesture?(viewTag: number): Promise<boolean>;
}

export function readLocalUiTest(): boolean {
  return requireOptionalNativeModule<LegacyPortalModule>('LegacyPortal')?.readLocalUiTest() === true;
}

/** Protect only the draggable control's actual Android view, including Modals. */
export async function protectBugControlGesture(viewTag: number): Promise<boolean> {
  const module = requireOptionalNativeModule<LegacyPortalModule>('LegacyPortal');
  return module?.protectBugControlGesture ? module.protectBugControlGesture(viewTag) : false;
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
