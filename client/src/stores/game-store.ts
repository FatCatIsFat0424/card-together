import type { SpadesVisibleState } from '@shared/games/spades/types';
import type { HeartsVisibleState } from '@shared/games/hearts/types';
import type { YachtVisibleState } from '@shared/games/yacht/types';
// ─── Game Store ───

import { scopedStore } from './scoped-store';
import type {
  Card,
  GameSeat,
  Contract,
  BiddingState,
  PlayingState,
  GamePhase,
  GameResult,
  GameLogEntry,
  GameType,
  BigTwoVisibleState,
  PlayerVisibleGameState,
  RedPointsVisibleState,
  NinetyNineVisibleState,
  SevensVisibleState,
  ChinesePokerVisibleState,
  LiarsDeckVisibleState,
  LiarsDiceVisibleState,
  ReversiVisibleState,
  GomokuVisibleState,
  GoVisibleState,
  JungleVisibleState,
  BlackjackVisibleState,
  HoldemVisibleState,
  NapoleonVisibleState,
  TenHalfVisibleState,
  StudVisibleState,
  OldMaidVisibleState,
  DouDizhuVisibleState,
  XiangqiVisibleState,
  ChessVisibleState,
  LandBattleVisibleState,
  BattleshipVisibleState,
  CodeBreakerVisibleState,
} from '@shared/types';
import type { CrazyEightsVisibleState } from '@shared/games/crazyeights/types';
import type { DominoesVisibleState } from '@shared/games/dominoes/types';
import type { GongZhuVisibleState } from '@shared/games/gongzhu/types';
import type { GoFishVisibleState } from '@shared/games/gofish/types';
import type { BanqiVisibleState } from '@shared/games/banqi/types';
import type { ChineseCheckersVisibleState } from '@shared/games/chinesecheckers/types';
import { clientGame } from '../games/registry';
import type { HeldHoleCards } from '../games/holdem/holdem-view';
import { equalSnapshotValue } from './snapshot-equality';

/** Bridge state lives in the individual fields; other games keep their whole visible state in one field. */
export interface GameStoreState {
  visible: PlayerVisibleGameState | null;
  presentationReceivedAt: number;
  bigTwo: BigTwoVisibleState | null;
  redPoints: RedPointsVisibleState | null;
  ninetyNine: NinetyNineVisibleState | null;
  sevens: SevensVisibleState | null;
  chinesePoker: ChinesePokerVisibleState | null;
  liarsDeck: LiarsDeckVisibleState | null;
  liarsDice: LiarsDiceVisibleState | null;
  blackjack: BlackjackVisibleState | null;
  holdem: HoldemVisibleState | null;
  /** Hold'em: my hole cards from the previous hand while its presentation may still be playing */
  holdemHeld: HeldHoleCards | null;
  napoleon: NapoleonVisibleState | null;
  tenhalf: TenHalfVisibleState | null;
  crazyEights: CrazyEightsVisibleState | null;
  stud: StudVisibleState | null;
  reversi: ReversiVisibleState | null;
  gomoku: GomokuVisibleState | null;
  go: GoVisibleState | null;
  jungle: JungleVisibleState | null;
  /** Stud: my hole card from the previous hand while its presentation may still be playing */
  studHeld: HeldHoleCards | null;
  oldMaid: OldMaidVisibleState | null;
  spades: SpadesVisibleState | null;
  hearts: HeartsVisibleState | null;
  yacht: YachtVisibleState | null;
  goFish: GoFishVisibleState | null;
  gongzhu: GongZhuVisibleState | null;
  doudizhu: DouDizhuVisibleState | null;
  xiangqi: XiangqiVisibleState | null;
  chess: ChessVisibleState | null;
  banqi: BanqiVisibleState | null;
  chineseCheckers: ChineseCheckersVisibleState | null;
  landbattle: LandBattleVisibleState | null;
  battleship: BattleshipVisibleState | null;
  codebreaker: CodeBreakerVisibleState | null;
  dominoes: DominoesVisibleState | null;
  gameType: GameType | null;
  phase: GamePhase | null;
  myHand: Card[];
  dealerSeat: GameSeat | null;
  currentTurnSeat: GameSeat | null;
  validCards: Card[];
  bidding: BiddingState | null;
  contract: Contract | null;
  playing: PlayingState | null;
  result: GameResult | null;
  log: GameLogEntry[];
  redealPendingSeat: GameSeat | null;
}

interface GameStoreActions {
  restore: (game: PlayerVisibleGameState) => void;
  reset: () => void;
}

const initialState: GameStoreState = {
  visible: null,
  presentationReceivedAt: 0,
  bigTwo: null,
  redPoints: null,
  ninetyNine: null,
  sevens: null,
  chinesePoker: null,
  liarsDeck: null,
  liarsDice: null,
  blackjack: null,
  holdem: null,
  holdemHeld: null,
  napoleon: null,
  tenhalf: null,
  crazyEights: null,
  stud: null,
  reversi: null,
  gomoku: null,
  go: null,
  jungle: null,
  studHeld: null,
  oldMaid: null,
  spades: null,
  hearts: null,
  yacht: null,
  goFish: null,
  gongzhu: null,
  doudizhu: null,
  xiangqi: null,
  chess: null,
  banqi: null,
  chineseCheckers: null,
  landbattle: null,
  battleship: null,
  codebreaker: null,
  dominoes: null,
  gameType: null,
  phase: null,
  myHand: [],
  dealerSeat: null,
  currentTurnSeat: null,
  validCards: [],
  bidding: null,
  contract: null,
  playing: null,
  result: null,
  log: [],
  redealPendingSeat: null,
};

export const useGameStore = scopedStore<GameStoreState & GameStoreActions>((set) => ({
  ...initialState,
  restore: (game) => set((state) => {
    // One deep comparison per snapshot: a game's own field always holds the same object as `visible`.
    const unchanged = equalSnapshotValue(state.visible, game);
    const retain = <T>(previous: T | null, next: T): T => unchanged && previous ? previous : next;
    const nextState: GameStoreState = {
      ...initialState,
      gameType: game.gameType,
      ...clientGame(game.gameType).restoreSnapshot(game, { state, retain }),
    };
    nextState.visible = unchanged ? state.visible : game;
    nextState.presentationReceivedAt = nextState.visible === state.visible
      ? state.presentationReceivedAt : Date.now();
    return (Object.keys(nextState) as (keyof GameStoreState)[])
      .every((key) => Object.is(state[key], nextState[key])) ? state : nextState;
  }),
  reset: () => set((state) => (Object.keys(initialState) as (keyof GameStoreState)[])
    .every((key) => equalSnapshotValue(state[key], initialState[key])) ? state : initialState),
}));
