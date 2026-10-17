import type { ReactNode } from 'react';
import styles from './ChatFrame.module.css';

function Corner({ children, bottom = false }: { readonly children: ReactNode; readonly bottom?: boolean }): ReactNode {
  return <svg className={`${styles.orn} ${bottom ? styles.bl : styles.tr}`} width="29" height="22" viewBox="0 0 48 36"
    aria-hidden="true" focusable="false">{children}</svg>;
}

export const CAMPAIGN_CHAT_ORNAMENTS = {
  'chat-frame-starfleet': <>
    <Corner><path d="M26 2L32 15L46 27L31 23L28 31H24L21 23L8 27L20 15Z" fill="#8deaff" stroke="#245b9c" strokeWidth="1.2" />
      <path d="M26 8L29 16H23Z" fill="#174783" /><path className={styles.engine} d="M23 30V36M29 30V36" stroke="#f5ce71" strokeWidth="2" /></Corner>
    <Corner bottom><g fill="none" stroke="#55bfd7"><path d="M4 26H23L31 18H44M4 32H30L39 23" /><circle cx="32" cy="18" r="3" /></g></Corner>
  </>,
  'chat-frame-shrine': <>
    <Corner><path d="M2 4Q24 11 46 4L43 11H5Z M7 17H41V21H7Z M12 11H17V34H12Z M33 11H38V34H33Z" fill="#cb4f32" stroke="#9d3a24" strokeWidth=".7" />
      <path d="M24 11V18M24 30V35" stroke="#c49b46" /><rect className={styles.lantern} x="20" y="18" width="8" height="12" rx="3" fill="#efc974" /></Corner>
    <Corner bottom><path className={styles.foxfire} d="M13 32Q0 26 12 13Q10 21 17 18Q15 10 22 3Q21 15 28 20Q36 33 13 32Z" fill="#39af9f" /><path d="M14 29Q9 23 17 21Q23 27 14 29Z" fill="#b4ead0" /></Corner>
  </>,
  'chat-frame-ironfront': <>
    <Corner><rect x="5" y="25" width="39" height="9" rx="4.5" fill="#394b33" stroke="#d2ac5a" />
      <path d="M8 25L14 17H34L41 25Z M19 17V10H29L34 17Z" fill="#91a168" /><path d="M28 12H47" stroke="#e0bb66" strokeWidth="3" />
      {[12, 21, 30, 39].map((x) => <circle key={x} cx={x} cy="29.5" r="2" fill="#bbc38b" />)}</Corner>
    <Corner bottom><circle cx="14" cy="20" r="12" fill="none" stroke="#8b9b65" /><circle cx="14" cy="20" r="7" fill="none" stroke="#a4ae79" /><path className={styles.radar} d="M14 20L14 8A12 12 0 0 1 26 20Z" fill="#d2ac5a" opacity=".75" /></Corner>
  </>,
  'chat-frame-neoncity': <>
    <Corner><path d="M5 30V14L15 4H43M12 30V17L19 10H42" fill="none" stroke="#e956db" strokeWidth="2" />
      <path d="M22 17H36V30H22Z" fill="#28365b" stroke="#53eced" /><path className={styles.signal} d="M26 21H32V26H26Z" fill="#8dfbfa" />
      <path d="M36 24H46M29 17V10" stroke="#53eced" /><circle cx="44" cy="4" r="2.5" fill="#53eced" /></Corner>
    <Corner bottom><path d="M3 30H23L32 21H44M7 35H29L37 27H47" fill="none" stroke="#c64ac4" /><circle cx="32" cy="21" r="2" fill="#53eced" /></Corner>
  </>,
  'chat-frame-crownrealm': <>
    <Corner><path d="M12 13H40L37 28Q32 34 26 36Q20 34 15 28Z" fill="#24519a" stroke="#d5aa4f" strokeWidth="1.5" />
      <path className={styles.royalGold} d="M15 12L11 2L20 7L26 0L32 7L41 2L37 12Z" fill="#ebca75" />
      <path d="M20 18L23 15L27 17L30 15L34 20L31 23L33 27L27 31L21 27L23 23L19 21Z" fill="#ebca75" /><path d="M24 20H29M25 24H28" stroke="#24519a" /></Corner>
    <Corner bottom><path d="M5 33V16Q5 10 11 10H42M10 30V18Q10 15 14 15H35" fill="none" stroke="#c69c45" strokeWidth="1.4" /><path d="M5 5L10 10L5 15L0 10Z" fill="#e5c26e" /></Corner>
  </>,
} as const;
