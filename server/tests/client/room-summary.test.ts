import { describe, expect, it } from 'vitest';
import type { PlayerInfo, RoomInfo, SeatInfo } from '../../../shared/src/types';
import { roomSeatCards } from '../../../client/src/pages/room-moves';
import {
  roomOptionChips, roomSummaryStatus, roomTimeChips, summaryDots,
} from '../../../client/src/pages/room-summary';
import { roomRulesContext } from '../../../client/src/game-rules-context';

function player(id: string, extra: Partial<PlayerInfo> = {}): PlayerInfo {
  return { id, nickname: id, avatar: 'cat', avatarImage: null, color: '#fff', ...extra } as PlayerInfo;
}

const host = player('host');
const guest = player('guest');
const bot = player('bot', { isBot: true });
const empty: SeatInfo = { player: null, isReady: false };
const seat = (occupant: PlayerInfo, isReady = false): SeatInfo => ({ player: occupant, isReady });

function room(gameType: RoomInfo['gameType'], seats: Partial<RoomInfo['seats']>, extra: Partial<RoomInfo> = {}): RoomInfo {
  return {
    code: 'ABCD', gameType, status: 'waiting', hostId: 'host',
    seats: { N: empty, E: empty, S: empty, W: empty, ...seats }, ...extra,
  } as RoomInfo;
}

function status(info: RoomInfo, isHost: boolean, seatReady: boolean | null = null) {
  return roomSummaryStatus(info, roomSeatCards(info, (name) => name), { isHost, seatReady });
}

describe('room summary status', () => {
  it('counts the players still missing, for the host and for guests', () => {
    const info = room('xiangqi', { S: seat(host) });
    expect(status(info, true)).toMatchObject({
      stage: 'missing', count: 1, seated: 1, tagKey: 'room.summaryMissing', hintKey: 'room.summaryHintInvite',
    });
    expect(status(info, false)).toMatchObject({ stage: 'missing', hintKey: 'room.summaryHintWaitPlayers' });
  });

  it('skips counts a game does not allow', () => {
    const seated = (extra: number): RoomInfo => room('chinesecheckers', {
      N: seat(host), E: seat(bot), S: seat(bot), W: seat(bot),
    }, { additionalSeats: Array.from({ length: extra }, () => seat(bot)) });
    expect(status(seated(1), true)).toMatchObject({ stage: 'missing', count: 1, seated: 5 });
    expect(status(seated(2), true).stage).toBe('ready');
  });

  it('waits for the humans who have not readied up; hosts and bots count as ready', () => {
    const info = room('bridge', { N: seat(host), E: seat(bot), S: seat(guest), W: seat(player('late')) });
    expect(status(info, true)).toMatchObject({
      stage: 'waiting', count: 2, tagKey: 'room.summaryUnready', hintKey: 'room.summaryHintWaitReady',
    });
    expect(status(info, false, false).hintKey).toBe('room.summaryHintPressReady');
    expect(status(info, false, true).hintKey).toBe('room.summaryHintWaitReady');
  });

  it('is ready to start once everyone is ready, with different wording for the host', () => {
    const info = room('xiangqi', { N: seat(host), S: seat(guest, true) });
    expect(status(info, true)).toMatchObject({
      stage: 'ready', count: 0, tagKey: 'room.summaryReadyHost', hintKey: 'room.summaryHintPressStart',
    });
    expect(status(info, false, true)).toMatchObject({
      stage: 'ready', tagKey: 'room.summaryReadyGuest', hintKey: 'room.summaryHintWaitHost',
    });
  });

  it('still needs a human when only bots are seated', () => {
    const info = room('xiangqi', { N: seat(bot), S: seat(bot) });
    expect(status(info, true)).toMatchObject({ stage: 'missing', count: 1 });
  });

  it('marks taken, required and optional seats with dots', () => {
    expect(summaryDots(1, 4, 3)).toEqual(['filled', 'required', 'required', 'open']);
  });
});

describe('room summary chips', () => {
  it('lists enabled Banqi rules and the seat shuffle only', () => {
    const plain = room('banqi', {}, { gameOptions: { banqi: { chain: false, rookDash: false } } as RoomInfo['gameOptions'] });
    expect(roomOptionChips(plain, roomRulesContext(plain))).toEqual([]);
    const chain = room('banqi', {}, { shuffleSeats: true, gameOptions: { banqi: { chain: true, rookDash: false } } as RoomInfo['gameOptions'] });
    expect(roomOptionChips(chain, roomRulesContext(chain)).map((chip) => chip.label)).toEqual([
      'banqi.chain', 'room.shuffleSeats',
    ]);
  });

  it('shows the reserve clock only when there is one', () => {
    expect(roomTimeChips({ baseSeconds: 60, bankSeconds: 300 }).map((chip) => chip.label)).toEqual([
      'room.summaryTurn', 'room.summaryBank',
    ]);
    expect(roomTimeChips({ baseSeconds: 30, bankSeconds: 0 })).toEqual([
      { key: 'turn', label: 'room.summaryTurn', params: { n: '30' } },
    ]);
  });
});
