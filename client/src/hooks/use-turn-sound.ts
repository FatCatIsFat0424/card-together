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
import { blackjackNeedsBet } from '../games/blackjack/blackjack-view';
import { napoleonReviewState } from '../games/napoleon/napoleon-view';
import { tenHalfNeedsBet } from '../games/tenhalf/tenhalf-view';

export function getTurnSoundSnapshot(): TurnSoundSnapshot {
  const game = useGameStore.getState();
  const room = useRoomStore.getState();
  const account = useAccountStore.getState();
  const held = presentationMoment(game.visible, game.presentationReceivedAt, Date.now());
  // Chinese Poker has no single turn: every seat that still owes an arrangement is prompted.
  const arranging = game.chinesePoker?.phase === 'arranging' && !game.chinesePoker.submitted[game.chinesePoker.mySeat];
  // Blackjack betting is simultaneous too: every seat that can still bet is prompted.
  const betting = game.blackjack ? blackjackNeedsBet(game.blackjack) : game.tenhalf ? tenHalfNeedsBet(game.tenhalf) : false;
  // The four-player Napoleon discard review is also owed by every seat at once.
  const reviewing = game.napoleon ? napoleonReviewState(game.napoleon) === 'review' : false;
  const owned = !held.locked && room.currentRoomCode && room.mySeat &&
    account.status === 'authenticated' && account.connection === 'ready' &&
    (game.phase === 'bidding' || game.phase === 'playing') &&
    (game.currentTurnSeat === room.mySeat || arranging || betting || reviewing);
  const completedTricks = game.playing?.completedTricks.length ?? game.napoleon?.tricks.length ?? 0;
  const actionCount = game.bigTwo?.log.filter((entry) =>
    'seat' in entry && entry.seat === room.mySeat).length ??
    game.ninetyNine?.log.filter((entry) => entry.seat === room.mySeat).length ??
    game.crazyEights?.log.filter((entry) => 'seat' in entry && entry.seat === room.mySeat).length ??
    game.sevens?.log.filter((entry) => entry.seat === room.mySeat).length ??
    game.liarsDeck?.log.filter((entry) => 'seat' in entry && entry.seat === room.mySeat).length ??
    game.liarsDice?.log.filter((entry) => 'seat' in entry && entry.seat === room.mySeat).length ??
    game.holdem?.log.filter((entry) => entry.type === 'action' && entry.seat === room.mySeat).length ??
    (game.napoleon ? `${game.napoleon.phase}-${game.napoleon.log.filter((entry) =>
      'seat' in entry && entry.seat === room.mySeat).length}` : undefined) ??
    // One Blackjack turn spans several actions; prompt once per hand played, not on every hit.
    (game.blackjack ? `${game.blackjack.phase}-${game.blackjack.hand}-${game.blackjack.activeHand}`
      : game.tenhalf ? `${game.tenhalf.phase}-${game.tenhalf.hand}` : 0);
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
