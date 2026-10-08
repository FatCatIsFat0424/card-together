import type { RoomCode, Seat } from '@shared/types';
import type { BotAction } from '../bots/bot-decisions';
import * as gameManager from '../managers/game-manager';

export function applyAutomatedAction(code: RoomCode, seat: Seat, action: BotAction): { success: boolean; reason?: string } {
  switch (action.type) {
    case 'bridge-redeal': return gameManager.handleRedealResponse(code, seat, action.accept, true);
    case 'bridge-bid': return gameManager.handleBid(code, seat, action.action, true);
    case 'bridge-play': return gameManager.handlePlayCard(code, seat, action.card, true);
    case 'bigtwo-play': return gameManager.handleBigTwoPlay(code, seat, action.cards, true);
    case 'bigtwo-pass': return gameManager.handleBigTwoPass(code, seat, true);
    case 'redpoints-play': return gameManager.handleRedPointsPlay(code, seat, action.card, action.capture, true);
    case 'redpoints-flip': return gameManager.handleRedPointsChooseFlip(code, seat, action.capture, true);
    case 'ninetynine-play': return gameManager.handleNinetyNinePlay(code, seat, action.card, action.choice, action.target, true);
  }
}
