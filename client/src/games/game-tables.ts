import { lazy } from 'react';
import type { GameType } from '@shared/types';

/** Keep each game's rules and controls behind its own import, shared by live play and replays. */
export const GAME_TABLES = {
  bridge: lazy(() => import('./bridge/BridgeTable').then((game) => ({ default: game.BridgeTable }))),
  bigtwo: lazy(() => import('./bigtwo/BigTwoTable').then((game) => ({ default: game.BigTwoTable }))),
  redpoints: lazy(() => import('./redpoints/RedPointsTable').then((game) => ({ default: game.RedPointsTable }))),
  ninetynine: lazy(() => import('./ninetynine/NinetyNineTable').then((game) => ({ default: game.NinetyNineTable }))),
  sevens: lazy(() => import('./sevens/SevensTable').then((game) => ({ default: game.SevensTable }))),
  chinesepoker: lazy(() => import('./chinesepoker/ChinesePokerTable').then((game) => ({ default: game.ChinesePokerTable }))),
  liarsdeck: lazy(() => import('./liarsdeck/LiarsDeckTable').then((game) => ({ default: game.LiarsDeckTable }))),
  blackjack: lazy(() => import('./blackjack/BlackjackTable').then((game) => ({ default: game.BlackjackTable }))),
  holdem: lazy(() => import('./holdem/HoldemTable').then((game) => ({ default: game.HoldemTable }))),
  napoleon: lazy(() => import('./napoleon/NapoleonTable').then((game) => ({ default: game.NapoleonTable }))),
} satisfies Record<GameType, unknown>;
