import { Router } from 'express';
import type { MatchHistory, PlayerStats } from '@shared/types';
import type { AuthService } from '../auth/auth-service';
import { getRequestSession, requireSession } from '../auth/http-middleware';
import type { Repository } from '../database/repository';
import { publicProfile } from '../social/friend-service';
import { canViewMatchHistory, findMatchReplay, MATCH_REPLAY_ERRORS, matchPlayers } from '../social/match-history-access';
import { matchSummary } from './match-summary';

function isAccountId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

/** Profiles expose the same account fields already visible in the friends list. */
export function createPlayerRouter(repository: Repository, authService: AuthService): Router {
  const router = Router();
  router.use(requireSession(authService));

  router.get('/:accountId', (request, response, next) => {
    const { accountId } = request.params;
    if (!isAccountId(accountId)) {
      response.status(400).json({ success: false, error: 'Invalid player ID.' });
      return;
    }
    void repository
      .getAccountById(accountId)
      .then((account) => {
        if (!account) {
          response.status(404).json({ success: false, error: 'Player not found.' });
          return;
        }
        response.json({ success: true, account: publicProfile(account) });
      })
      .catch(next);
  });

  /** Visible to the owner, or to other signed-in players while public. */
  router.get('/:accountId/history', (request, response, next) => {
    const { accountId } = request.params;
    if (!isAccountId(accountId)) {
      response.status(400).json({ success: false, error: 'Invalid player ID.' });
      return;
    }
    void (async (): Promise<void> => {
      const account = await repository.getAccountById(accountId);
      if (!account) {
        response.status(404).json({ success: false, error: 'Player not found.' });
        return;
      }
      if (!canViewMatchHistory(getRequestSession(response).account.id, account)) {
        response.status(403).json({ success: false, error: MATCH_REPLAY_ERRORS.private });
        return;
      }
      const matches = await repository.listMatches(account.id);
      const history: MatchHistory = { matches: matches.map(matchSummary), players: await matchPlayers(repository, matches) };
      response.json({ success: true, ...history });
    })().catch(next);
  });

  /** Accumulated statistics follow the history's visibility. */
  router.get('/:accountId/stats', (request, response, next) => {
    const { accountId } = request.params;
    if (!isAccountId(accountId)) {
      response.status(400).json({ success: false, error: 'Invalid player ID.' });
      return;
    }
    void (async (): Promise<void> => {
      const account = await repository.getAccountById(accountId);
      if (!account) {
        response.status(404).json({ success: false, error: 'Player not found.' });
        return;
      }
      if (!canViewMatchHistory(getRequestSession(response).account.id, account)) {
        response.status(403).json({ success: false, error: MATCH_REPLAY_ERRORS.private });
        return;
      }
      const stats: PlayerStats = await repository.getPlayerStats(account.id);
      response.json({ success: true, stats });
    })().catch(next);
  });

  router.get('/:accountId/history/:matchId/replay', (request, response, next) => {
    const { accountId, matchId } = request.params;
    if (!isAccountId(accountId)) {
      response.status(400).json({ success: false, error: 'Invalid player ID.' });
      return;
    }
    if (!isAccountId(matchId)) {
      response.status(400).json({ success: false, error: 'Invalid match ID.' });
      return;
    }
    void (async (): Promise<void> => {
      const lookup = await findMatchReplay(repository, getRequestSession(response).account.id, accountId, matchId);
      if (lookup.status !== 'found') {
        response.status(lookup.status === 'private' ? 403 : 404)
          .json({ success: false, error: MATCH_REPLAY_ERRORS[lookup.status] });
        return;
      }
      response.json({ success: true, replay: lookup.replay });
    })().catch(next);
  });

  return router;
}
