// Development-only entry point; Vite's production build only includes index.html.
import { Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { GameSeat, GameType, PlayerVisibleGameState, RoomInfo, SeatMap } from '@shared/types';
import { getPresentationFrames } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import fixturesData from './fixtures.json';
import { DEMO_SCENES, hasGameDemo } from '../../client/src/game-demos';
import { gameDemoTranslations } from '../../client/src/game-demo-i18n';
import { createTableStores, TableStoreScope } from '../../client/src/games/TableStoreScope';
import { gameUi } from '../../client/src/games/ui-registry';
import { LiarsDiceFrame } from '../../client/src/games/liarsdice/LiarsDiceFrame';
import { useAccountStore } from '../../client/src/stores/account-store';
import { applyTheme } from '../../client/src/stores/theme-store';
import '../../client/src/styles/global.css';
import './recording-stage.css';

interface DemoStep {
  readonly index: number;
  readonly actingSeat: GameSeat;
  readonly action: unknown;
  readonly after: PlayerVisibleGameState;
}
interface DemoFixture {
  readonly focusSeat: GameSeat;
  readonly seats: readonly GameSeat[];
  readonly initial: PlayerVisibleGameState;
  readonly steps: readonly DemoStep[];
}
interface RecordingScene {
  readonly title: string;
  readonly caption: string;
  readonly step: number;
  readonly rule?: string;
}
interface RecordingDriver {
  show: (scene: RecordingScene) => void;
  run: (rate?: number) => void;
  readonly ready: boolean;
  done: boolean;
  error: string | null;
}
declare global { interface Window { demoRecording?: RecordingDriver } }

const stores = createTableStores();
const requested = new URLSearchParams(location.search).get('game') ?? 'bridge';
if (!import.meta.env.DEV || !hasGameDemo(requested as GameType)) throw new Error('This recording page is development-only.');
const gameType = requested as keyof typeof DEMO_SCENES;
const fixtures = fixturesData as unknown as { readonly games: Partial<Record<GameType, DemoFixture>> };
const fixture = fixtures.games[gameType];
if (!fixture) throw new Error('Missing tutorial fixture.');
const seats = Object.fromEntries(['N', 'E', 'S', 'W'].map((seat) => [seat, {
  player: fixture.seats.includes(seat as GameSeat) ? {
    id: `demo-${seat}`, username: `demo_${seat}`, nickname: `${seat} · 示範玩家`,
    color: '#4a9eff', avatar: 'cat', avatarImage: null,
  } : null,
  isReady: true,
}])) as SeatMap;
const room: RoomInfo = {
  code: 'LESSON', gameType, seats, status: 'playing', hostId: 'demo-N', createdAt: 0,
  abortVote: null, abortVoteCooldownUntil: null,
};
stores.room.setState({ roomInfo: room, currentRoomCode: room.code, mySeat: fixture.focusSeat });
useAccountStore.getState().setConnection('ready');
applyTheme('dashboard');

function restore(step: number): void {
  const source = step === 0 ? fixture!.initial : fixture!.steps[step - 1]?.after;
  if (!source) throw new Error(`Unknown tutorial step ${step}.`);
  // The lesson has no ticking clock; arranging remains editable during a paused recording.
  const visible = source.gameType === 'chinesepoker' ? { ...source, arrangeDeadline: Date.now() + 86_400_000 }
    : source.gameType === 'napoleon' ? { ...source, reviewDeadline: null } : source;
  stores.game.getState().restore(visible);
}
restore(0);
const Table = gameUi(gameType).table;
let recordingRate = 1;
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms / recordingRate));

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((element) =>
    element.getAttribute('aria-label') === label || element.getAttribute('aria-label')?.startsWith(`${label} (`)
      || element.textContent?.trim() === label
      || label === '確認' && element.textContent?.trim().startsWith('確認'));
  if (!found) throw new Error(`Missing recording control: ${label}`);
  return found;
}

function point(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const pointer = document.getElementById('lessonPointer');
  if (pointer) {
    pointer.style.opacity = '1';
    pointer.style.transform = `translate(${rect.x + rect.width / 2 - 20}px, ${rect.y + rect.height / 2 - 20}px)`;
    setTimeout(() => { pointer.style.opacity = '0'; }, 800);
  }
}

async function click(label: string): Promise<void> {
  const element = button(label);
  if (element.disabled) throw new Error(`Disabled recording control: ${label}`);
  point(element);
  element.click();
  await wait(600);
}

async function arrange(row: 'front' | 'middle' | 'back'): Promise<void> {
  const cards = { front: ['2♣', '2♦', '9♠'], middle: ['3♣', '4♦', '5♥', '6♠', '7♣'], back: ['K♥', 'Q♥', '9♥', '7♥', '3♥'] };
  for (const card of cards[row]) await click(card);
  await click(`把選取的牌放到${{ front: '頭墩', middle: '中墩', back: '尾墩' }[row]}`);
}

async function prepareAction(step: DemoStep): Promise<void> {
  if (step.actingSeat !== fixture!.focusSeat || !step.action || typeof step.action !== 'object') return;
  const action = step.action as Record<string, unknown>;
  if (action.type === 'bid' && (gameType === 'bridge' || gameType === 'napoleon')) {
    await click(gameType === 'bridge' ? '3' : '9');
    await click(gameType === 'bridge' ? '3♥' : '9♥');
    point(button('確認'));
  } else if (gameType === 'liarsdice' && action.type === 'bid') {
    const output = document.querySelector('output');
    const quantity = Number(action.quantity);
    for (let attempt = 0; attempt < 10 && Number(output?.textContent) !== quantity; attempt++) {
      await click(Number(output?.textContent) < quantity ? '增加個數' : '減少個數');
    }
    const face = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((element) => element.getAttribute('aria-label')?.includes(String(action.face)));
    if (face) { point(face); face.click(); }
  } else if (gameType === 'napoleon' && action.type === 'discard') {
    await click('2♣'); await click('3♣');
  } else if (gameType === 'napoleon' && action.type === 'call') {
    await click('♠'); await click('♠A');
  } else if (action.type === 'play' && action.card && typeof action.card === 'object') {
    const card = action.card as { rank?: number; suit?: string; joker?: string };
    const rank = ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank ?? 0] ?? String(card.rank);
    const name = card.joker ? card.joker === 'big' ? '大鬼' : '小鬼'
      : `${rank}${({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' } as Record<string, string>)[card.suit ?? '']}`;
    const element = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.getAttribute('aria-label')?.startsWith(name));
    if (element) point(element);
  }
}

function RecordingStage(): ReactNode {
  const opening = gameDemoTranslations['zh-TW'].start;
  const [scene, setScene] = useState<RecordingScene>({ ...opening, step: 0 });
  const [reveal, setReveal] = useState<PresentationFrame | null>(null);
  useEffect(() => {
    let running = false;
    const driver: RecordingDriver = {
      ready: true, done: false, error: null,
      show: (next) => { restore(next.step); setScene(next); },
      run: (rate = 1) => {
        if (running) return;
        recordingRate = rate;
        running = true;
        void (async (): Promise<void> => {
          for (const part of DEMO_SCENES[gameType]) {
            const started = performance.now();
            const elapsed = (): number => (performance.now() - started) * recordingRate;
            const copy = gameDemoTranslations['zh-TW'][part.text];
            restore(part.step);
            const ruleCard = !part.until && !part.interaction;
            setScene({ ...copy, rule: ruleCard ? copy.rule : undefined, step: part.step });
            const supplement = copy.rule && !ruleCard ? setTimeout(() => {
              setScene({ title: copy.title, caption: copy.rule!, step: part.step });
            }, part.seconds * 550 / recordingRate) : null;
            if (part.interaction) {
              await wait(1500);
              if (part.interaction === 'edit') {
                await click('2♣：收回手上'); await click('2♣'); await click('把選取的牌放到頭墩');
                await click('自動擺牌');
                await wait(1800);
                await click('清空三墩');
                await arrange('front'); await arrange('middle'); await arrange('back');
              } else await arrange(part.interaction);
            }
            if (part.until) {
              const interval = (part.seconds * 1000 - 3500) / (part.until - part.step);
              for (let index = part.step + 1; index <= part.until; index++) {
                const due = 3500 + (index - part.step - 1) * interval;
                await wait(Math.max(0, due - elapsed()));
                const step = fixture!.steps[index - 1];
                if (interval > 2500) await prepareAction(step);
                if (step.after.gameType === 'liarsdice' && step.action && typeof step.action === 'object'
                  && 'type' in step.action && step.action.type === 'challenge') {
                  const before = index === 1 ? fixture!.initial : fixture!.steps[index - 2].after;
                  const game = { ...step.after, presentation: { id: 'demo', startedAt: Date.now(), logStart: before.log.length, timingVersion: 3 as const } };
                  const frame = getPresentationFrames(game).find((candidate) => candidate.kind === 'diceReveal');
                  if (!frame) throw new Error('Missing public dice reveal.');
                  setReveal(frame);
                  if (copy.outcome) setScene({ title: copy.title, caption: copy.outcome, step: index });
                  await wait(Math.min(7000, interval * .7));
                  setReveal(null);
                  if (copy.rule) setScene({ title: copy.title, caption: copy.rule, step: index });
                }
                restore(index);
              }
            }
            await wait(Math.max(0, part.seconds * 1000 - elapsed()));
            if (supplement !== null) clearTimeout(supplement);
          }
          driver.done = true;
        })().catch((error: unknown) => { driver.error = String(error); });
      },
    };
    window.demoRecording = driver;
    return () => { delete window.demoRecording; };
  }, []);
  return <MemoryRouter><TableStoreScope stores={stores}>
    <header className="lessonHeader">
      <div className="lessonMeta">Card Together · 新手對局展示 · 固定範例 · {fixture!.focusSeat} 家視角</div>
      <h1>{scene.title}</h1><p>{scene.caption}</p>
    </header>
    <main className="lessonTable"><Suspense fallback={<p>載入牌桌…</p>}><Table /></Suspense></main>
    {scene.rule && <aside className="lessonRule"><span>規則補充</span><p>{scene.rule}</p></aside>}
    {reveal && <aside className="lessonReveal"><LiarsDiceFrame frame={reveal} name={(seat) => `${seat} · 示範玩家`} /></aside>}
    <div id="lessonPointer" />
  </TableStoreScope></MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<RecordingStage />);
