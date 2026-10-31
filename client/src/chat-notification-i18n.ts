const english = {
  'chat.notifications': 'Mention alerts',
  'chat.notifications.sound': 'Visual alerts and sound',
  'chat.notifications.visual': 'Visual alerts only',
  'chat.notifications.off': 'Off',
  'chat.notifications.note': 'Alerts play only when you are not reading the latest chat messages. Sound follows the effects and master volume.',
  'chat.notifications.unread': '{n} unread mentions',
  'chat.notifications.notice': '{nickname} mentioned you',
  'chat.notifications.view': 'View message',
  'chat.notifications.dismiss': 'Dismiss mention alert',
} as const;

export type ChatNotificationTranslationKey = keyof typeof english;

export const chatNotificationTranslations: Record<'en' | 'zh-TW', Record<ChatNotificationTranslationKey, string>> = {
  en: english,
  'zh-TW': {
    'chat.notifications': '提及提醒',
    'chat.notifications.sound': '提示與音效',
    'chat.notifications.visual': '僅視覺提示',
    'chat.notifications.off': '關閉提醒',
    'chat.notifications.note': '未在閱讀最新聊天訊息時才會提醒。提示音沿用音效與主音量設定。',
    'chat.notifications.unread': '{n} 則未讀提及',
    'chat.notifications.notice': '{nickname} 提及了你',
    'chat.notifications.view': '查看訊息',
    'chat.notifications.dismiss': '關閉提及提示',
  },
};
