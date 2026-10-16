import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOUND_PACKS } from '../../../shared/src/constants/shop';
import { CLASSIC_SOUND_PACK, JOIN_NOTES, TURN_NOTES } from '../../../client/src/audio/classic-sound-pack';
import { SOUND_CUES, cueDuration, noiseEnvelope } from '../../../client/src/audio/sound-pack';
import type { Cue, SoundPack, ToneVoice } from '../../../client/src/audio/sound-pack';
import { createTurnSound } from '../../../client/src/audio/turn-sound';
import {
  disposeCardSounds, playCardSound, playSoundPackPreview, unlockCardSounds,
} from '../../../client/src/audio/card-sound';
import { getActiveSoundPack } from '../../../client/src/cosmetics/sound-packs/active-sound-pack';
import { SOUND_PACK_DEFINITIONS, resolveSoundPack } from '../../../client/src/cosmetics/sound-packs/sound-packs';
import { note } from '../../../client/src/cosmetics/sound-packs/voices';
import { soundPacksTranslations } from '../../../client/src/cosmetics/sound-packs/i18n';
import { SAMPLE_SLASH, allCues, worstOverlap } from './sound-pack-loudness';

vi.mock('../../../client/src/stores/account-store', async () => {
  const { create } = await import('zustand');
  return { useAccountStore: create(() => ({ account: null })) };
});

import { useAccountStore } from '../../../client/src/stores/account-store';

const PACKS: readonly SoundPack[] = Object.values(SOUND_PACK_DEFINITIONS);
const LONG_SLASH = { fireStart: 0.5, fireEnd: 2.4, strike: 2.4, cut: 0.2 };

function equip(soundPack: string | null): void {
  useAccountStore.setState({ account: soundPack === null ? null : { soundPack } } as never);
}

afterEach(() => {
  equip(null);
  disposeCardSounds();
  vi.unstubAllGlobals();
});

describe('sound pack catalog', () => {
  it('should define one pack for every shop sound pack and nothing else', () => {
    expect(Object.keys(SOUND_PACK_DEFINITIONS).sort()).toEqual(SOUND_PACKS.map((item) => item.id).sort());
    for (const [id, pack] of Object.entries(SOUND_PACK_DEFINITIONS)) expect(pack.id).toBe(id);
  });

  it('should name and describe every pack in both languages', () => {
    for (const { id } of SOUND_PACKS) {
      for (const text of [soundPacksTranslations.en, soundPacksTranslations['zh-TW']] as Record<string, string>[]) {
        expect(text[`shop.item.${id}.name`]?.length).toBeGreaterThan(2);
        expect(text[`shop.item.${id}.description`]?.length).toBeGreaterThan(12);
      }
      expect(soundPacksTranslations.en[`shop.item.${id}.name` as keyof typeof soundPacksTranslations.en])
        .not.toBe(soundPacksTranslations.en[`shop.item.${id}.description` as keyof typeof soundPacksTranslations.en]);
    }
  });
});

describe('sound pack parameters', () => {
  const limits: Readonly<Record<string, number>> = {
    turn: 1, join: 0.8, card: 0.2, pass: 0.2, out: 1.3, start: 1.2, collapse: 2.2,
  };

  function checkFilter(filter: { type: string; frequency: number; q: number }): void {
    expect(filter.frequency).toBeGreaterThanOrEqual(20);
    expect(filter.frequency).toBeLessThanOrEqual(12000);
    expect(filter.q).toBeGreaterThan(0);
    expect(filter.q).toBeLessThanOrEqual(filter.type === 'bandpass' ? 20 : 6);
  }

  it.each([CLASSIC_SOUND_PACK, ...PACKS].map((pack) => [pack.id, pack] as const))(
    '%s should define every cue with finite, in-range voices', (_id, pack) => {
      for (const name of SOUND_CUES) expect(pack[name].length, name).toBeGreaterThan(0);
      const cues: Record<string, Cue> = { ...allCues(pack), slashLong: pack.slash(LONG_SLASH) };
      for (const [name, cue] of Object.entries(cues)) {
        expect(cue.length, name).toBeGreaterThan(0);
        expect(cue.length, name).toBeLessThanOrEqual(48);
        for (const voice of cue) {
          expect(voice.at, name).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(voice.level), name).toBe(true);
          expect(voice.level, name).toBeGreaterThan(0);
          if (voice.kind === 'tone') {
            const floor = voice.floor ?? 0.0001;
            expect(voice.frequency, name).toBeGreaterThanOrEqual(20);
            expect(voice.frequency, name).toBeLessThanOrEqual(12000);
            expect(voice.level, name).toBeLessThanOrEqual(0.4);
            expect(voice.level, name).toBeGreaterThan(floor);
            expect(voice.attack, name).toBeGreaterThan(0);
            expect(voice.decay, name).toBeGreaterThan(voice.attack);
            expect(voice.decay, name).toBeLessThanOrEqual(2.5);
            if (voice.glide) {
              expect(voice.glide.time, name).toBeGreaterThan(0);
              expect(voice.glide.time, name).toBeLessThanOrEqual(2);
              expect(voice.frequency * voice.glide.ratio, name).toBeGreaterThanOrEqual(20);
              expect(voice.frequency * voice.glide.ratio, name).toBeLessThanOrEqual(12000);
            }
            if (voice.filter) checkFilter(voice.filter);
          } else {
            checkFilter(voice.filter);
            if (voice.sweepTo !== undefined) {
              expect(voice.sweepTo, name).toBeGreaterThanOrEqual(20);
              expect(voice.sweepTo, name).toBeLessThanOrEqual(12000);
            }
            expect(voice.level, name).toBeLessThanOrEqual(1.3);
            expect(voice.length, name).toBeGreaterThan(0);
            expect(voice.length, name).toBeLessThanOrEqual(2);
            const { crackle } = voice.envelope;
            if (crackle) {
              expect(crackle.chance).toBeGreaterThanOrEqual(0);
              expect(crackle.chance).toBeLessThanOrEqual(0.05);
            }
            const shape = noiseEnvelope({ ...voice.envelope, crackle: undefined });
            for (let i = 0; i <= 20; i++) {
              expect(shape(i / 20), name).toBeGreaterThanOrEqual(0);
              expect(shape(i / 20), name).toBeLessThanOrEqual(1);
            }
          }
        }
      }
      for (const [name, limit] of Object.entries(limits)) {
        expect(cueDuration(pack[name as keyof typeof limits as 'turn']), name).toBeLessThanOrEqual(limit);
      }
      // The strike lands at its time and the impact never trails the presentation by more than its own tail.
      expect(cueDuration(pack.slash(SAMPLE_SLASH))).toBeLessThanOrEqual(SAMPLE_SLASH.strike + SAMPLE_SLASH.cut + 1);
    });

  it.each(PACKS.map((pack) => [pack.id, pack] as const))('%s should stay peak-safe and audible', (_id, pack) => {
    const tonal = new Set(['turn', 'join', 'card', 'pass', 'out']);
    for (const [name, cue] of Object.entries(allCues(pack))) {
      expect(worstOverlap(cue), name).toBeLessThanOrEqual(0.95);
      expect(worstOverlap(cue), name).toBeGreaterThanOrEqual(0.1);
      expect(worstOverlap(cue, true), name).toBeLessThanOrEqual(tonal.has(name) ? 0.4 : 0.6);
    }
    // Turn and join cues stay near the classic reminder's loudness so equipping a pack never changes the mix.
    for (const name of ['turn', 'join'] as const) {
      const classic = worstOverlap(CLASSIC_SOUND_PACK[name]);
      expect(worstOverlap(pack[name])).toBeGreaterThanOrEqual(classic * 0.6);
      expect(worstOverlap(pack[name])).toBeLessThanOrEqual(classic * 2);
    }
  });
});

describe('sound pack identity', () => {
  /** Onsets of the notes a listener follows: the strongest tone of each onset, ignoring echoes and overtones. */
  function melody(cue: Cue): Array<{ at: number; frequency: number }> {
    const groups = new Map<number, ToneVoice>();
    for (const voice of cue) {
      if (voice.kind !== 'tone') continue;
      const key = Math.round(voice.at * 1000);
      const best = groups.get(key);
      if (!best || voice.level > best.level) groups.set(key, voice);
    }
    const loudest = Math.max(...[...groups.values()].map((voice) => voice.level));
    return [...groups.values()].filter((voice) => voice.level >= loudest * 0.4)
      .sort((a, b) => a.at - b.at).map((voice) => ({ at: voice.at, frequency: voice.frequency }));
  }

  it.each(PACKS.map((pack) => [pack.id, pack] as const))(
    '%s should keep the turn reminder and join cue clearly apart', (_id, pack) => {
      const turn = melody(pack.turn);
      const join = melody(pack.join);
      expect(turn).toHaveLength(2);
      expect(join.length).toBeGreaterThanOrEqual(3);
      expect(join.map((entry) => entry.frequency)).toEqual(join.map((entry) => entry.frequency).sort((a, b) => a - b));
      const joinGap = Math.max(...join.slice(1).map((entry, index) => entry.at - join[index].at));
      expect(joinGap).toBeLessThan(turn[1].at - turn[0].at);
    });

  it('should give every pack its own sound for every cue', () => {
    const seen = new Map<string, string>();
    for (const pack of [CLASSIC_SOUND_PACK, ...PACKS]) {
      for (const [name, cue] of Object.entries(allCues(pack))) {
        const key = `${name}:${JSON.stringify(cue)}`;
        expect(seen.get(key), `${pack.id} ${name} repeats ${seen.get(key)}`).toBeUndefined();
        seen.set(key, pack.id);
      }
    }
  });
});

describe('classic pack', () => {
  it('should reproduce the original reminder, join and elimination tones', () => {
    expect(TURN_NOTES).toEqual([[0, 660], [0.12, 880]]);
    expect(JOIN_NOTES).toEqual([[0, 523], [0.1, 659], [0.2, 784]]);
    const tones = (cue: Cue) => cue.filter((voice): voice is ToneVoice => voice.kind === 'tone');
    expect(tones(CLASSIC_SOUND_PACK.turn).map((voice) => [voice.at, voice.frequency])).toEqual([...TURN_NOTES]);
    expect(tones(CLASSIC_SOUND_PACK.join).map((voice) => [voice.at, voice.frequency])).toEqual([...JOIN_NOTES]);
    expect(tones(CLASSIC_SOUND_PACK.out).map((voice) => [voice.at, voice.frequency, voice.decay]))
      .toEqual([[0, 523, 0.2], [0.16, 392, 0.2], [0.32, 262, 0.45]]);
    expect(CLASSIC_SOUND_PACK.card).toHaveLength(1);
    expect(CLASSIC_SOUND_PACK.card[0]).toMatchObject({ kind: 'noise', filter: { frequency: 2400 }, level: 0.6 });
    expect(CLASSIC_SOUND_PACK.pass[0]).toMatchObject({ kind: 'noise', filter: { frequency: 700 }, level: 0.35 });
  });

  it('should time the Dragon Slaying layers from the presentation timeline', () => {
    const cue = CLASSIC_SOUND_PACK.slash({ fireStart: 0.3, fireEnd: 1.85, strike: 1.85, cut: 0.12 });
    expect(cue.map((voice) => voice.at)).toEqual([0.3, 1.83, 1.97].map((value) => expect.closeTo(value, 5)));
    expect(cue.map((voice) => voice.kind === 'noise' && voice.filter.type)).toEqual(['lowpass', 'bandpass', 'lowpass']);
  });
});

describe('active sound pack', () => {
  it('should fall back to classic for unequipped, unknown and inherited ids', () => {
    for (const id of [null, undefined, '', 'sound-unknown', 'classic', 'toString', '__proto__', 'constructor']) {
      expect(resolveSoundPack(id)).toBe(CLASSIC_SOUND_PACK);
    }
    for (const [id, pack] of Object.entries(SOUND_PACK_DEFINITIONS)) expect(resolveSoundPack(id)).toBe(pack);
  });

  it('should follow the account store at play time without a reload', () => {
    expect(getActiveSoundPack()).toBe(CLASSIC_SOUND_PACK);
    equip('sound-gilded');
    expect(getActiveSoundPack()).toBe(SOUND_PACK_DEFINITIONS['sound-gilded']);
    equip('sound-from-a-newer-version');
    expect(getActiveSoundPack()).toBe(CLASSIC_SOUND_PACK);
    equip(null);
    expect(getActiveSoundPack()).toBe(CLASSIC_SOUND_PACK);
  });
});

interface FakeParam {
  value: number;
  events: Array<[kind: string, value: number, time: number]>;
  setValueAtTime: (value: number, time: number) => void;
  linearRampToValueAtTime: (value: number, time: number) => void;
  exponentialRampToValueAtTime: (value: number, time: number) => void;
}

function installAudio(state = 'running') {
  const param = (): FakeParam => {
    const value: FakeParam = {
      value: 0, events: [],
      setValueAtTime: (v, t) => { value.events.push(['set', v, t]); },
      linearRampToValueAtTime: (v, t) => { value.events.push(['linear', v, t]); },
      exponentialRampToValueAtTime: (v, t) => { value.events.push(['exp', v, t]); },
    };
    return value;
  };
  const oscillators: Array<ReturnType<typeof oscillator>> = [];
  const gains: Array<{ gain: FakeParam }> = [];
  const filters: Array<{ frequency: FakeParam }> = [];
  const buffers: Array<{ start: ReturnType<typeof vi.fn> }> = [];
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), onended: null as (() => void) | null });
  const oscillator = () => ({ ...node(), type: '', frequency: param(), start: vi.fn(), stop: vi.fn() });
  const context = {
    state, currentTime: 0, sampleRate: 8000, destination: {},
    resume: vi.fn(async () => { await Promise.resolve(); context.state = 'running'; }), close: vi.fn(async () => undefined),
    createOscillator: vi.fn(() => { const osc = oscillator(); oscillators.push(osc); return osc; }),
    createGain: vi.fn(() => { const g = { ...node(), gain: param() }; gains.push(g); return g; }),
    createBiquadFilter: vi.fn(() => {
      const f = { ...node(), type: '', frequency: param(), Q: param() };
      filters.push(f);
      return f;
    }),
    createBuffer: vi.fn((_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
    createBufferSource: vi.fn(() => { const source = { ...node(), buffer: null, start: vi.fn(), stop: vi.fn() }; buffers.push(source); return source; }),
  };
  vi.stubGlobal('AudioContext', vi.fn(function () { return context; }));
  return { context, oscillators, gains, filters, buffers };
}

describe('synthesis', () => {
  it.each(PACKS.map((pack) => [pack.id, pack] as const))(
    '%s should schedule only valid automation for every cue', async (_id, pack) => {
      const { renderCue, createVoiceTracker } = await import('../../../client/src/audio/sound-synth');
      const { context, oscillators, gains, filters } = installAudio();
      const tracker = createVoiceTracker();
      for (const cue of Object.values(allCues(pack))) {
        renderCue(context as unknown as AudioContext, cue, tracker.track);
      }
      expect(oscillators.length).toBeGreaterThan(0);
      for (const { gain } of gains) {
        let previous = -Infinity;
        for (const [kind, value, time] of gain.events) {
          // The Web Audio API rejects exponential ramps to or from zero and events that go back in time.
          if (kind === 'exp') expect(value).toBeGreaterThan(0);
          expect(Number.isFinite(value) && Number.isFinite(time)).toBe(true);
          expect(time).toBeGreaterThanOrEqual(kind === 'set' ? 0 : previous);
          previous = kind === 'set' ? -Infinity : time;
        }
      }
      for (const { frequency } of filters) {
        for (const [kind, value] of frequency.events) if (kind === 'exp') expect(value).toBeGreaterThan(0);
      }
      for (const osc of oscillators) {
        for (const [kind, value] of osc.frequency.events) if (kind === 'exp') expect(value).toBeGreaterThan(0);
      }
      tracker.stopAll();
    });

  it('should play the equipped pack for turn, join and card cues and classic once unequipped', () => {
    const { context, oscillators, buffers } = installAudio();
    const turn = createTurnSound();
    turn.unlock();
    context.state = 'running';
    turn.play();
    expect(oscillators.map((osc) => osc.frequency.value)).toEqual([660, 880]);
    oscillators.length = 0;
    equip('sound-bamboo');
    turn.play();
    expect(oscillators.map((osc) => osc.frequency.value))
      .toEqual(SOUND_PACK_DEFINITIONS['sound-bamboo'].turn.flatMap((voice) => voice.kind === 'tone' ? [voice.frequency] : []));
    oscillators.length = 0;
    const join = createTurnSound('join');
    join.unlock();
    join.play();
    expect(oscillators.map((osc) => osc.frequency.value))
      .toEqual(SOUND_PACK_DEFINITIONS['sound-bamboo'].join.flatMap((voice) => voice.kind === 'tone' ? [voice.frequency] : []));
    // Explicit notes are a fixed classic reminder regardless of the equipped pack.
    oscillators.length = 0;
    const explicit = createTurnSound([[0, 440]]);
    explicit.unlock();
    explicit.play();
    expect(oscillators.map((osc) => osc.frequency.value)).toEqual([440]);

    unlockCardSounds();
    oscillators.length = 0;
    buffers.length = 0;
    playCardSound();
    expect(oscillators).toHaveLength(1);
    expect(buffers).toHaveLength(1);
    equip(null);
    oscillators.length = 0;
    buffers.length = 0;
    playCardSound();
    expect(oscillators).toHaveLength(0);
    expect(buffers).toHaveLength(1);
    for (const audio of [turn, join, explicit]) audio.dispose();
  });

  it('should preview the turn cue then a card play, replacing an earlier preview and waiting for resume', async () => {
    const { context, oscillators, buffers } = installAudio('suspended');
    const pack = SOUND_PACK_DEFINITIONS['sound-frost'];
    const length = playSoundPackPreview(pack);
    expect(length).toBeGreaterThan(cueDuration(pack.turn));
    expect(oscillators).toHaveLength(0);
    await Promise.resolve();
    await Promise.resolve();
    const turnVoices = pack.turn.length;
    const cardVoices = pack.card.length;
    const tones = (cue: Cue) => cue.filter((voice) => voice.kind === 'tone').length;
    expect(oscillators).toHaveLength(tones(pack.turn) + tones(pack.card));
    expect(buffers).toHaveLength(turnVoices + cardVoices - tones(pack.turn) - tones(pack.card));
    expect(context.resume).toHaveBeenCalled();
    // The card sound follows the turn cue rather than overlapping it.
    const cardTones = oscillators.slice(tones(pack.turn));
    expect(cardTones.every((osc) => osc.start.mock.calls[0][0] >= cueDuration(pack.turn))).toBe(true);
    playSoundPackPreview(SOUND_PACK_DEFINITIONS['sound-dune']);
    expect(oscillators.slice(0, tones(pack.turn) + tones(pack.card)).every((osc) => osc.stop.mock.calls.length >= 2)).toBe(true);
  });

  it('should keep the preview silent when the browser blocks audio', async () => {
    const { context, oscillators } = installAudio('suspended');
    context.resume.mockRejectedValue(new Error('blocked'));
    expect(() => playSoundPackPreview(SOUND_PACK_DEFINITIONS['sound-lotus'])).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(oscillators).toHaveLength(0);
  });
});

describe('note names', () => {
  it('should convert note names to equal-tempered pitches', () => {
    expect(note('A4')).toBeCloseTo(440);
    expect(note('C5')).toBeCloseTo(523.25, 1);
    expect(note('F#5')).toBeCloseTo(739.99, 1);
    expect(note('Eb5')).toBeCloseTo(622.25, 1);
    expect(() => note('H4')).toThrow();
  });
});
