import type { DirectMessage } from '@shared/types/direct-message';

/** A pause longer than this starts a new group even when the same person keeps writing. */
export const GROUP_GAP_MS = 5 * 60_000;

export interface MessageGroup {
  readonly key: string;
  readonly own: boolean;
  readonly messages: readonly DirectMessage[];
}

function sameDay(first: number, second: number): boolean {
  return new Date(first).toDateString() === new Date(second).toDateString();
}

/** Consecutive messages from one sender on one day, so the name and time are shown once per run. */
export function groupDirectMessages(messages: readonly DirectMessage[], ownId: string,
  gapMs: number = GROUP_GAP_MS): MessageGroup[] {
  const groups: { key: string; own: boolean; messages: DirectMessage[] }[] = [];
  for (const message of messages) {
    const last = groups.at(-1);
    const previous = last?.messages.at(-1);
    if (last && previous && previous.sender.id === message.sender.id
      && message.timestamp - previous.timestamp <= gapMs && sameDay(previous.timestamp, message.timestamp)) {
      last.messages.push(message);
    } else groups.push({ key: message.id, own: message.sender.id === ownId, messages: [message] });
  }
  return groups;
}

/** Groups show only the time; the day separator above them names the day. */
export function groupTimeLabel(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(timestamp);
}

export type MessageDay = { readonly kind: 'today' | 'yesterday' } | { readonly kind: 'date'; readonly label: string };

/** The separator before a day's first group: today, yesterday, or the date (with the year when it differs). */
export function messageDay(timestamp: number, locale: string, now: number = Date.now()): MessageDay {
  if (sameDay(timestamp, now)) return { kind: 'today' };
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(timestamp, yesterday.getTime())) return { kind: 'yesterday' };
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return { kind: 'date', label: new Intl.DateTimeFormat(locale, sameYear ? { month: 'long', day: 'numeric' }
    : { year: 'numeric', month: 'long', day: 'numeric' }).format(timestamp) };
}

/** Whether a group starts a new calendar day after the previous group. */
export function startsNewDay(group: MessageGroup, previous: MessageGroup | undefined): boolean {
  return !previous || !sameDay(previous.messages[0].timestamp, group.messages[0].timestamp);
}
