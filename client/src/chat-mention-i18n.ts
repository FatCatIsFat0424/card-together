const english = {
  'chatMention.suggestions': 'Mention a room member',
  'chatMention.hint': '↑ ↓ to browse · Enter or Tab to choose · Esc to close',
  'chatMention.seat': 'Seat {seat}',
  'chatMention.spectator': 'Spectator',
  'chatMention.unread': '@ {n} unread mentions',
  'chatMention.openPlayer': 'View {name}’s player card',
  'chatMention.profile': 'View {name}’s profile',
  'chatMention.error.invalid': 'Invalid chat mentions. Please select players again.',
  'chatMention.error.members': 'Mentioned players must be human members of this room. Please select players again.',
  'chatMention.error.renamed': 'A mentioned player changed their nickname. Please select them again.',
  'chatMention.error.observers': 'Observers can only mention other observers during a match.',
  'chatMention.error.reselect': 'A mentioned player is no longer available to mention. Please select players again.',
} as const;

export type ChatMentionTranslationKey = keyof typeof english;

export const chatMentionTranslations: Record<'en' | 'zh-TW', Record<ChatMentionTranslationKey, string>> = {
  en: english,
  'zh-TW': {
    'chatMention.suggestions': '提及房間成員',
    'chatMention.hint': '↑ ↓ 瀏覽 · Enter 或 Tab 選取 · Esc 關閉',
    'chatMention.seat': '座位 {seat}',
    'chatMention.spectator': '旁觀者',
    'chatMention.unread': '@ {n} 則未讀提及',
    'chatMention.openPlayer': '查看 {name} 的玩家名片',
    'chatMention.profile': '查看 {name} 的個人檔案',
    'chatMention.error.invalid': '提及資料無效，請重新選取玩家。',
    'chatMention.error.members': '只能提及目前房間內的真人玩家，請重新選取。',
    'chatMention.error.renamed': '提及的玩家已變更暱稱，請重新選取。',
    'chatMention.error.observers': '對局進行中，旁觀者只能提及其他旁觀者。',
    'chatMention.error.reselect': '已選取的玩家目前無法被提及，請重新選取。',
  },
};

const errorKeys = new Map<string, ChatMentionTranslationKey>([
  [english['chatMention.error.invalid'], 'chatMention.error.invalid'],
  [english['chatMention.error.members'], 'chatMention.error.members'],
  [english['chatMention.error.renamed'], 'chatMention.error.renamed'],
  [english['chatMention.error.observers'], 'chatMention.error.observers'],
]);

export function chatMentionErrorKey(message: string | undefined): ChatMentionTranslationKey | null {
  return message ? errorKeys.get(message) ?? null : null;
}
