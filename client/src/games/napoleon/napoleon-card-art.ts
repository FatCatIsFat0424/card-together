// ─── Napoleon card faces: the equipped deck, with a coloured big joker and a greyscale small joker ───

import { useCardOrJokerFaceUrl } from '../../cosmetics/card-faces/use-card-face';

/**
 * Every card follows the player's private card face deck. The rules depend on telling the jokers apart,
 * so the big joker is always coloured and the small joker greyscale; the classic deck uses bundled art.
 */
export const useNapoleonCardImageUrl = useCardOrJokerFaceUrl;
