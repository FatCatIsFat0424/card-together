import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Select from '@mui/material/Select';
import type { SelectChangeEvent, SelectProps } from '@mui/material/Select';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import type { GameOptions, GameType, RoomInfo } from '@shared/types';
import { RoomOption } from '../../../client/src/components/RoomOption';
import { RoomSettings } from '../../../client/src/components/RoomSettings';
import type { RoomSettingsActions } from '../../../client/src/components/RoomSettings';
import { gameUi } from '../../../client/src/games/ui-registry';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

// Capture handlers while retaining the real controls and their accessible markup.
vi.mock('../../../client/src/components/RoomOption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../client/src/components/RoomOption')>();
  return { RoomOption: vi.fn(actual.RoomOption) };
});
vi.mock('@mui/material/Select', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material/Select')>();
  return { ...actual, default: vi.fn((props: SelectProps) => createElement(actual.default, props)) };
});
vi.mock('../../../client/src/stores/i18n-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../client/src/stores/i18n-store')>();
  return { useI18nStore: Object.assign(() => actual.useI18nStore.getState(), {
    getState: actual.useI18nStore.getState,
  }) };
});
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: { account: null }) => unknown) => select({ account: null }),
}));

const optionIds = {
  sevens: 'sevens-close-on-end-hint',
  ninetynine: 'ninetynine-two-decks-hint',
  blackjack: 'blackjack-player-dealer-hint',
  napoleon: 'napoleon-joker-summon-hint',
} as const;
const configuredGames = ['sevens', 'ninetynine', 'blackjack', 'napoleon'] as const;
const saved: GameOptions = {
  sevens: { closeOnEnd: true, slayEffect: 'fire' },
  ninetynine: { twoDecks: true },
  blackjack: { playerDealer: true },
  napoleon: { jokerSummon: false },
};

function room(gameType: GameType, gameOptions?: GameOptions): RoomInfo {
  return {
    code: 'ABC123', gameType, status: 'waiting', createdAt: 1, hostId: 'host',
    seats: { N: { player: null, isReady: false }, E: { player: null, isReady: false },
      S: { player: null, isReady: false }, W: { player: null, isReady: false } },
    abortVote: null, abortVoteCooldownUntil: null, gameOptions,
  };
}

const actions: RoomSettingsActions = {
  setGameType: vi.fn(), setTimeControl: vi.fn(), setShuffleSeats: vi.fn(), setGameOptions: vi.fn(),
};

function render(settings: RoomInfo, editable = true, isHost = true, pending = false): string {
  return renderToStaticMarkup(createElement(RoomSettings, {
    ...actions, room: settings, editable, isHost, pending,
  }));
}

function option(id: string): Parameters<typeof RoomOption>[0] {
  const props = vi.mocked(RoomOption).mock.calls.findLast(([props]) => props.id === id)?.[0];
  expect(props).toBeDefined();
  return props!;
}

function slaySelect(): SelectProps {
  const props = vi.mocked(Select).mock.calls.findLast(([props]) => {
    const input = props.inputProps as { 'aria-describedby'?: string } | undefined;
    return input?.['aria-describedby'] === 'sevens-slay-effect-hint';
  })?.[0];
  expect(props).toBeDefined();
  return props!;
}

describe('per-game room options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.getState().setLocale('en');
  });

  it('registers room options only for games with configurable rules', () => {
    expect(GAME_TYPES.filter((gameType) => gameUi(gameType).roomOptions)).toEqual(
      GAME_TYPES.filter((gameType) => configuredGames.some((configured) => configured === gameType)),
    );
  });

  it.each(configuredGames)('keeps %s labels, hint ids, and accessible descriptions in both languages', (gameType) => {
    for (const locale of ['en', 'zh-TW'] as const) {
      useI18nStore.getState().setLocale(locale);
      const html = render(room(gameType, saved));
      const props = option(optionIds[gameType]);
      expect(html).toContain(renderToStaticMarkup(createElement('span', null, props.label)));
      expect(html).toContain(`title="${props.hint}"`);
      expect(html).toContain(`aria-describedby="${props.id}"`);
      expect(html).toContain(`id="${props.id}"`);
      expect(props.disabled).toBe(false);
      for (const other of configuredGames.filter((other) => other !== gameType)) {
        expect(html).not.toContain(`id="${optionIds[other]}"`);
      }
    }
  });

  it('retains each game option when switching games without mutating the saved map', () => {
    const before = structuredClone(saved);
    for (const gameType of [...configuredGames, 'bridge', ...configuredGames] as const) {
      const html = render(room(gameType, saved));
      if (gameType === 'bridge') {
        for (const id of Object.values(optionIds)) expect(html).not.toContain(`id="${id}"`);
      } else {
        expect(option(optionIds[gameType]).checked).toBe(gameType !== 'napoleon');
      }
    }
    expect(saved).toEqual(before);
  });

  it.each(configuredGames)('preserves the missing-option default for %s', (gameType) => {
    const html = render(room(gameType));
    expect(option(optionIds[gameType]).checked).toBe(gameType === 'napoleon');
    expect(html).not.toContain('id="sevens-slay-effect-hint"');
  });

  it.each([
    ['sevens', { closeOnEnd: false, slayEffect: 'fire' }],
    ['ninetynine', { twoDecks: false }],
    ['blackjack', { playerDealer: false }],
    ['napoleon', { jokerSummon: false }],
  ] as const)('emits the typed game/options payload for %s', (gameType, options) => {
    render(room(gameType, saved));
    option(optionIds[gameType]).onChange(false);
    expect(actions.setGameOptions).toHaveBeenCalledExactlyOnceWith({ gameType, options });
  });

  it('enables legacy Sevens rules and retains the chosen effect across toggles', () => {
    render(room('sevens'));
    option(optionIds.sevens).onChange(true);
    expect(actions.setGameOptions).toHaveBeenLastCalledWith({ gameType: 'sevens', options: { closeOnEnd: true } });
    render(room('sevens', { ...saved, sevens: { closeOnEnd: false, slayEffect: 'fire' } }));
    option(optionIds.sevens).onChange(true);
    expect(actions.setGameOptions).toHaveBeenLastCalledWith({
      gameType: 'sevens', options: { closeOnEnd: true, slayEffect: 'fire' },
    });
  });

  it('shows the Sevens Select only when enabled, defaults to dragon, and validates its value', () => {
    let html = render(room('sevens', { sevens: { closeOnEnd: true } }));
    expect(slaySelect().value).toBe('dragon');
    expect(html).toContain('aria-describedby="sevens-slay-effect-hint"');
    expect(html).toContain(`aria-label="${useI18nStore.getState().t('sevens.slayEffect')}"`);
    html = render(room('sevens', saved));
    expect(slaySelect().value).toBe('fire');
    slaySelect().onChange?.({ target: { value: 'dragon' } } as SelectChangeEvent, null);
    expect(actions.setGameOptions).toHaveBeenCalledExactlyOnceWith({
      gameType: 'sevens', options: { closeOnEnd: true, slayEffect: 'dragon' },
    });
    slaySelect().onChange?.({ target: { value: 'invalid' } } as SelectChangeEvent, null);
    expect(actions.setGameOptions).toHaveBeenCalledTimes(1);
    expect(html).toContain('id="sevens-slay-effect-hint"');
  });

  it.each(configuredGames)('locks %s inputs for non-hosts, active rooms, and pending requests', (gameType) => {
    for (const [settings, isHost, pending] of [
      [room(gameType, saved), false, false],
      [{ ...room(gameType, saved), status: 'playing' }, true, false],
      [room(gameType, saved), true, true],
    ] as const) {
      const html = render(settings, false, isHost, pending);
      expect(option(optionIds[gameType]).disabled).toBe(true);
      const checkbox = html.match(new RegExp(`<input[^>]*aria-describedby="${optionIds[gameType]}"[^>]*>`))?.[0];
      expect(checkbox).toContain('disabled');
      if (gameType === 'sevens') expect(slaySelect().disabled).toBe(true);
      expect(html.includes(useI18nStore.getState().t('room.hostOnly'))).toBe(!isHost);
      expect(html.includes('data-pending-disabled="true"')).toBe(pending);
    }
  });
});
