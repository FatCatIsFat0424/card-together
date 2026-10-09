// ─── i18n Store: locale state ───

import { create } from 'zustand';
import type { Locale, TranslationKey } from '../i18n';
import { t as translate } from '../i18n';

interface I18nStoreState {
  locale: Locale;
}

interface I18nStoreActions {
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string>) => string;
}

export const useI18nStore = create<I18nStoreState & I18nStoreActions>((set, get) => ({
  locale: 'zh-TW',
  setLocale: (locale) => set({ locale }),
  t: (key, params) => translate(key, get().locale, params),
}));
