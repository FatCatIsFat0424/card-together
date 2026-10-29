import type { MouseEvent, ReactNode } from 'react';
import { AppIcon } from './AppIcon';
import styles from './RoomSummaryCard.module.css';

export type RoomSummaryDot = 'filled' | 'required' | 'open';
export type RoomSummaryTone = 'missing' | 'waiting' | 'ready';

export interface RoomSummaryCardProps {
  readonly name: string;
  readonly category: string;
  readonly players: string;
  readonly art?: string;
  readonly dots: readonly RoomSummaryDot[];
  readonly seatedText: string;
  readonly statusText: string;
  readonly tone: RoomSummaryTone;
  readonly hint: string;
  readonly timeChips: readonly string[];
  readonly optionChips: readonly string[];
  readonly settingsLabel: string;
  readonly settingsOpen: boolean;
  readonly settingsEditable: boolean;
  /** Short reminder shown beside the settings button, such as the host's drag tip. */
  readonly note?: string;
  readonly onOpenSettings: (event: MouseEvent<HTMLButtonElement>) => void;
}

/** Waiting-room summary: the game, who is seated, what happens next, and the room rules in force. */
export function RoomSummaryCard(props: RoomSummaryCardProps): ReactNode {
  return <section className={styles.card} aria-label={props.name}>
    <div className={styles.art} style={props.art ? { backgroundImage: `url(${props.art})` } : undefined} aria-hidden="true">
      <span className={styles.category}>{props.category}</span>
      <strong className={styles.artName}>{props.name}</strong>
      <span className={styles.artPlayers}>{props.players}</span>
    </div>
    <div className={styles.body}>
      <div className={styles.top}>
        <p className={styles.title} aria-hidden="true"><strong>{props.name}</strong><small>{props.category}</small></p>
        <div className={styles.status}>
          <span className={styles.count}>
            <span className={styles.dots} aria-hidden="true">
              {props.dots.map((dot, index) => <i key={index} className={styles[dot]} />)}
            </span>
            {props.seatedText}
          </span>
          <span className={`${styles.state} ${styles[props.tone]}`} role="status" title={props.statusText}>{props.statusText}</span>
        </div>
      </div>
      <p className={styles.hint}>{props.hint}</p>
      <div className={styles.bottom}>
        <ul className={styles.chips}>
          {props.timeChips.map((chip) => <li key={chip} className={styles.chip}><AppIcon name="timer" />{chip}</li>)}
          {props.optionChips.map((chip) => <li key={chip} className={`${styles.chip} ${styles.on}`}>
            <AppIcon name="check" />{chip}</li>)}
        </ul>
        <div className={styles.actions}>
          <button type="button" className={`${styles.settings} ${props.settingsEditable ? styles.editable : ''}`}
            aria-haspopup="dialog" aria-expanded={props.settingsOpen} onClick={props.onOpenSettings}>
            <AppIcon name={props.settingsEditable ? 'settings' : 'info'} />{props.settingsLabel}
          </button>
          {props.note && <span className={styles.note}>{props.note}</span>}
        </div>
      </div>
    </div>
  </section>;
}
