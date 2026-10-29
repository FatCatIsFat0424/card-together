import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/game-store';
import { projectedServerNow } from '../turn-clock';

/**
 * True once a shared deadline (Land Battle Chess deployment, Battleship placement) has passed on the server's
 * clock; `null` while no deadline applies.
 */
export function useDeadlinePassed(deadline: number | null): boolean {
  const clock = useGameStore((state) => state.visible?.clock);
  const receivedAt = useGameStore((state) => state.presentationReceivedAt);
  const [passed, setPassed] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) return;
    const now = Date.now();
    const remaining = deadline - (clock ? projectedServerNow(clock, receivedAt, now) : now);
    const timer = setTimeout(() => setPassed(deadline), Math.min(2_147_483_647, Math.max(0, remaining)));
    return () => clearTimeout(timer);
  }, [deadline, clock, receivedAt]);
  return deadline !== null && passed === deadline;
}
