import type { ReactNode } from 'react';
import { CHAT_FRAMES } from '@shared/constants';
import type { ChatFrameId } from '@shared/types';
import styles from './ChatFrame.module.css';

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const FRAME_IDS: ReadonlySet<string> = new Set(CHAT_FRAMES.map((frame) => frame.id));

/** Unknown ids (a newer server, a retired product) render like an unequipped sender. */
export function resolveChatFrame(id: string | null | undefined): ChatFrameId | null {
  return id && FRAME_IDS.has(id) ? id as ChatFrameId : null;
}

/** Ornaments are fixed-colour art: the frame tint is mixed into the theme, so they stay legible on any surface. */
function Ornament({ corner, width, height, scale = 0.75, flip, inside = false, children }: {
  readonly corner: Corner; readonly width: number; readonly height: number; readonly scale?: number;
  readonly flip?: 'x' | 'y' | 'xy'; readonly inside?: boolean; readonly children: ReactNode;
}): ReactNode {
  const flipClass = flip === 'x' ? styles.flipX : flip === 'y' ? styles.flipY : flip === 'xy' ? styles.flipXY : '';
  return <svg className={`${styles.orn} ${inside ? styles.inside : ''} ${styles[corner]} ${flipClass}`}
    width={width * scale} height={height * scale} viewBox={`0 0 ${width} ${height}`}
    aria-hidden="true" focusable="false">{children}</svg>;
}

const STAR = 'M0 -1 L0.28 -0.28 L1 0 L0.28 0.28 L0 1 L-0.28 0.28 L-1 0 L-0.28 -0.28Z';

function Blossom({ x, y, scale }: { readonly x: number; readonly y: number; readonly scale: number }): ReactNode {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    {[0, 72, 144, 216, 288].map((angle) => <ellipse key={angle} cx="0" cy="-4.2" rx="3" ry="4.6"
      transform={`rotate(${angle})`} fill="#f6b3cd" stroke="#e07aa2" strokeWidth="0.6" />)}
    <circle r="1.7" fill="#ffd36b" />
  </g>;
}

function Leaf({ x, y, angle, scale, fill }: {
  readonly x: number; readonly y: number; readonly angle: number; readonly scale: number; readonly fill: string;
}): ReactNode {
  return <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
    <path d="M0 0 C6 -6 15 -6 23 0 C15 6 6 6 0 0Z" fill={fill} />
    <path d="M1 0 H20" stroke="#2f6b2c" strokeWidth="0.8" opacity="0.6" />
  </g>;
}

function GildedCorner({ corner, flip }: { readonly corner: Corner; readonly flip?: 'x' | 'y' | 'xy' }): ReactNode {
  return <Ornament corner={corner} width={22} height={22} flip={flip} inside>
    <path d="M2 20 V7 Q2 2 7 2 H20" fill="none" stroke="#d9b45a" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M6 15 V10 Q6 6 10 6 H15" fill="none" stroke="#d9b45a" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
    <path d="M4 0.5 L7.5 4 L4 7.5 L0.5 4Z" fill="#f2d27a" stroke="#b98d2c" strokeWidth="0.6" />
  </Ornament>;
}

function FrostSpokes(): ReactNode {
  return <g fill="none" stroke="#7fcaee" strokeWidth="1.3" strokeLinecap="round">
    {[0, 60, 120].map((angle) => <path key={angle} transform={`rotate(${angle} 15 15)`}
      d="M15 3 V27 M15 8 L11.5 4.5 M15 8 L18.5 4.5 M15 22 L11.5 25.5 M15 22 L18.5 25.5" />)}
  </g>;
}

const ORNAMENTS: Readonly<Record<ChatFrameId, ReactNode>> = {
  'chat-frame-aurora': <>
    <Ornament corner="tr" width={40} height={26}>
      <g fill="none" strokeWidth="2.2" strokeLinecap="round">
        <path d="M6 26 C4 19 11 15 9 9 C8 5 12 3 11 0" stroke="#3ddcb4" opacity="0.9" />
        <path d="M16 26 C14 20 21 16 19 10 C18 6 22 4 21 0" stroke="#5aa9ff" opacity="0.75" />
        <path d="M26 26 C24 21 30 18 29 12 C28 8 31 5 31 2" stroke="#b57bff" opacity="0.6" />
        <path d="M35 26 C34 22 38 20 37 15" stroke="#3ddcb4" opacity="0.4" />
      </g>
    </Ornament>
    <Ornament corner="bl" width={14} height={14} scale={1}>
      <g transform="translate(5 5) scale(4.5)" fill="#9be8d2" opacity="0.8"><path d={STAR} /></g>
      <circle cx="11" cy="10.5" r="1.1" fill="#b9a2ff" opacity="0.8" />
    </Ornament>
  </>,
  'chat-frame-tide': <>
    <Ornament corner="tr" width={38} height={24}>
      <g fill="none" stroke="#4aa3d8" strokeWidth="1.3">
        <circle cx="30" cy="8" r="5" opacity="0.85" />
        <circle cx="20" cy="15" r="3.2" opacity="0.7" />
        <circle cx="33" cy="19" r="2" opacity="0.6" />
        <circle cx="10" cy="20" r="1.5" opacity="0.5" />
      </g>
      <path d="M27.4 6 A3 3 0 0 1 30.4 4.6" fill="none" stroke="#bfe6fb" strokeWidth="1.2" strokeLinecap="round" />
    </Ornament>
  </>,
  'chat-frame-sakura': <>
    <Ornament corner="tr" width={46} height={32} scale={0.7}>
      <g fill="none" stroke="#8a5b4d" strokeWidth="1.6" strokeLinecap="round">
        <path d="M46 4 C36 6 28 8 20 16 C16 20 13 25 9 30" />
        <path d="M31 8 C29 12 28 15 27 19" strokeWidth="1.2" />
      </g>
      <Blossom x={38} y={8} scale={1} />
      <Blossom x={23} y={16} scale={0.9} />
      <Blossom x={11} y={27} scale={0.7} />
    </Ornament>
    <Ornament corner="bl" width={30} height={18} scale={0.7}>
      <ellipse cx="8" cy="11" rx="3" ry="5" transform="rotate(-35 8 11)" fill="#f7bfd4" opacity="0.8" />
      <ellipse cx="20" cy="6" rx="2.4" ry="4" transform="rotate(30 20 6)" fill="#f4a9c6" opacity="0.7" />
    </Ornament>
  </>,
  'chat-frame-constellation': <>
    <Ornament corner="tr" width={48} height={28} scale={0.62}>
      <path d="M4 24 L16 14 L27 18 L37 6 L44 13" fill="none" stroke="#8f9cff" strokeWidth="1" opacity="0.7" />
      <g fill="#b5beff" stroke="#6f7cf0" strokeWidth="0.15">
        <g transform="translate(4 24) scale(2.6)"><path d={STAR} /></g>
        <g transform="translate(16 14) scale(3.4)"><path d={STAR} /></g>
        <g transform="translate(27 18) scale(2.4)"><path d={STAR} /></g>
        <g transform="translate(37 6) scale(4.2)"><path d={STAR} /></g>
        <g transform="translate(44 13) scale(2.2)"><path d={STAR} /></g>
      </g>
    </Ornament>
    <Ornament corner="bl" width={20} height={20} scale={0.8}>
      <g transform="translate(9 11) scale(7.5)" fill="#b5beff" stroke="#6f7cf0" strokeWidth="0.1"><path d={STAR} /></g>
      <circle cx="16" cy="4" r="1" fill="#b5beff" />
      <circle cx="3" cy="3" r="0.8" fill="#b5beff" />
    </Ornament>
  </>,
  'chat-frame-bamboo': <>
    <Ornament corner="tr" width={42} height={30} scale={0.65}>
      <path d="M42 2 L34 5" stroke="#4d8a45" strokeWidth="1.4" strokeLinecap="round" />
      <Leaf x={40} y={3} angle={150} scale={0.95} fill="#5fae55" />
      <Leaf x={38} y={4} angle={122} scale={0.85} fill="#7cc766" />
      <Leaf x={40} y={3} angle={178} scale={0.8} fill="#4d9645" />
    </Ornament>
    <Ornament corner="br" width={30} height={20} scale={0.65}>
      <Leaf x={28} y={17} angle={200} scale={0.7} fill="#6fbb5f" />
      <Leaf x={28} y={17} angle={228} scale={0.6} fill="#4d9645" />
    </Ornament>
  </>,
  'chat-frame-gilded': <>
    <GildedCorner corner="tl" />
    <GildedCorner corner="tr" flip="x" />
    <GildedCorner corner="bl" flip="y" />
    <GildedCorner corner="br" flip="xy" />
  </>,
  'chat-frame-ember': <>
    <Ornament corner="bl" width={16} height={20} scale={0.9}>
      <path d="M8 0 C9.6 4.6 14.5 7 13.6 13.6 C12.8 18 10 20 8 20 C5 20 2 18 2.6 13.6 C3.4 9.6 6.6 8 5.6 4 C7 5 7 2.4 8 0Z"
        fill="#ff6a1a" opacity="0.9" />
      <path d="M8 9 C9.6 12 12 13.4 10.8 16.6 C10 18.6 8 19.4 8 19.4 C6.4 19.4 5.2 17.8 5.6 15.6 C6 13.2 8 12 8 9Z"
        fill="#ffc247" />
    </Ornament>
    <Ornament corner="tr" width={40} height={24}>
      <circle cx="34" cy="16" r="2" fill="#ffb347" />
      <circle cx="26" cy="9" r="1.4" fill="#ff7a2f" />
      <circle cx="18" cy="17" r="1" fill="#ffb347" opacity="0.8" />
      <circle cx="36" cy="5" r="1" fill="#ff7a2f" opacity="0.8" />
      <path d="M30 20 L31.6 16.6 L33.2 20 L31.6 23.4Z" fill="#ffd27a" opacity="0.8" />
    </Ornament>
  </>,
  'chat-frame-lotus': <>
    <Ornament corner="bl" width={40} height={24} scale={0.6}>
      <g stroke="#d86b9a" strokeWidth="0.7" strokeLinejoin="round">
        <path d="M20 22 C9 22 2 18 0 12 C8 12 15 15 20 22Z" fill="#f9c4da" />
        <path d="M20 22 C31 22 38 18 40 12 C32 12 25 15 20 22Z" fill="#f9c4da" />
        <path d="M20 22 C12 20 6 14 5 6 C12 8 18 14 20 22Z" fill="#f6adc9" />
        <path d="M20 22 C28 20 34 14 35 6 C28 8 22 14 20 22Z" fill="#f6adc9" />
        <path d="M20 2 C25 8 25 16 20 22 C15 16 15 8 20 2Z" fill="#fbd9e6" />
      </g>
      <circle cx="20" cy="17" r="1.6" fill="#f2c14e" />
    </Ornament>
    <Ornament corner="tr" width={32} height={20} scale={0.7}>
      <ellipse cx="16" cy="11" rx="12" ry="7" fill="#5fae7a" opacity="0.65" />
      <path d="M16 11 L27 7 M16 11 L5 9 M16 11 L18 18" stroke="#3f8a5c" strokeWidth="0.8" opacity="0.7" fill="none" />
    </Ornament>
  </>,
  'chat-frame-frost': <>
    <Ornament corner="tr" width={30} height={30}><FrostSpokes /></Ornament>
    <Ornament corner="bl" width={28} height={16} scale={0.7}>
      <path d="M0 16 L6 4 L10 16Z" fill="#a9e0f7" opacity="0.65" />
      <path d="M8 16 L16 0 L21 16Z" fill="#8fd3f0" opacity="0.5" />
      <path d="M19 16 L23 8 L28 16Z" fill="#a9e0f7" opacity="0.6" />
    </Ornament>
  </>,
  'chat-frame-dune': <>
    <Ornament corner="tr" width={32} height={26}>
      <circle cx="22" cy="10" r="9.5" fill="none" stroke="#f0a93e" strokeWidth="1" opacity="0.45" />
      <circle cx="22" cy="10" r="6" fill="#f0a93e" opacity="0.9" />
    </Ornament>
    <Ornament corner="bl" width={26} height={10} scale={0.85}>
      <path d="M1 3 Q5 0 9 3 T17 3 T25 3 M5 8 Q9 5 13 8 T21 8" fill="none" stroke="#b9803c" strokeWidth="1"
        strokeLinecap="round" opacity="0.5" />
    </Ornament>
  </>,
};

interface ChatFrameProps {
  readonly id: string | null | undefined;
  readonly as?: 'div' | 'article';
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Wraps a message body in the sender's equipped frame. Without a (known) frame the
 * element and class are exactly what the caller would have rendered.
 */
export function ChatFrame({ id, as: Tag = 'div', className, children }: ChatFrameProps): ReactNode {
  const frame = resolveChatFrame(id);
  if (!frame) return <Tag className={className}>{children}</Tag>;
  return <Tag className={[className, styles.frame, styles[frame]].filter(Boolean).join(' ')} data-chat-frame={frame}>
    <span className={styles.bed} aria-hidden="true" />
    {ORNAMENTS[frame]}
    <div className={styles.content}>{children}</div>
  </Tag>;
}
