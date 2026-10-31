const english = {
  'reply.action': 'Reply to message',
  'reply.to': 'Replying to {name}',
  'reply.cancel': 'Cancel reply',
  'reply.notify': 'Notify the author',
  'reply.jump': 'View original message from {name}',
  'reply.sticker': '[Sticker]',
  'reply.unavailable': 'Original message is no longer available',
  'reply.loading': 'Loading original message…',
  'reply.notice': '{nickname} replied to you',
  'reply.error.invalid': 'Invalid message reply.',
  'reply.error.room': 'Reply message is not available in this room.',
  'reply.error.observers': 'Observers can only notify other observers during a match.',
  'reply.error.conversation': 'Reply message is not available in this conversation.',
} as const;

export type MessageReplyTranslationKey = keyof typeof english;

export const messageReplyTranslations: Record<'en' | 'zh-TW', Record<MessageReplyTranslationKey, string>> = {
  en: english,
  'zh-TW': {
    'reply.action': '回覆訊息',
    'reply.to': '回覆 {name}',
    'reply.cancel': '取消回覆',
    'reply.notify': '通知原作者',
    'reply.jump': '查看 {name} 的原訊息',
    'reply.sticker': '[貼圖]',
    'reply.unavailable': '原訊息已無法查看',
    'reply.loading': '正在載入原訊息…',
    'reply.notice': '{nickname} 回覆了你',
    'reply.error.invalid': '回覆資料無效，請重新選取原訊息。',
    'reply.error.room': '這則原訊息目前無法在房間內查看，請取消或重新選取回覆。',
    'reply.error.observers': '對局進行中，旁觀者只能通知其他旁觀者。',
    'reply.error.conversation': '這則原訊息目前無法在對話中查看，請取消或重新選取回覆。',
  },
};

const errorKeys = new Map<string, MessageReplyTranslationKey>([
  [english['reply.error.invalid'], 'reply.error.invalid'],
  [english['reply.error.room'], 'reply.error.room'],
  [english['reply.error.observers'], 'reply.error.observers'],
  [english['reply.error.conversation'], 'reply.error.conversation'],
]);

export function messageReplyErrorKey(message: string | undefined): MessageReplyTranslationKey | null {
  return message ? errorKeys.get(message) ?? null : null;
}
