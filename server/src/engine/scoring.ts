// ─── Scoring Engine ───

import type { Seat, Contract, GameResult, Team } from '@shared/types';
import { CONTRACT_BASE_TRICKS, TEAM_SEATS } from '@shared/constants';

/**
 * Get the team a seat belongs to
 */
export function getSeatTeam(seat: Seat): Team {
  if (TEAM_SEATS.EW.includes(seat)) return 'EW';
  return 'NS';
}

/**
 * Compute the game result
 */
export function calculateGameResult(
  contract: Contract,
  trickCountEW: number,
  trickCountNS: number,
): GameResult {
  const declarerTeam = getSeatTeam(contract.declarer);
  const requiredTricks = CONTRACT_BASE_TRICKS + contract.level;

  const declarerTeamTricks = declarerTeam === 'EW' ? trickCountEW : trickCountNS;
  const defenderTeamTricks = declarerTeam === 'EW' ? trickCountNS : trickCountEW;

  return {
    contract,
    declarerTeamTricks,
    defenderTeamTricks,
    requiredTricks,
    declarerTeamWins: declarerTeamTricks >= requiredTricks,
  };
}
