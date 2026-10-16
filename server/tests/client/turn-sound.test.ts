import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTurnSound } from '../../../client/src/audio/turn-sound';
import { createTurnSoundController } from '../../../client/src/audio/turn-sound-controller';
import { TRICK_HOLD_MS } from '../../../client/src/games/bridge/trick-presentation';

vi.mock('../../../client/src/stores/account-store', async () => {
  const { create } = await import('zustand');
  return { useAccountStore: create(() => ({ account: null })) };
});

function mockAudio() {
  return { ready: vi.fn(() => true), unlock: vi.fn(), play: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
}

const ownTurn = { room: 'ROOM', turn: 'playing:N:0', completedTricks: 0, enabled: true };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('turn sound transitions', () => {
  it('should cue an owned turn once across duplicate snapshots and mute changes', () => {
    const audio = mockAudio();
    const controller = createTurnSoundController(audio);
    controller.update(ownTurn);
    controller.update({ ...ownTurn });
    controller.update({ ...ownTurn, enabled: false });
    controller.update(ownTurn);
    expect(audio.play).toHaveBeenCalledTimes(1);
    controller.update({ ...ownTurn, turn: null });
    controller.update(ownTurn);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it('should suppress scoring or spectator snapshots and turns while muted', () => {
    const audio = mockAudio();
    const controller = createTurnSoundController(audio);
    controller.update({ ...ownTurn, turn: null });
    controller.update({ ...ownTurn, enabled: false });
    controller.update(ownTurn);
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('should delay a consecutive bridge winner turn until the displayed trick clears', () => {
    vi.useFakeTimers();
    const audio = mockAudio();
    const controller = createTurnSoundController(audio);
    controller.update(ownTurn);
    controller.update({ ...ownTurn, completedTricks: 1, turn: 'playing:N:1' });
    vi.advanceTimersByTime(TRICK_HOLD_MS - 1);
    expect(audio.play).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it.each(['leave', 'mute', 'dispose', 'opponent'])('should cancel held cues on %s', (action) => {
    vi.useFakeTimers();
    const audio = mockAudio();
    const controller = createTurnSoundController(audio);
    controller.update({ ...ownTurn, turn: null });
    const next = { ...ownTurn, completedTricks: 1 };
    controller.update(next);
    if (action === 'dispose') controller.dispose();
    else controller.update({ ...next, enabled: action !== 'mute',
      room: action === 'leave' ? null : next.room,
      turn: action === 'opponent' || action === 'leave' ? null : next.turn });
    vi.runAllTimers();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('should never queue locked turns for a later gesture', () => {
    vi.useFakeTimers();
    const audio = mockAudio();
    audio.ready.mockReturnValue(false);
    const controller = createTurnSoundController(audio);
    controller.update(ownTurn);
    controller.update({ ...ownTurn, completedTricks: 1, turn: 'playing:N:1' });
    audio.ready.mockReturnValue(true);
    vi.runAllTimers();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('should cue consecutive non-bridge actions with distinct identities', () => {
    const audio = mockAudio();
    const controller = createTurnSoundController(audio);
    controller.update({ ...ownTurn, turn: 'ninetynine:N:1' });
    controller.update({ ...ownTurn, turn: 'ninetynine:N:2' });
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
});

describe('turn sound audio', () => {
  function installAudio() {
    const voices: Array<{ onended: (() => void) | null; frequency: { value: number };
      type: string; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>;
      start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
    const context = {
      state: 'suspended', currentTime: 0, destination: {},
      resume: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
      createOscillator: vi.fn(() => {
        const voice = { onended: null, frequency: { value: 0 }, type: '',
          connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
        voices.push(voice);
        return voice;
      }),
      createGain: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(), gain: {
        setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      } })),
    };
    const construct = vi.fn(function () { return context; });
    vi.stubGlobal('AudioContext', construct);
    return { context, construct, voices };
  }

  it('should unlock only explicitly and never replay a cue after async resume', async () => {
    const { context, construct, voices } = installAudio();
    const audio = createTurnSound();
    audio.play();
    expect(construct).not.toHaveBeenCalled();
    audio.unlock();
    audio.play();
    context.state = 'running';
    await Promise.resolve();
    expect(voices).toHaveLength(0);
    audio.play();
    expect(voices).toHaveLength(2);
    expect(voices.map((voice) => voice.frequency.value)).toEqual([660, 880]);
    audio.dispose();
    expect(voices.every((voice) => voice.disconnect.mock.calls.length === 1)).toBe(true);
    expect(context.close).toHaveBeenCalledOnce();
    audio.play();
    audio.unlock();
    expect(voices).toHaveLength(2);
  });

  it('should tolerate unsupported audio and rejected browser permission', async () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => createTurnSound().unlock()).not.toThrow();
    const { context } = installAudio();
    context.resume.mockRejectedValue(new Error('blocked'));
    const audio = createTurnSound();
    audio.unlock();
    await Promise.resolve();
    expect(() => audio.play()).not.toThrow();
    expect(context.createOscillator).not.toHaveBeenCalled();
    audio.dispose();
  });
});
