import { CAMPAIGN_SOUND_PACKS } from './designs/campaign';
import type { SoundPackId } from '@shared/types';
import { CLASSIC_SOUND_PACK } from '../../audio/classic-sound-pack';
import { PACK_CUE_TRIM_DB, calibratePack } from '../../audio/sound-levels';
import type { SoundPack } from '../../audio/sound-pack';
import { AURORA_SOUND_PACK } from './designs/aurora';
import { BAMBOO_SOUND_PACK } from './designs/bamboo';
import { CONSTELLATION_SOUND_PACK } from './designs/constellation';
import { DUNE_SOUND_PACK } from './designs/dune';
import { EMBER_SOUND_PACK } from './designs/ember';
import { FROST_SOUND_PACK } from './designs/frost';
import { GILDED_SOUND_PACK } from './designs/gilded';
import { LOTUS_SOUND_PACK } from './designs/lotus';
import { SAKURA_SOUND_PACK } from './designs/sakura';
import { TIDE_SOUND_PACK } from './designs/tide';

export const SOUND_PACK_DEFINITIONS: Readonly<Record<SoundPackId, SoundPack>> = {
  ...CAMPAIGN_SOUND_PACKS,
  'sound-aurora': AURORA_SOUND_PACK,
  'sound-tide': TIDE_SOUND_PACK,
  'sound-sakura': SAKURA_SOUND_PACK,
  'sound-constellation': CONSTELLATION_SOUND_PACK,
  'sound-bamboo': BAMBOO_SOUND_PACK,
  'sound-gilded': GILDED_SOUND_PACK,
  'sound-ember': EMBER_SOUND_PACK,
  'sound-lotus': LOTUS_SOUND_PACK,
  'sound-frost': FROST_SOUND_PACK,
  'sound-dune': DUNE_SOUND_PACK,
};

const CALIBRATED_CLASSIC = calibratePack(CLASSIC_SOUND_PACK, PACK_CUE_TRIM_DB.classic);
const CALIBRATED_PACKS: Readonly<Record<SoundPackId, SoundPack>> = Object.fromEntries(
  Object.entries(SOUND_PACK_DEFINITIONS).map(([id, pack]) => [id, calibratePack(pack, PACK_CUE_TRIM_DB[pack.id])]),
) as Record<SoundPackId, SoundPack>;

/**
 * The pack to play, with every cue trimmed to the shared target loudness. Unknown or missing ids fall back to the
 * classic tones, e.g. a pack from a newer client.
 */
export function resolveSoundPack(id: string | null | undefined): SoundPack {
  return id && Object.hasOwn(CALIBRATED_PACKS, id) ? CALIBRATED_PACKS[id as SoundPackId] : CALIBRATED_CLASSIC;
}
