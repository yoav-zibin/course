import * as Clipboard from 'expo-clipboard';
export async function shareInvite(url: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (typeof navigator.share === 'function') {
    try {await navigator.share({url}); return 'shared';}
    catch (error) {if (error instanceof Error && error.name === 'AbortError') return 'cancelled'; throw error;}
  }
  await Clipboard.setStringAsync(url);
  return 'copied';
}
