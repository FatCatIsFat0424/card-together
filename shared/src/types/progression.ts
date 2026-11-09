import type { CollectionEntryId, ProgressionGameType, ProgressionRewardId } from '../constants/progression';

export interface ProgressionStatus {
  readonly level: {
    readonly level: number;
    readonly games: number;
    readonly totalXp: string;
    readonly currentLevelXp: number;
    readonly nextLevelXp: number | null;
    readonly gamesToNextLevel: number | null;
  };
  readonly familiarity: readonly {
    readonly gameType: ProgressionGameType;
    readonly games: number;
    readonly stage: number;
    readonly nextTarget: number | null;
    readonly since: number | null;
  }[];
  readonly collection: readonly {
    readonly id: CollectionEntryId;
    readonly gameType: ProgressionGameType;
    readonly recordId: string;
    readonly rare: boolean;
    readonly count: number | null;
    /** Rare entries have one unlock stamp; only common stamps contribute to the total. */
    readonly stamps: number;
    readonly tracked: boolean;
    readonly since: number | null;
  }[];
  readonly stamps: number;
  readonly rewards: readonly {
    readonly id: ProgressionRewardId;
    readonly eligible: boolean;
    readonly claimed: boolean;
  }[];
}
