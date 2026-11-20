import {Share} from 'react-native';
export async function shareInvite(url: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const result = await Share.share({message: url});
  return result.action === Share.dismissedAction ? 'cancelled' : 'shared';
}
