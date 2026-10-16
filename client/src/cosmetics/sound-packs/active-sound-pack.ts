import type { SoundPack } from '../../audio/sound-pack';
import { useAccountStore } from '../../stores/account-store';
import { resolveSoundPack } from './sound-packs';

/** Read at play time so equipping or unequipping applies to the next cue without a reload. */
export function getActiveSoundPack(): SoundPack {
  return resolveSoundPack(useAccountStore.getState().account?.soundPack);
}
