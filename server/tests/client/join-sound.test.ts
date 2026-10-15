import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageEvent } from '../../../shared/src/types';
import { JOIN_NOTES, createTurnSound } from '../../../client/src/audio/turn-sound';
import { isJoinCue } from '../../../client/src/audio/join-cue';

function joinEvent(overrides: Partial<ChatMessageEvent['message']> = {}, roomCode = 'ROOM'): ChatMessageEvent {
  return {
    roomCode,
    message: {
      id: 'm1', sender: { id: 'guest', nickname: 'Guest' } as ChatMessageEvent['message']['sender'],
      content: 'chat.playerJoined', timestamp: 0, system: true, ...overrides,
    },
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('room join sound', () => {
  it('should cue other members when someone joins their current room', () => {
    expect(isJoinCue(joinEvent(), 'ROOM', 'host')).toBe(true);
  });

  it('should ignore the joining player, other rooms, ordinary chat, and other system lines', () => {
    expect(isJoinCue(joinEvent(), 'ROOM', 'guest')).toBe(false);
    expect(isJoinCue(joinEvent({}, 'OTHER'), 'ROOM', 'host')).toBe(false);
    expect(isJoinCue(joinEvent(), null, 'host')).toBe(false);
    expect(isJoinCue(joinEvent({ system: undefined }), 'ROOM', 'host')).toBe(false);
    expect(isJoinCue(joinEvent({ content: 'chat.playerLeft' }), 'ROOM', 'host')).toBe(false);
  });

  it('should play the rising join notes only after audio is unlocked', () => {
    const frequencies: number[] = [];
    const context = {
      state: 'running', currentTime: 0, destination: {},
      resume: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
      createOscillator: vi.fn(() => {
        const voice = { onended: null, type: '', connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
          frequency: { set value(value: number) { frequencies.push(value); } } };
        return voice;
      }),
      createGain: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(), gain: {
        setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
      } })),
    };
    vi.stubGlobal('AudioContext', vi.fn(function () { return context; }));
    const audio = createTurnSound(JOIN_NOTES);
    audio.play();
    expect(frequencies).toEqual([]);
    audio.unlock();
    audio.play();
    expect(frequencies).toEqual([523, 659, 784]);
    audio.dispose();
  });
});
