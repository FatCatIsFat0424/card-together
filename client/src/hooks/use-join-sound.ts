import { useEffect } from 'react';
import type { ChatMessageEvent } from '@shared/types';
import { AUDIO_UNLOCK_EVENTS } from '../audio/audio-unlock';
import { isJoinCue } from '../audio/join-cue';
import { createTurnSound } from '../audio/turn-sound';
import { socket } from '../socket';
import { useAccountStore } from '../stores/account-store';
import { useRoomStore } from '../stores/room-store';
import { useTurnSoundStore } from '../stores/turn-sound-store';

/** Mount once in the persistent application shell. */
export function useJoinSound(): void {
  useEffect(() => {
    const audio = createTurnSound('join');
    const handle = (event: ChatMessageEvent): void => {
      const roomCode = useRoomStore.getState().currentRoomCode;
      if (!isJoinCue(event, roomCode, useAccountStore.getState().account?.id ?? null)) return;
      // Locked audio drops the cue rather than replaying it after the next gesture.
      if (useTurnSoundStore.getState().enabled && audio.ready()) audio.play();
    };
    const unlock = (event: Event): void => {
      if (event.isTrusted) audio.unlock();
    };
    for (const event of AUDIO_UNLOCK_EVENTS) window.addEventListener(event, unlock);
    socket.on('chat:message', handle);
    return () => {
      socket.off('chat:message', handle);
      for (const event of AUDIO_UNLOCK_EVENTS) window.removeEventListener(event, unlock);
      audio.dispose();
    };
  }, []);
}
