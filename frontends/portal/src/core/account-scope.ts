// Work started under an older account must stop before it updates the current UI.
export class AccountScopeChangedError extends Error {
  constructor() { super('Account changed'); }
}

export function visibleErrorMessage(error: unknown): string | null {
  if (error instanceof AccountScopeChangedError) return null;
  return error instanceof Error ? error.message : String(error);
}
