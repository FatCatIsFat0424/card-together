const english = {
  'roomCard.moveHint': 'Drag or use arrow keys to move; hold Shift for larger steps',
} as const;

export type FloatingRoomCardTranslationKey = keyof typeof english;

export const floatingRoomCardTranslations: Record<'en' | 'zh-TW', Record<FloatingRoomCardTranslationKey, string>> = {
  en: english,
  'zh-TW': {
    'roomCard.moveHint': '拖曳或使用方向鍵移動；按住 Shift 可加大移動距離',
  },
};
