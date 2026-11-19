// Metro chooses .native/.web; Node and TypeScript use the web no-op by default.
export { readLegacyPortal, readLocalUiTest, protectBugControlGesture } from './legacy.web';
export type { LegacyPortalExport, LegacyPortalUser } from './legacy.types';
