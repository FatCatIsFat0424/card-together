import { gamePlayer } from '@shared/rules/seats';
import { isDeepStrictEqual } from 'node:util';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { Repository, NewMatchRecord } from '../database/repository';
import type { RuntimeSnapshot } from './types';
import { captureMatchReplay } from './match-replay';
import { recordReplayStep } from './replay-recording';
import * as playerManager from '../managers/player-manager';
import * as roomManager from '../managers/room-manager';
import * as gameManager from '../managers/game-manager';
import * as chatManager from '../managers/chat-manager';

export interface RuntimeMutationOptions {
  skipUnchanged?: boolean;
  afterCommit?: () => void;
}

export interface RuntimeCoordinator {
  mutate: <T>(operation: () => T | Promise<T>, options?: RuntimeMutationOptions) => Promise<T>;
  /** Reads committed runtime state in queue order without saving it. */
  inspect: <T>(operation: () => T | Promise<T>) => Promise<T>;
  snapshot: () => RuntimeSnapshot;
  subscribe: (listener: () => void) => () => void;
  subscribeCoinRewards: (listener: (rewardedAccountIds: readonly string[]) => void) => () => void;
  idle: () => Promise<void>;
}

function currentState(): RuntimeSnapshot {
  return {
    players: playerManager.exportPlayers(), rooms: roomManager.exportRooms(),
    games: gameManager.exportGames(), chat: chatManager.exportChat(),
  };
}

function snapshot(): RuntimeSnapshot {
  return structuredClone(currentState());
}

function notify(callback: (() => void) | undefined): void {
  try {
    callback?.();
  } catch (error) {
    console.error('[runtime] Post-commit notification failed:', error);
  }
}

function restore(state: RuntimeSnapshot, restarting = false): void {
  playerManager.restorePlayers(state.players, restarting);
  roomManager.restoreRooms(state.rooms);
  gameManager.restoreGames(state.games);
  chatManager.restoreChat(state.chat);
}

/** Serializes game mutations and persists each before acknowledging or broadcasting it. */
export async function createRuntimeCoordinator(repository: Pick<Repository, 'loadRuntime' | 'saveRuntime'>): Promise<RuntimeCoordinator> {
  const initial = await repository.loadRuntime();
  restore(initial ?? { players: [], rooms: [], games: [], chat: [] }, true);
  let queue = Promise.resolve();
  const listeners = new Set<() => void>();
  const coinListeners = new Set<(rewardedAccountIds: readonly string[]) => void>();

  function mutate<T>(operation: () => T | Promise<T>, options: RuntimeMutationOptions = {}): Promise<T> {
    const result = queue.then(async (): Promise<T> => {
      const before = snapshot();
      let value: T;
      const rewardedAccountIds = new Set<string>();
      try {
        value = await operation();
        const previousGames = new Map(before.games.map((game) => [game.id, game]));
        const matches: NewMatchRecord[] = [];
        const completedGameIds: string[] = [];
        for (const game of gameManager.exportGames()) {
          // The final step is recorded before a completed match is archived below.
          recordReplayStep(game, previousGames.get(game.id));
          const result = gameManager.getMatchResult(game);
          if (result && roomManager.getRoomInfo(game.roomCode)?.status === 'playing') {
            roomManager.setRoomStatus(game.roomCode, 'waiting');
            roomManager.resetAllReady(game.roomCode);
            completedGameIds.push(game.id);
            for (const player of Object.values(game.players)) {
              if (!player.isBot) rewardedAccountIds.add(player.id);
            }
            if (Object.values(game.players).every((player) => player.isBot)) continue;
            const replay = captureMatchReplay(game);
            matches.push({
              id: game.id, roomCode: game.roomCode,
              // Empty seats of a Blackjack or Hold'em match are left out, matching the result's `seats`.
              accountIds: GAME_SEAT_ORDER.flatMap((seat) => gamePlayer(game, seat)?.id ?? []),
              result,
              finishedAt: Date.now(),
              ...(replay ? { replay } : {}),
            });
          }
        }
        const after = currentState();
        if (!options.skipUnchanged || matches.length > 0 || !isDeepStrictEqual(before, after)) {
          // Hold the runtime queue until the repository has copied and committed this view.
          // Only the rollback/public snapshots need a separate full deep clone here.
          await repository.saveRuntime(after, matches, completedGameIds);
        }
      } catch (error) {
        restore(before);
        throw error;
      }
      // Notifications run only after durability is established, outside rollback handling.
      // A failing notifier must not report the committed mutation as failed.
      notify(options.afterCommit);
      for (const listener of listeners) notify(listener);
      if (rewardedAccountIds.size > 0) {
        for (const listener of coinListeners) notify(() => listener([...rewardedAccountIds]));
      }
      return value;
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  function inspect<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function subscribeCoinRewards(listener: (rewardedAccountIds: readonly string[]) => void): () => void {
    coinListeners.add(listener);
    return () => { coinListeners.delete(listener); };
  }

  return { mutate, inspect, snapshot, subscribe, subscribeCoinRewards, idle: (): Promise<void> => queue };
}
