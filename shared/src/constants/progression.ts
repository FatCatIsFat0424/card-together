export const MAX_PLAYER_LEVEL = 50;
export const EXPERIENCE_PER_GAME = 100;
export const FAMILIARITY_TARGETS = [1, 5, 15, 30, 60] as const;
export const COLLECTION_STAMP_TARGETS = [1, 5, 20] as const;
export const PROGRESSION_GAME_TYPES = ['bigtwo', 'liarsdice'] as const;

export type ProgressionGameType = typeof PROGRESSION_GAME_TYPES[number];
export type CollectionEntryId = 'bigtwo.fullHouses' | 'liarsdice.callsWon' | 'liarsdice.bidsHeld'
  | 'bigtwo.dragons' | 'bigtwo.straightFlushes' | 'bigtwo.fourOfAKinds' | 'liarsdice.exactBids';

export const PROGRESSION_REWARDS = [
  { id: 'level-5', nameplate: 'nameplate-level-5', kind: 'level', target: 5 },
  { id: 'level-10', nameplate: 'nameplate-level-10', kind: 'level', target: 10 },
  { id: 'level-15', nameplate: 'nameplate-level-15', kind: 'level', target: 15 },
  { id: 'level-20', nameplate: 'nameplate-level-20', kind: 'level', target: 20 },
  { id: 'level-25', nameplate: 'nameplate-level-25', kind: 'level', target: 25 },
  { id: 'level-30', nameplate: 'nameplate-level-30', kind: 'level', target: 30 },
  { id: 'level-35', nameplate: 'nameplate-level-35', kind: 'level', target: 35 },
  { id: 'level-40', nameplate: 'nameplate-level-40', kind: 'level', target: 40 },
  { id: 'level-45', nameplate: 'nameplate-level-45', kind: 'level', target: 45 },
  { id: 'level-50', nameplate: 'nameplate-level-50', kind: 'level', target: 50 },
  { id: 'bigtwo-5', nameplate: 'nameplate-bigtwo-regular', kind: 'familiarity', target: 5, gameType: 'bigtwo' },
  { id: 'bigtwo-30', nameplate: 'nameplate-bigtwo-veteran', kind: 'familiarity', target: 30, gameType: 'bigtwo' },
  { id: 'liarsdice-5', nameplate: 'nameplate-liarsdice-regular', kind: 'familiarity', target: 5, gameType: 'liarsdice' },
  { id: 'liarsdice-30', nameplate: 'nameplate-liarsdice-veteran', kind: 'familiarity', target: 30, gameType: 'liarsdice' },
  { id: 'collection-1', nameplate: 'nameplate-record-seeker', kind: 'collection', target: 1 },
  { id: 'collection-3', nameplate: 'nameplate-record-keeper', kind: 'collection', target: 3 },
  { id: 'collection-6', nameplate: 'nameplate-record-curator', kind: 'collection', target: 6 },
] as const;

export type ProgressionRewardId = typeof PROGRESSION_REWARDS[number]['id'];
export type ProgressionNameplateId = typeof PROGRESSION_REWARDS[number]['nameplate'];

export function isProgressionRewardId(value: unknown): value is ProgressionRewardId {
  return PROGRESSION_REWARDS.some((reward) => reward.id === value);
}
