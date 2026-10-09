import { selectConnectionReady, useAccountStore } from '../stores/account-store';

/** Game and room actions are disabled while the realtime connection is not ready. */
export function useConnectionReady(): boolean {
  return useAccountStore(selectConnectionReady);
}
