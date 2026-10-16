import type { SoundPackId } from '@shared/types';
import { CLASSIC_SOUND_PACK } from '../../audio/classic-sound-pack';
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

/** Unknown or missing ids fall back to the classic tones, e.g. a pack from a newer client. */
export function resolveSoundPack(id: string | null | undefined): SoundPack {
  return id && Object.hasOwn(SOUND_PACK_DEFINITIONS, id)
    ? SOUND_PACK_DEFINITIONS[id as SoundPackId] : CLASSIC_SOUND_PACK;
}
