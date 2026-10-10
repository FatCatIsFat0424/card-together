// ─── Game Store ───

import { create } from 'zustand';
import type {
  Card,
  Seat,
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
  BlackjackVisibleState,
  HoldemVisibleState,
} from '@shared/types';
import { nextHeldHoleCards } from '../games/holdem/holdem-view';
import type { HeldHoleCards } from '../games/holdem/holdem-view';
import { equalSnapshotValue, retainSnapshotValue } from './snapshot-equality';

/** Bridge state lives in the individual fields; other games keep their whole visible state in one field. */
interface GameStoreState {
  visible: PlayerVisibleGameState | null;
  presentationReceivedAt: number;
  bigTwo: BigTwoVisibleState | null;
  redPoints: RedPointsVisibleState | null;
  ninetyNine: NinetyNineVisibleState | null;
  sevens: SevensVisibleState | null;
  chinesePoker: ChinesePokerVisibleState | null;
  liarsDeck: LiarsDeckVisibleState | null;
  blackjack: BlackjackVisibleState | null;
  holdem: HoldemVisibleState | null;
  /** Hold'em: my hole cards from the previous hand while its presentation may still be playing */
  holdemHeld: HeldHoleCards | null;
  gameType: GameType | null;
  phase: GamePhase | null;
  myHand: Card[];
  dealerSeat: Seat | null;
  currentTurnSeat: Seat | null;
  validCards: Card[];
  bidding: BiddingState | null;
  contract: Contract | null;
  playing: PlayingState | null;
  result: GameResult | null;
  log: GameLogEntry[];
  redealPendingSeat: Seat | null;
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
  blackjack: null,
  holdem: null,
  holdemHeld: null,
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

export const useGameStore = create<GameStoreState & GameStoreActions>((set) => ({
  ...initialState,
  restore: (game) => set((state) => {
    const nextState: GameStoreState = game.gameType === 'bigtwo' ? {
      ...initialState,
      gameType: 'bigtwo',
      phase: game.phase,
      currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
      bigTwo: retainSnapshotValue(state.bigTwo, game),
    } : game.gameType === 'redpoints' ? {
      ...initialState,
      gameType: 'redpoints',
      phase: game.phase,
      currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
      redPoints: retainSnapshotValue(state.redPoints, game),
    } : game.gameType === 'ninetynine' ? {
      ...initialState,
      gameType: 'ninetynine',
      phase: game.phase,
      currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
      ninetyNine: retainSnapshotValue(state.ninetyNine, game),
    } : game.gameType === 'sevens' ? {
      ...initialState,
      gameType: 'sevens',
      phase: game.phase,
      currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
      sevens: retainSnapshotValue(state.sevens, game),
    } : game.gameType === 'chinesepoker' ? {
      ...initialState,
      gameType: 'chinesepoker',
      // The store phase only separates an active game from scoring; arranging is simultaneous,
      // so no single seat holds the turn.
      phase: game.phase === 'arranging' ? 'playing' : game.phase,
      chinesePoker: retainSnapshotValue(state.chinesePoker, game),
    } : game.gameType === 'liarsdeck' ? {
      ...initialState,
      gameType: 'liarsdeck',
      phase: game.phase,
      currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
      liarsDeck: retainSnapshotValue(state.liarsDeck, game),
    } : game.gameType === 'blackjack' ? {
      ...initialState,
      gameType: 'blackjack',
      // Betting is simultaneous, so no single seat holds the turn.
      phase: game.phase === 'betting' ? 'playing' : game.phase,
      currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
      blackjack: retainSnapshotValue(state.blackjack, game),
    } : game.gameType === 'holdem' ? {
      ...initialState,
      gameType: 'holdem',
      phase: game.phase,
      currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
      holdem: retainSnapshotValue(state.holdem, game),
      holdemHeld: nextHeldHoleCards(state.holdem, game, state.holdemHeld),
    } : {
      visible: null,
      presentationReceivedAt: 0,
      bigTwo: null,
      redPoints: null,
      ninetyNine: null,
      sevens: null,
      chinesePoker: null,
      liarsDeck: null,
      blackjack: null,
      holdem: null,
      holdemHeld: null,
      gameType: 'bridge',
      phase: game.phase,
      dealerSeat: game.dealerSeat,
      myHand: equalSnapshotValue(state.myHand, game.myHand) ? state.myHand : [...game.myHand],
      log: equalSnapshotValue(state.log, game.log) ? state.log : [...game.log],
      currentTurnSeat: game.playing?.currentTurnSeat ?? game.bidding?.currentBidderSeat ?? null,
      validCards: equalSnapshotValue(state.validCards, game.validCards)
        ? state.validCards : [...game.validCards],
      bidding: retainSnapshotValue(state.bidding, game.bidding),
      contract: retainSnapshotValue(state.contract, game.contract),
      playing: retainSnapshotValue(state.playing, game.playing),
      result: retainSnapshotValue(state.result, game.result),
      redealPendingSeat: game.redealPendingSeat,
    };
    nextState.visible = retainSnapshotValue(state.visible, game);
    nextState.presentationReceivedAt = nextState.visible === state.visible
      ? state.presentationReceivedAt : Date.now();
    return (Object.keys(nextState) as (keyof GameStoreState)[])
      .every((key) => Object.is(state[key], nextState[key])) ? state : nextState;
  }),
  reset: () => set((state) => (Object.keys(initialState) as (keyof GameStoreState)[])
    .every((key) => equalSnapshotValue(state[key], initialState[key])) ? state : initialState),
}));
