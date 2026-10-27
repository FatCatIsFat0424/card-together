const english = {
  'audio.title': 'Audio settings',
  'audio.master': 'Master volume',
  'audio.music': 'Background music',
  'audio.effects': 'Sound effects',
  'audio.turnReminder': 'Your-turn sound',
  'audio.voice': 'Voice chat',
  'audio.effectsNote': 'Sound effects cover game sounds, turn reminders, and interface sounds. The turn sound also plays when someone joins your room.',
  'audio.voiceNote': 'Each player\'s own volume is set in the voice panel and applies on top of this.',
  'audio.deviceNotice': 'These settings are saved on this device only.',
  'audio.close': 'Close',
} as const;

export type AudioTranslationKey = keyof typeof english;

export const audioTranslations: Record<'en' | 'zh-TW', Record<AudioTranslationKey, string>> = {
  en: english,
  'zh-TW': {
    'audio.title': '音訊設定',
    'audio.master': '主音量',
    'audio.music': '背景音樂',
    'audio.effects': '音效',
    'audio.turnReminder': '回合提醒音',
    'audio.voice': '語音聊天',
    'audio.effectsNote': '音效包含遊戲音效、回合提醒和介面音效。有人加入房間時，也會播放回合提醒音。',
    'audio.voiceNote': '每位玩家各自的音量在語音面板調整，會再乘上這裡的音量。',
    'audio.deviceNotice': '這些設定只儲存在這台裝置。',
    'audio.close': '關閉',
  },
};
