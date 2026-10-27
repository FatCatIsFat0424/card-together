import type { DirectMessage } from '@shared/types/direct-message';

/** A pause longer than this starts a new group even when the same person keeps writing. */
export const GROUP_GAP_MS = 5 * 60_000;

export interface MessageGroup {
  readonly key: string;
  readonly own: boolean;
  readonly messages: readonly DirectMessage[];
}

/** Consecutive messages from one sender, so the name and time are shown once per run. */
export function groupDirectMessages(messages: readonly DirectMessage[], ownId: string,
  gapMs: number = GROUP_GAP_MS): MessageGroup[] {
  const groups: { key: string; own: boolean; messages: DirectMessage[] }[] = [];
  for (const message of messages) {
    const last = groups.at(-1);
    const previous = last?.messages.at(-1);
    if (last && previous && previous.sender.id === message.sender.id
      && message.timestamp - previous.timestamp <= gapMs) last.messages.push(message);
    else groups.push({ key: message.id, own: message.sender.id === ownId, messages: [message] });
  }
  return groups;
}

/** Today's groups show only the time; earlier ones add the month and day. */
export function groupTimeLabel(timestamp: number, locale: string, now: number = Date.now()): string {
  const sameDay = new Date(timestamp).toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(locale, sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp);
}
