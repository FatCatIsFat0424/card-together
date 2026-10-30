// Development-only entry point; Vite's production build only includes index.html.
import { Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { GameSeat, GameType, RoomInfo, SeatMap } from '@shared/types';
import { getPresentationFrames } from '@shared/game-presentation';
import { LB_PRESETS, lbSwapSlots } from '@shared/rules/landbattle';
import type { LbRank } from '@shared/rules/landbattle';
import { draftPieces } from '../../client/src/games/landbattle/landbattle-view';
import type { PresentationFrame } from '@shared/game-presentation';
import fixturesData from './fixtures.json';
import { expandDemoFixture } from './demo-fixture';
import type { ExpandedDemoStep } from './demo-fixture';
import type { DemoFixture } from './demo-fixture-types';
import { DEMO_SCENES, isDemoGameType } from '../../client/src/game-demos';
import { gameDemoTranslations } from '../../client/src/game-demo-i18n';
import { createTableStores, TableStoreScope } from '../../client/src/games/TableStoreScope';
import { gameUi } from '../../client/src/games/ui-registry';
import { useI18nStore } from '../../client/src/stores/i18n-store';
import { useAccountStore } from '../../client/src/stores/account-store';
import { applyTheme } from '../../client/src/stores/theme-store';
import '../../client/src/styles/global.css';
import './recording-stage.css';

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
  startedAt: number | null;
  finishedAt: number | null;
  scene: string;
  currentStep: number;
  timeline: number[];
}
declare global { interface Window { demoRecording?: RecordingDriver } }

const stores = createTableStores();
const requested = new URLSearchParams(location.search).get('game') ?? 'bridge';
if (!import.meta.env.DEV || !isDemoGameType(requested as GameType)) throw new Error('This recording page is development-only.');
const gameType = requested as keyof typeof DEMO_SCENES;
const fixtures = fixturesData as unknown as { readonly games: Partial<Record<GameType, DemoFixture>> };
const storedFixture = fixtures.games[gameType];
if (!storedFixture) throw new Error('Missing tutorial fixture.');
const fixture = expandDemoFixture(storedFixture);
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
  gameOptions: fixture.roomOptions,
};
stores.room.setState({ roomInfo: room, currentRoomCode: room.code, mySeat: fixture.focusSeat });
useAccountStore.getState().setConnection('ready');
applyTheme('dashboard');

function restore(step: number): void {
  const source = step === 0 ? fixture!.initial : fixture!.steps[step - 1]?.after;
  if (!source) throw new Error(`Unknown tutorial step ${step}.`);
  // The lesson has no ticking clock; arranging remains editable during a paused recording.
  const paused = Object.fromEntries(Object.entries(source).map(([key, value]) =>
    [key, key.endsWith('Deadline') && typeof value === 'number' ? Date.now() + 60_000 : value])) as typeof source;
  const visible = paused.gameType === 'chinesepoker' ? { ...paused, arrangeDeadline: Date.now() + 86_400_000 }
    : paused.gameType === 'napoleon' ? { ...paused, reviewDeadline: null } : paused;
  stores.game.getState().restore(visible);
  if (window.demoRecording) window.demoRecording.currentStep = step;
}
restore(0);
const Table = gameUi(gameType).table;
const Frame = gameUi(gameType).presentation?.Frame;
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

function point(element: Element): void {
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

function boardNode(id: string): Element | null {
  return [...document.querySelectorAll('[data-board-node]')].find((element) => element.getAttribute('data-board-node') === id) ?? null;
}
async function selectNode(id: string): Promise<void> {
  const element = boardNode(id);
  if (!element) throw new Error(`Missing tutorial board node: ${id}.`);
  point(element);
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await wait(300);
}
async function prepareScene(key: string): Promise<void> {
  if (key === 'landbattle-deploy') {
    const action = fixture!.steps[0].action as { layout: LbRank[] };
    let layout: readonly LbRank[] = LB_PRESETS[0];
    // Fill restricted slots first so every intermediate exchange is also legal.
    const order = layout.map((_, index) => index).sort((a, b) => {
      const priority = (rank: LbRank): number => rank === 'flag' ? 0 : rank === 'mine' ? 1 : rank === 'bomb' ? 2 : 3;
      return priority(action.layout[a]) - priority(action.layout[b]);
    });
    const fixed = new Set<number>();
    for (const index of order) {
      if (layout[index] !== action.layout[index]) {
        const other = layout.findIndex((rank, slot) => !fixed.has(slot) && rank === action.layout[index] && lbSwapSlots(layout, index, slot) !== null);
        if (other < 0) throw new Error('Cannot demonstrate the recorded deployment.');
        const pieces = draftPieces(layout, 0);
        await selectNode(pieces[index].node); await selectNode(pieces[other].node);
        layout = lbSwapSlots(layout, index, other)!;
      }
      fixed.add(index);
    }
    point(button('確認布陣'));
  } else if (key === 'battleship-place') {
    const action = fixture!.steps[0].action as { fleet: { cell: number; vertical: boolean }[] };
    let vertical = false;
    for (const [index, ship] of action.fleet.entries()) {
      const choices = document.querySelectorAll<HTMLButtonElement>('[class*="dockShip"]');
      const choice = choices[index];
      if (!choice) throw new Error('Missing fleet selection.');
      point(choice); choice.click(); await wait(400);
      if (ship.vertical !== vertical) { await click('旋轉'); vertical = ship.vertical; }
      await selectNode(`${ship.cell % 10},${Math.floor(ship.cell / 10)}`);
    }
    point(button('確認艦隊'));
  }
}

function cardControl(card: { rank?: number; suit?: string; joker?: string }): HTMLButtonElement | undefined {
  const rank = ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank ?? 0] ?? String(card.rank);
  const suit = ({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' } as Record<string, string>)[card.suit ?? ''];
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => {
    const label = element.getAttribute('aria-label') ?? '';
    return label.startsWith(`${rank}${suit}`) || label === `${suit}${rank}`;
  });
}
async function selectCard(card: { rank?: number; suit?: string; joker?: string }): Promise<void> {
  const element = cardControl(card);
  if (!element || element.disabled) throw new Error('Missing playable tutorial card.');
  point(element); element.click(); await wait(500);
}

async function prepareAction(step: ExpandedDemoStep): Promise<void> {
  if (step.actingSeat !== fixture!.focusSeat || !step.action || typeof step.action !== 'object') return;
  const action = step.action as Record<string, unknown>;
  if (gameType === 'liarsdeck') {
    if (action.type === 'challenge') { point(button('抓騙子！')); await wait(800); }
    else if (Array.isArray(action.cardIds)) {
      const source = step.index === 1 ? fixture!.initial : fixture!.steps[step.index - 2].after;
      if (source.gameType !== 'liarsdeck') throw new Error('Unexpected tavern snapshot.');
      const chosen: HTMLButtonElement[] = [];
      for (const id of action.cardIds) {
        const card = source.myHand.find((candidate) => candidate.id === id);
        if (!card) throw new Error('Missing own tavern card.');
        const label = useI18nStore.getState().t(`liarsdeck.face.${card.face}`);
        const control = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
          .find((element) => element.getAttribute('aria-label')?.startsWith(label) && element.getAttribute('aria-pressed') !== 'true');
        if (!control) throw new Error('Missing tavern card control.');
        point(control); control.click(); chosen.push(control); await wait(400);
      }
      const play = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim().startsWith('出牌'));
      if (play) { point(play); await wait(800); }
      for (const control of chosen) control.click();
    }
  } else if (gameType === 'redpoints' && action.type === 'chooseFlip' && action.capture && typeof action.capture === 'object') {
    const target = cardControl(action.capture);
    if (target) { point(target); await wait(1000); }
  } else if (gameType === 'bigtwo'  && Array.isArray(action.cards)) {
    for (const card of action.cards) await selectCard(card);
    const control = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim().startsWith('出牌'));
    if (control) { point(control); await wait(800); }
    const clear = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === '清除');
    clear?.click();
  } else if ((gameType === 'ninetynine' && (action.choice || action.target)
      || gameType === 'sevens' && action.type === 'cover'
      || gameType === 'crazyeights' && action.suit) && action.card && typeof action.card === 'object') {
    await selectCard(action.card);
    const label = action.choice === 'minus' ? '−20' : gameType === 'sevens' ? '蓋牌' : gameType === 'crazyeights' ? '宣告黑桃' : null;
    const target = [...document.querySelectorAll<HTMLElement>('button, [role=button]')].find((element) =>
      label ? (element.textContent?.includes(label) || element.getAttribute('aria-label')?.includes(label))
        : element.getAttribute('aria-label')?.includes(`${String(action.target)} · 示範玩家`));
    if (target) { point(target); await wait(1000); }
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === '取消');
    cancel?.click();
  } else if (gameType === 'oldmaid' && action.type === 'draw') {
    const cards = document.querySelectorAll('[class*="fan"] button');
    const target = cards[Number(action.index)];
    if (target) { point(target); await wait(800); }
  } else if (gameType === 'gofish' && action.type === 'ask') {
    const card = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) =>
      element.getAttribute('aria-label')?.startsWith(({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[Number(action.rank)] ?? String(action.rank)));
    card?.click(); await wait(500);
    const target = [...document.querySelectorAll<HTMLElement>('[role=button][aria-pressed]')].find((element) =>
      element.getAttribute('aria-label')?.includes(`${String(action.target)} · 示範玩家`));
    target?.click(); await wait(500);
    const ask = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === '發問');
    if (ask) { point(ask); await wait(800); }
  } else if (action.type === 'move'  && typeof action.from === 'string' && typeof action.to === 'string') {
    await selectNode(action.from);
    // A selection can survive a snapshot restore, so the first click may have toggled it off.
    if (!boardNode(action.to)) await selectNode(action.from);
    const target = boardNode(action.to);
    if (!target) throw new Error('Missing legal board destination.');
    point(target); await wait(800);
  } else if (['place', 'flip', 'fire'].includes(String(action.type)) && typeof action.to === 'string') {
    const target = boardNode(action.to);
    if (target) { point(target); await wait(800); }
  } else if ((gameType === 'holdem' || gameType === 'stud') && action.type === 'raise') {
    const opener = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => ['下注', '加注'].includes(candidate.textContent?.trim() ?? ''));
    if (opener) { point(opener); opener.click(); await wait(600); }
    const input = document.querySelector<HTMLInputElement>('input[type=number]');
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, String(action.to));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(600);
      const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => /^(下注|加注|全下) \d/.test(candidate.textContent?.trim() ?? ''));
      if (!confirm) throw new Error('Missing bet confirmation.');
      point(confirm);
      await wait(1000);
    }
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.trim() === '取消');
    cancel?.click();
  } else if (['blackjack', 'tenhalf', 'holdem', 'stud'].includes(gameType)) {
    // Later rounds restore from the previous settlement, which has no chip controls yet.
    const chip = action.type === 'bet' && [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.trim() === String(action.amount));
    if (chip) { point(chip); chip.click(); await wait(600); }
    const labels: Record<string, string> = { hit: '要牌', stand: '停牌', split: '分牌', double: '加倍', bet: '下注', call: '跟注', check: '過牌', fold: '棄牌' };
    const label = labels[String(action.type)];
    const control = label && [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.trim().startsWith(label) && !candidate.disabled);
    if (control) { point(control); await wait(800); }
  } else if (action.type === 'bid' && (gameType === 'bridge' || gameType === 'napoleon')) {
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
  const opening = gameDemoTranslations['zh-TW'][DEMO_SCENES[gameType][0].text];
  const [scene, setScene] = useState<RecordingScene>({ ...opening, step: 0 });
  const [reveal, setReveal] = useState<PresentationFrame | null>(null);
  useEffect(() => {
    let running = false;
    const driver: RecordingDriver = {
      ready: true, done: false, error: null, startedAt: null, finishedAt: null, scene: '', currentStep: 0, timeline: [],
      show: (next) => { restore(next.step); setScene(next); },
      run: (rate = 1) => {
        if (running) return;
        recordingRate = rate;
        running = true;
        driver.startedAt = Date.now();
        void (async (): Promise<void> => {
          for (const part of DEMO_SCENES[gameType]) {
            const started = performance.now();
            const elapsed = (): number => (performance.now() - started) * recordingRate;
            const copy = gameDemoTranslations['zh-TW'][part.text];
            driver.scene = part.text;
            driver.timeline.push(Date.now());
            restore(part.step);
            const ruleCard = !part.until && !part.interaction;
            setScene({ ...copy, rule: ruleCard ? copy.rule : undefined, step: part.step });
            const supplement = copy.rule && !ruleCard ? setTimeout(() => {
              setScene({ title: copy.title, caption: copy.rule!, step: part.step });
            }, part.seconds * 550 / recordingRate) : null;
            await prepareScene(part.text);
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
                if (gameType !== 'liarsdice' && Frame) {
                  const before = index === 1 ? fixture!.initial : fixture!.steps[index - 2].after;
                  const publicGame = { ...step.after, presentation: { id: 'demo', startedAt: Date.now(), logStart: before.log.length, timingVersion: 3 as const } };
                  const publicFrames = getPresentationFrames(publicGame)
                    .filter((candidate) => ['settle', 'showdown', 'award', 'challenge', 'roulette', 'shot'].includes(candidate.kind));
                  for (const frame of publicFrames) {
                    setReveal(frame);
                    await wait(Math.min(7000, interval * .65) / publicFrames.length);
                  }
                  if (publicFrames.length) setReveal(null);
                }
              }
            }
            await wait(Math.max(0, part.seconds * 1000 - elapsed()));
            if (supplement !== null) clearTimeout(supplement);
          }
          driver.done = true;
          driver.finishedAt = Date.now();
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
    {reveal && Frame && <aside className="lessonReveal"><div>
      <h2>{useI18nStore.getState().t(gameUi(gameType).presentation?.heading?.(reveal) ?? `presentation.${reveal.kind}`)}</h2>
      <Frame frame={reveal} name={(seat) => `${seat} · 示範玩家`} />
    </div></aside>}
    <div id="lessonPointer" />
  </TableStoreScope></MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<RecordingStage />);
