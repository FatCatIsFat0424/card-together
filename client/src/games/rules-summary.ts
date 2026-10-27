import type { GameType } from '@shared/types';
import type { GameRulesContext } from '../game-rules-context';
import type { Translate } from './client-game';
import { clientGame } from './registry';

/**
 * Short rule reminders shown at the top of the rules dialog. Option-specific lines follow
 * the room or match context; without one (the lobby) the default options apply.
 */
export function gameRulesSummary(gameType: GameType, context: GameRulesContext | undefined, t: Translate): string[] {
  return clientGame(gameType).rules.summary(context, t);
}
