import { Router } from 'express';
import type { MatchHistory, PublicAccount } from '@shared/types';
import type { AuthService } from '../auth/auth-service';
import { getRequestSession, requireSession } from '../auth/http-middleware';
import type { Repository } from '../database/repository';
import { publicProfile } from '../social/friend-service';

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

  /** Visible to the owner, or to everyone once the owner made it public. */
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
      if (account.id !== getRequestSession(response).account.id && !account.matchesPublic) {
        response.status(403).json({ success: false, error: 'Match history is private.' });
        return;
      }
      const matches = await repository.listMatches(account.id);
      const players: Record<string, PublicAccount> = {};
      for (const id of new Set(matches.flatMap((match) => match.accountIds))) {
        const player = await repository.getAccountById(id);
        if (player) players[id] = publicProfile(player);
      }
      const history: MatchHistory = { matches, players };
      response.json({ success: true, ...history });
    })().catch(next);
  });

  return router;
}
