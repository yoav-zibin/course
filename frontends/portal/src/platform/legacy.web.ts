import type { LegacyPortalExport } from './legacy.types';

export type { LegacyPortalExport, LegacyPortalUser } from './legacy.types';

export function readLocalUiTest(): boolean { return false; }
export async function protectBugControlGesture(_viewTag: number): Promise<boolean> { return false; }

export async function readLegacyPortal(_baseUrl: string): Promise<LegacyPortalExport> {
  return {};
}
