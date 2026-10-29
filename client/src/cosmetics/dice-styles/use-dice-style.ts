import type { DiceTheme } from '../../games/liarsdice/dice-theme';
import { useAccountStore } from '../../stores/account-store';
import { DICE_DESIGNS, resolveDiceStyle } from './dice-designs';

/** The signed-in player's private dice theme, or null for the built-in dice. */
export function useEquippedDiceTheme(): DiceTheme | null {
  const style = useAccountStore((state) => resolveDiceStyle(state.account?.diceStyle));
  return style ? DICE_DESIGNS[style] : null;
}
