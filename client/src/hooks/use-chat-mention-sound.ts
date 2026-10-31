import { useEffect } from 'react';
import { startChatMentionSound } from '../audio/chat-mention-sound';
import { createTurnSound } from '../audio/turn-sound';

/** Mount once: consume live cues immediately, including ones dropped while audio is locked. */
export function useChatMentionSound(): void {
  useEffect(() => {
    const audio = createTurnSound([[0, 880], [0.09, 1175]]);
    return startChatMentionSound(audio, window);
  }, []);
}
