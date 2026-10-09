import { describe, expect, it } from 'vitest';
import {
  extractEmojiNames, isEmojiName, isProvidedEmojiFile, parseProvidedEmojiCatalog, splitEmojiText,
} from '@shared/constants';
import { emojiNameFromFile } from '../../../client/src/emoji-names';
import { resolveMessageEmojis } from '../../src/managers/chat-manager';

const MEDIA = `${'a'.repeat(64)}.png`;
const OTHER = `${'b'.repeat(64)}.gif`;
const WAVE_FILE = 'wave-0123456789abcdef01234567.png';
const PARTY_FILE = 'party-89abcdef0123456789abcdef.gif';

describe('custom emoji helpers', () => {
  it('should extract unique valid :name: tokens in order', () => {
    expect(extractEmojiNames(':wave: hi :ok_2: :wave: :x: :Bad: :ok_2::cat:'))
      .toEqual(['wave', 'ok_2', 'Bad', 'cat']);
    expect(extractEmojiNames('no emoji here: just colons')).toEqual([]);
    expect(extractEmojiNames(`:${'a'.repeat(64)}: :${'b'.repeat(65)}:`)).toEqual(['a'.repeat(64)]);
    expect(extractEmojiNames(':NEKO3::image0-1-3: :dont_bark-ezgif.com-optimize: :-no: :.no: :a b: :a:b:'))
      .toEqual(['NEKO3', 'image0-1-3', 'dont_bark-ezgif.com-optimize']);
  });

  it('should accept the relaxed name rules and every name valid under the old rules', () => {
    for (const name of ['ok', 'wave_2', '_x', 'a'.repeat(32), 'NEKO3', 'FB_IMG_1737436595895',
      'image0-1-3', 'dont_bark-ezgif.com-optimize', 'x.', 'a'.repeat(64), '0-', '__']) {
      expect(isEmojiName(name)).toBe(true);
    }
    for (const name of ['x', 'a'.repeat(65), '-x', '.x', 'a b', 'a:b', 'a/b', 'é', '貓貓', 'a\nb', '', 42]) {
      expect(isEmojiName(name)).toBe(false);
    }
  });

  it('should split text around attached emoji only', () => {
    expect(splitEmojiText('hi :wave: and :nope:!', { wave: MEDIA })).toEqual([
      'hi ', { name: 'wave', mediaId: MEDIA }, ' and :nope:!',
    ]);
    expect(splitEmojiText(':wave::wave:', { wave: MEDIA })).toEqual([
      { name: 'wave', mediaId: MEDIA }, { name: 'wave', mediaId: MEDIA },
    ]);
    expect(splitEmojiText('<b>:toString:</b>')).toEqual(['<b>:toString:</b>']);
    expect(splitEmojiText(':constructor:', {})).toEqual([':constructor:']);
  });

  it('should split provided emoji tokens after personal ones', () => {
    expect(splitEmojiText(':wave: :party: :nope:', { wave: MEDIA }, { wave: WAVE_FILE, party: PARTY_FILE }))
      .toEqual([
        { name: 'wave', mediaId: MEDIA }, ' ', { name: 'party', file: PARTY_FILE }, ' :nope:',
      ]);
    expect(splitEmojiText(':constructor:', {}, {})).toEqual([':constructor:']);
    expect(splitEmojiText('a :Cat.v2::cat.v2:b', { 'cat.v2': MEDIA }, { 'Cat.v2': 'Cat.v2-0123456789abcdef01234567.png' }))
      .toEqual([
        'a ', { name: 'Cat.v2', file: 'Cat.v2-0123456789abcdef01234567.png' },
        { name: 'cat.v2', mediaId: MEDIA }, 'b',
      ]);
  });

  it('should resolve only names in the sender library, capped at 20', () => {
    const library = [{ name: 'wave', mediaId: MEDIA }, { name: 'cat', mediaId: OTHER }];
    expect(resolveMessageEmojis(':cat: :dog: :wave: :cat:', library))
      .toEqual({ emojis: { cat: OTHER, wave: MEDIA }, providedEmojis: {} });
    expect(resolveMessageEmojis('plain', library)).toEqual({ emojis: {}, providedEmojis: {} });
    const many = Array.from({ length: 25 }, (_, index) => ({ name: `e${index}`, mediaId: MEDIA }));
    const message = many.map((emoji) => `:${emoji.name}:`).join(' ');
    expect(Object.keys(resolveMessageEmojis(message, many).emojis))
      .toEqual(many.slice(0, 20).map((emoji) => emoji.name));
  });

  it('should prefer the sender library over provided emoji and share the cap', () => {
    const library = [{ name: 'wave', mediaId: MEDIA }];
    const provided = new Map([
      ['wave', { name: 'wave', file: WAVE_FILE }], ['party', { name: 'party', file: PARTY_FILE }],
    ]);
    expect(resolveMessageEmojis(':party: :wave: :dog:', library, provided))
      .toEqual({ emojis: { wave: MEDIA }, providedEmojis: { party: PARTY_FILE } });
    expect(resolveMessageEmojis(':wave:', [], provided))
      .toEqual({ emojis: {}, providedEmojis: { wave: WAVE_FILE } });

    const personal = Array.from({ length: 15 }, (_, index) => ({ name: `p${index}`, mediaId: MEDIA }));
    const site = new Map(Array.from({ length: 15 }, (_, index) => {
      const name = `s${index}`;
      return [name, { name, file: `${name}-${'c'.repeat(24)}.png` }] as const;
    }));
    const names = [...personal.map((emoji) => emoji.name), ...site.keys()]
      .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)) || left.localeCompare(right));
    const resolved = resolveMessageEmojis(names.map((name) => `:${name}:`).join(''), personal, site);
    expect(Object.keys(resolved.emojis).length + Object.keys(resolved.providedEmojis).length).toBe(20);
    expect([...Object.keys(resolved.emojis), ...Object.keys(resolved.providedEmojis)].sort())
      .toEqual(names.slice(0, 20).sort());
  });

  it('should validate provided emoji catalogs and file names', () => {
    expect(parseProvidedEmojiCatalog([])).toEqual([]);
    expect(parseProvidedEmojiCatalog([{ name: 'wave', file: WAVE_FILE }]))
      .toEqual([{ name: 'wave', file: WAVE_FILE }]);
    for (const catalog of [
      {}, [null], [{ name: 'wave' }], [{ name: 'Wave', file: WAVE_FILE }],
      [{ name: 'party', file: WAVE_FILE }],
      [{ name: 'wave', file: WAVE_FILE }, { name: 'wave', file: WAVE_FILE }],
      [{ name: 'wave', file: WAVE_FILE, url: 'https://example.com/a.png' }],
      [{ name: 'wave', file: '../wave-0123456789abcdef01234567.png' }],
    ]) {
      expect(() => parseProvidedEmojiCatalog(catalog)).toThrow();
    }
    for (const file of [
      'https://example.com/wave.png', '/wave.png', 'wave.png', `wave-${'a'.repeat(24)}.svg`,
      `wave-${'a'.repeat(24)}.png?x`, `wave-${'A'.repeat(24)}.png`,
    ]) {
      expect(isProvidedEmojiFile(file)).toBe(false);
    }
    expect(isProvidedEmojiFile(PARTY_FILE)).toBe(true);
  });

  it('should parse provided file names whose emoji names contain hyphens, dots and digests', () => {
    const tricky = `a-${'0'.repeat(24)}.png`;
    const catalog = [
      { name: 'image0-1-3', file: `image0-1-3-${'a'.repeat(24)}.gif` },
      { name: 'ezgif.com-optimize', file: `ezgif.com-optimize-${'b'.repeat(24)}.webp` },
      { name: tricky, file: `${tricky}-${'c'.repeat(24)}.jpg` },
      { name: 'NEKO3', file: `NEKO3-${'d'.repeat(24)}.png` },
    ];
    expect(parseProvidedEmojiCatalog(catalog)).toEqual(catalog);
    expect(() => parseProvidedEmojiCatalog([{ name: 'image0-1', file: `image0-1-3-${'a'.repeat(24)}.gif` }]))
      .toThrow();
    expect(() => parseProvidedEmojiCatalog([{ name: 'a', file: `a-${'0'.repeat(24)}.png` }])).toThrow();
    for (const file of [`.hidden-${'a'.repeat(24)}.png`, `-x-${'a'.repeat(24)}.png`,
      `a/b-${'a'.repeat(24)}.png`, `${'a'.repeat(65)}-${'a'.repeat(24)}.png`]) {
      expect(isProvidedEmojiFile(file)).toBe(false);
    }
  });

  it('should derive unique valid names from file names', () => {
    const taken = new Set(['party']);
    expect(emojiNameFromFile('Party.GIF', taken)).toBe('Party');
    expect(emojiNameFromFile('party.png', taken)).toBe('party_2');
    expect(emojiNameFromFile('folder/Hello World!.webp', taken)).toBe('Hello_World');
    expect(emojiNameFromFile('dont_bark-ezgif.com-optimize.gif', taken)).toBe('dont_bark-ezgif.com-optimize');
    expect(emojiNameFromFile('phoebe1 .png', taken)).toBe('phoebe1');
    expect(emojiNameFromFile('-5641e774.gif', taken)).toBe('5641e774');
    expect(emojiNameFromFile('a.png', taken)).toBe('emoji');
    expect(emojiNameFromFile('貓.png', taken)).toBe('emoji_2');
    const long = `${'x'.repeat(70)}.png`;
    expect(emojiNameFromFile(long, taken)).toBe('x'.repeat(64));
    expect(emojiNameFromFile(long, taken)).toBe(`${'x'.repeat(62)}_2`);
    for (const name of taken) expect(isEmojiName(name)).toBe(true);
  });
});
