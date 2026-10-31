import { AUDIO_UNLOCK_EVENTS } from './audio-unlock';
import type { TurnSound } from './turn-sound';
import { useChatMentionStore } from '../stores/chat-mention-store';

/** Dropped cues are consumed immediately; a later gesture or preference change never replays them. */
export function startChatMentionSound(
  audio: TurnSound, gestures: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
): () => void {
  const unlock = (event: Event): void => { if (event.isTrusted) audio.unlock(); };
  for (const event of AUDIO_UNLOCK_EVENTS) gestures.addEventListener(event, unlock);
  const unsubscribe = useChatMentionStore.subscribe((state, previous) => {
    if (state.mode !== 'sound' || (state.soundCueId === null && previous.soundCueId !== null)) audio.stop();
    if (state.soundCueId && state.soundCueId !== previous.soundCueId && audio.ready()) audio.play();
  });
  return () => {
    unsubscribe();
    for (const event of AUDIO_UNLOCK_EVENTS) gestures.removeEventListener(event, unlock);
    audio.dispose();
  };
}
