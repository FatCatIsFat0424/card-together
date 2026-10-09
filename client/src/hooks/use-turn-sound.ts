import { useEffect } from 'react';
import { AUDIO_UNLOCK_EVENTS } from '../audio/audio-unlock';
import { createTurnSound } from '../audio/turn-sound';
import { createTurnSoundController } from '../audio/turn-sound-controller';
import type { TurnSoundSnapshot } from '../audio/turn-sound-controller';
import { useAccountStore } from '../stores/account-store';
import { useGameStore } from '../stores/game-store';
import { useRoomStore } from '../stores/room-store';
import { useTurnSoundStore } from '../stores/turn-sound-store';
import { presentationMoment } from '../games/presentation-state';

export function getTurnSoundSnapshot(): TurnSoundSnapshot {
  const game = useGameStore.getState();
  const room = useRoomStore.getState();
  const account = useAccountStore.getState();
  const held = presentationMoment(game.visible, game.presentationReceivedAt, Date.now());
  // Chinese Poker has no single turn: every seat that still owes an arrangement is prompted.
  const arranging = game.chinesePoker?.phase === 'arranging' && !game.chinesePoker.submitted[game.chinesePoker.mySeat];
  const owned = !held.locked && room.currentRoomCode && room.mySeat &&
    account.status === 'authenticated' && account.connection === 'ready' &&
    (game.phase === 'bidding' || game.phase === 'playing') &&
    (game.currentTurnSeat === room.mySeat || arranging);
  const completedTricks = game.playing?.completedTricks.length ?? 0;
  const actionCount = game.bigTwo?.log.filter((entry) =>
    'seat' in entry && entry.seat === room.mySeat).length ??
    game.ninetyNine?.log.filter((entry) => entry.seat === room.mySeat).length ??
    game.sevens?.log.filter((entry) => entry.seat === room.mySeat).length ?? 0;
  return {
    room: room.currentRoomCode,
    turn: owned ? [game.gameType, game.phase, room.mySeat, completedTricks,
      game.redPoints?.step ?? '', actionCount].join(':') : null,
    completedTricks,
    enabled: useTurnSoundStore.getState().enabled,
  };
}

/** Mount once in the persistent application shell. */
export function useTurnSound(): void {
  useEffect(() => {
    const audio = createTurnSound();
    const controller = createTurnSoundController(audio);
    let disposed = false;
    let queued = false;
    let presentationTimer: ReturnType<typeof setTimeout> | null = null;
    const update = (): void => {
      if (queued) return;
      queued = true;
      // Socket events can update several stores synchronously for one transition.
      queueMicrotask(() => {
        queued = false;
        if (disposed) return;
        if (presentationTimer !== null) clearTimeout(presentationTimer);
        controller.update(getTurnSoundSnapshot());
        const game = useGameStore.getState();
        const moment = presentationMoment(game.visible, game.presentationReceivedAt, Date.now());
        presentationTimer = moment.locked ? setTimeout(update,
          Math.max(1, moment.endsAt - Date.now())) : null;
      });
    };
    const unlock = (event: Event): void => {
      if (event.isTrusted) audio.unlock();
    };
    for (const event of AUDIO_UNLOCK_EVENTS) window.addEventListener(event, unlock);
    const unsubscribe = [useGameStore.subscribe(update), useRoomStore.subscribe(update),
      useAccountStore.subscribe(update), useTurnSoundStore.subscribe(update)];
    update();
    return () => {
      disposed = true;
      if (presentationTimer !== null) clearTimeout(presentationTimer);
      unsubscribe.forEach((remove) => remove());
      for (const event of AUDIO_UNLOCK_EVENTS) window.removeEventListener(event, unlock);
      controller.dispose();
    };
  }, []);
}
