const english = {
  'roomCard.move': 'Move room card',
  'roomCard.moveHint': 'Drag or use arrow keys to move; hold Shift for larger steps',
  'roomCard.resetPosition': 'Reset room card position',
} as const;

export type FloatingRoomCardTranslationKey = keyof typeof english;

export const floatingRoomCardTranslations: Record<'en' | 'zh-TW', Record<FloatingRoomCardTranslationKey, string>> = {
  en: english,
  'zh-TW': {
    'roomCard.move': '移動房間卡片',
    'roomCard.moveHint': '拖曳或使用方向鍵移動；按住 Shift 可加大移動距離',
    'roomCard.resetPosition': '重設房間卡片位置',
  },
};
