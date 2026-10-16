import type { ChipStyleId } from '@shared/types';
import { useAccountStore } from '../../stores/account-store';
import { resolveChipStyle } from './chip-designs';

/** Chips follow the signed-in player's private style; null keeps the default chip. */
export function useChipStyle(): ChipStyleId | null {
  return useAccountStore((state) => resolveChipStyle(state.account?.chipStyle));
}
