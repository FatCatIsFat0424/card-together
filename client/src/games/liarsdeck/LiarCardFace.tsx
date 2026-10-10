import type { ReactNode } from 'react';
import type { LiarFace } from '@shared/types';
import { cardImageUrl } from '../../cards';
import { liarFaceCard } from './liarsdeck-view';

const JOKER_LETTERS = ['J', 'O', 'K', 'E', 'R'];

/** The card graphics library has no joker, so it is drawn here in the same card proportions. */
function JokerArt({ className, label }: { className?: string; label: string }): ReactNode {
  const corner = <g fill="#b3261e" fontFamily="Georgia, serif" fontSize="24" fontWeight="700" textAnchor="middle">
    {JOKER_LETTERS.map((letter, index) => <text key={letter} x="24" y={40 + index * 24}>{letter}</text>)}
  </g>;
  // An empty label means the surrounding control already names the card.
  return <svg className={className} viewBox="0 0 224 313" {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
    <rect x="1" y="1" width="222" height="311" rx="14" fill="#fffdf7" stroke="#8a8a8a" strokeWidth="2" />
    {corner}
    <g transform="rotate(180 112 156.5)">{corner}</g>
    <g transform="translate(112 168)">
      <path d="M-62 34 Q-52 -8 -74 -58 Q-30 -34 0 -74 L0 40 Q-30 44 -62 34Z" fill="#b3261e" />
      <path d="M62 34 Q52 -8 74 -58 Q30 -34 0 -74 L0 40 Q30 44 62 34Z" fill="#1f3a68" />
      <path d="M-64 32 Q0 50 64 32 L64 50 Q0 68 -64 50Z" fill="#e0a800" />
      <circle cx="-74" cy="-58" r="10" fill="#e0a800" />
      <circle cx="0" cy="-74" r="10" fill="#e0a800" />
      <circle cx="74" cy="-58" r="10" fill="#e0a800" />
    </g>
  </svg>;
}

/** K/Q/A use the standard card art with a decorative suit chosen by `variant`. */
export function LiarCardFace({ face, variant, label, className }: {
  face: LiarFace; variant: number; label: string; className?: string;
}): ReactNode {
  if (face === 'joker') return <JokerArt className={className} label={label} />;
  return <img className={className} src={cardImageUrl(liarFaceCard(face, variant))} alt={label} draggable={false} />;
}
