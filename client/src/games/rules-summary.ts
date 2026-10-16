import { BJ_HANDS } from '@shared/rules/blackjack';
import type { GameType } from '@shared/types';
import type { GameRulesContext } from '../game-rules-context';
import type { TranslationKey } from '../i18n';

type Translate = (key: TranslationKey, params?: Record<string, string>) => string;

/**
 * Short rule reminders shown at the top of the rules dialog. Option-specific lines follow
 * the room or match context; without one (the lobby) the default options apply.
 */
export function gameRulesSummary(gameType: GameType, context: GameRulesContext | undefined, t: Translate): string[] {
  const optionEnabled = context?.option?.enabled ?? false;
  switch (gameType) {
    case 'bigtwo':
      return [t('bigtwo.rulesCombos'), t('bigtwo.rulesOrder'), t('bigtwo.rulesScore')];
    case 'redpoints':
      return [t('redpoints.rulesPair'), t('redpoints.rulesTurn'), t('redpoints.rulesScore')];
    case 'ninetynine':
      return [t('ninetynine.rulesNumbers'), t('ninetynine.rulesSpecial'), t('ninetynine.rulesBust'),
        ...(optionEnabled ? [t('ninetynine.rulesTwoDecks')] : [])];
    case 'sevens':
      return [t('sevens.rulesOpen'), t('sevens.rulesExtend'), t('sevens.rulesCover'), t('sevens.rulesScore'),
        ...(optionEnabled ? [t('sevens.rulesCloseOnEnd')] : [])];
    case 'liarsdeck':
      return [t('liarsdeck.rulesDeck'), t('liarsdeck.rulesPlay'), t('liarsdeck.rulesCall'), t('liarsdeck.rulesGun')];
    case 'blackjack': {
      const hands = String(context?.blackjackHands ?? BJ_HANDS);
      return [t('blackjack.rulesBet', { hands }), t('blackjack.rulesPlay'),
        t(optionEnabled ? 'blackjack.rulesPlayerDealer' : 'blackjack.rulesDealer'), t('blackjack.rulesPay', { hands })];
    }
    case 'holdem':
      return [t('holdem.rulesChips'), t('holdem.rulesDeal'), t('holdem.rulesAction'), t('holdem.rulesShowdown')];
    case 'napoleon':
      // Joker summoning is on by default, so the lobby lists it too.
      return [t('napoleon.rulesDeal'), t('napoleon.rulesBid'), t('napoleon.rulesSecretary'), t('napoleon.rulesPlay'),
        ...(context?.option?.enabled ?? true ? [t('napoleon.rulesSummon')] : []), t('napoleon.rulesWin')];
    case 'chinesepoker':
      return [t('chinesepoker.rulesRows'), t('chinesepoker.rulesFoul'), t('chinesepoker.rulesValues'),
        t('chinesepoker.rulesSweep')];
    case 'bridge':
      return [];
  }
}
