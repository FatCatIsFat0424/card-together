import type { GameType, PlayerVisibleGameState, RoomInfo } from '@shared/types';

interface GameRulesOption {
  readonly label: 'sevens.closeOnEnd' | 'ninetynine.twoDecks' | 'blackjack.playerDealer';
  readonly enabled: boolean;
}

export interface GameRulesContext {
  readonly gameType: GameType;
  readonly option: GameRulesOption | null;
  readonly active: boolean;
}

export function roomRulesContext(room: RoomInfo): GameRulesContext {
  const option: GameRulesOption | null = room.gameType === 'sevens'
    ? { label: 'sevens.closeOnEnd', enabled: room.sevensOptions?.closeOnEnd ?? false }
    : room.gameType === 'ninetynine'
      ? { label: 'ninetynine.twoDecks', enabled: room.ninetyNineOptions?.twoDecks ?? false }
      : room.gameType === 'blackjack'
        ? { label: 'blackjack.playerDealer', enabled: room.blackjackOptions?.playerDealer ?? false }
        : null;
  return { gameType: room.gameType, option, active: false };
}

export function matchRulesContext(game: PlayerVisibleGameState): GameRulesContext {
  const option: GameRulesOption | null = game.gameType === 'sevens'
    ? { label: 'sevens.closeOnEnd', enabled: game.options?.closeOnEnd ?? false }
    : game.gameType === 'ninetynine'
      ? { label: 'ninetynine.twoDecks', enabled: game.options?.twoDecks ?? false }
      : game.gameType === 'blackjack'
        ? { label: 'blackjack.playerDealer', enabled: game.options?.playerDealer ?? false }
        : null;
  return { gameType: game.gameType, option, active: game.phase !== 'scoring' };
}
