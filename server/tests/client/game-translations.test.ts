import { describe, expect, it } from 'vitest';
import { blackjackTranslations } from '../../../client/src/blackjack-i18n';
import { holdemTranslations } from '../../../client/src/holdem-i18n';
import { liarsDeckTranslations } from '../../../client/src/liarsdeck-i18n';
import { napoleonTranslations } from '../../../client/src/napoleon-i18n';
import { sevensTranslations } from '../../../client/src/sevens-i18n';

function placeholders(value: string): string[] {
  return [...new Set(Array.from(value.matchAll(/\{([^}]+)\}/g), (match) => match[1]))].sort();
}

const dictionaries: readonly [string, { en: Record<string, string>; 'zh-TW': Record<string, string> }][] = [
  ['blackjack', blackjackTranslations], ['holdem', holdemTranslations],
  ['liarsdeck', liarsDeckTranslations], ['napoleon', napoleonTranslations], ['sevens', sevensTranslations],
];

describe('game translation contracts', () => {
  it.each(dictionaries)('keeps %s keys, nonempty messages and parameters in both languages', (_game, dictionary) => {
    const keys = Object.keys(dictionary.en).sort();
    expect(keys.length).toBeGreaterThan(0);
    expect(Object.keys(dictionary['zh-TW']).sort()).toEqual(keys);
    for (const key of keys) {
      expect(dictionary.en[key].trim(), `en:${key}`).not.toBe('');
      expect(dictionary['zh-TW'][key].trim(), `zh-TW:${key}`).not.toBe('');
      expect(placeholders(dictionary['zh-TW'][key]), key).toEqual(placeholders(dictionary.en[key]));
    }
  });
});
