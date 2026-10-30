import type { GameOptions, GameSeat, PlayerVisibleGameState, ReplayPatchOp } from '../../shared/src/types';

export interface DemoStep {
  readonly index: number;
  readonly actingSeat: GameSeat;
  readonly action: unknown;
  readonly chapter: string;
  readonly patch: readonly ReplayPatchOp[];
}

export interface DemoFixture {
  readonly code: string;
  readonly focusSeat: GameSeat;
  readonly seats: readonly GameSeat[];
  readonly initial: PlayerVisibleGameState;
  readonly steps: readonly DemoStep[];
  readonly result: NonNullable<PlayerVisibleGameState['result']>;
  readonly roomOptions?: GameOptions;
}
