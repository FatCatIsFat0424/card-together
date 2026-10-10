// ─── GamePage: pick the table by game type ───

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameStore } from '../stores/game-store';
import { useRoomStore } from '../stores/room-store';
import { BridgeTable } from '../games/bridge/BridgeTable';
import { BigTwoTable } from '../games/bigtwo/BigTwoTable';
import { RedPointsTable } from '../games/redpoints/RedPointsTable';
import { NinetyNineTable } from '../games/ninetynine/NinetyNineTable';
import { SevensTable } from '../games/sevens/SevensTable';
import { ChinesePokerTable } from '../games/chinesepoker/ChinesePokerTable';
import { LiarsDeckTable } from '../games/liarsdeck/LiarsDeckTable';
import { BlackjackTable } from '../games/blackjack/BlackjackTable';
import { HoldemTable } from '../games/holdem/HoldemTable';

export function GamePage(): ReactNode {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const roomInfo = useRoomStore((state) => state.roomInfo);
  const phase = useGameStore((state) => state.phase);
  const gameType = useGameStore((state) => state.gameType);

  useEffect(() => {
    if (!roomInfo) navigate('/', { replace: true });
    else if (!phase) navigate(`/room/${roomInfo.code}`, { replace: true });
    else if (roomCode !== roomInfo.code) navigate(`/game/${roomInfo.code}`, { replace: true });
  }, [roomInfo, phase, roomCode, navigate]);

  if (!phase) return null;
  if (gameType === 'bigtwo') return <BigTwoTable />;
  if (gameType === 'ninetynine') return <NinetyNineTable />;
  if (gameType === 'sevens') return <SevensTable />;
  if (gameType === 'chinesepoker') return <ChinesePokerTable />;
  if (gameType === 'liarsdeck') return <LiarsDeckTable />;
  if (gameType === 'blackjack') return <BlackjackTable />;
  if (gameType === 'holdem') return <HoldemTable />;
  return gameType === 'redpoints' ? <RedPointsTable /> : <BridgeTable />;
}
