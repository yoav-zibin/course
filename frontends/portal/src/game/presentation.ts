import * as Crypto from 'expo-crypto';
import { reviewedPresentation } from './presentationCore';

export const presentationForGame=(game:Parameters<typeof reviewedPresentation>[0])=>reviewedPresentation(game,
  source=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,source));
