/** Archives may contain old serialized preference records, but they must never
 * copy credentials out of Keychain/Keystore into ordinary device storage. */
export function redactedArchive(raw: any): string {
  const credential = (key: string) => /^(password|passwd|x[-_]user[-_]password|authorization|id[-_]token|access[-_]token|refresh[-_]token)$/i.test(key);
  const secrets = new Set<string>(); const seen = new Set<object>();
  const visit = (value: any) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return; seen.add(value);
    for (const [key, child] of Object.entries(value)) { if (credential(key) && typeof child === 'string' && child.length >= 4) secrets.add(child); else visit(child); }
  };
  visit(raw);
  let text = JSON.stringify(raw, (key, value) => credential(key) ? '[redacted; retained in secure storage]' : value);
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  return text;
}
