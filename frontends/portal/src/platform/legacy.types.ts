export interface LegacyPortalUser {
  id: string;
  password: string;
  display_name?: string;
}

/** Raw legacy saves are archives, never executable packages or outgoing queues. */
export interface LegacyPortalExport {
  android?: {
    user?: LegacyPortalUser;
    selectedMatchId?: string;
    raw?: unknown;
  };
  ios?: {
    identity?: LegacyPortalUser;
    portal?: unknown;
    onlineSnapshots?: Record<string, unknown>;
    /** Base64 originals for saves whose JSON could not be decoded. */
    rawFiles?: Record<string, string>;
  };
  errors?: string[];
}
