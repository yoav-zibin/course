import { requireOptionalNativeModule } from 'expo-modules-core';
interface LegacyPortalModule {
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
