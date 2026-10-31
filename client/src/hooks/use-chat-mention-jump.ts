import { useEffect } from 'react';
import { useChatMentionStore } from '../stores/chat-mention-store';

/** Open the page's chat for live requests and requests carried across a route change. */
export function useChatMentionJump(openChat: () => void): void {
  useEffect(() => {
    const showPending = (): void => {
      if (useChatMentionStore.getState().targetMessageId) openChat();
    };
    const unsubscribe = useChatMentionStore.subscribe((state, previous) => {
      if (state.targetMessageId && state.targetMessageId !== previous.targetMessageId) openChat();
    });
    const frame = requestAnimationFrame(showPending);
    return () => { unsubscribe(); cancelAnimationFrame(frame); };
  }, [openChat]);
}
