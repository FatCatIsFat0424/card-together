import type { ReactNode } from 'react';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import ChatBubbleOutline from '@mui/icons-material/ChatBubbleOutlined';
import Check from '@mui/icons-material/Check';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutlined';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import Circle from '@mui/icons-material/Circle';
import Close from '@mui/icons-material/Close';
import ContentCopy from '@mui/icons-material/ContentCopy';
import EmojiEventsOutlined from '@mui/icons-material/EmojiEventsOutlined';
import Filter7 from '@mui/icons-material/Filter7';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import Flare from '@mui/icons-material/Flare';
import GpsFixed from '@mui/icons-material/GpsFixed';
import HighlightOff from '@mui/icons-material/HighlightOff';
import LockOutlined from '@mui/icons-material/LockOutlined';
import Logout from '@mui/icons-material/Logout';
import Menu from '@mui/icons-material/Menu';
import MicNone from '@mui/icons-material/MicNone';
import MusicNote from '@mui/icons-material/MusicNote';
import Pause from '@mui/icons-material/Pause';
import PlayArrow from '@mui/icons-material/PlayArrow';
import Repeat from '@mui/icons-material/Repeat';
import RepeatOne from '@mui/icons-material/RepeatOne';
import SentimentSatisfiedOutlined from '@mui/icons-material/SentimentSatisfiedOutlined';
import Shuffle from '@mui/icons-material/Shuffle';
import SkipNext from '@mui/icons-material/SkipNext';
import SkipPrevious from '@mui/icons-material/SkipPrevious';
import SportsBar from '@mui/icons-material/SportsBar';
import TimerOutlined from '@mui/icons-material/TimerOutlined';
import UnfoldMore from '@mui/icons-material/UnfoldMore';
import WarningAmber from '@mui/icons-material/WarningAmber';
import styles from './AppIcon.module.css';

const ICONS = {
  arrowDown: ArrowDownward, arrowUp: ArrowUpward, info: AssignmentOutlined,
  chat: ChatBubbleOutline, check: Check, agree: CheckCircleOutline,
  previousPage: ChevronLeft, nextPage: ChevronRight, circle: Circle,
  close: Close, copy: ContentCopy, trophy: EmojiEventsOutlined,
  seven: Filter7, flag: FlagOutlined, burst: Flare, target: GpsFixed, disagree: HighlightOff,
  lock: LockOutlined, logout: Logout, menu: Menu, microphone: MicNone,
  music: MusicNote, pause: Pause, play: PlayArrow, repeat: Repeat,
  repeatOne: RepeatOne, shuffle: Shuffle, next: SkipNext, previous: SkipPrevious,
  beer: SportsBar, timer: TimerOutlined, sort: UnfoldMore, warning: WarningAmber,
  emoji: SentimentSatisfiedOutlined,
} as const;

export type AppIconName = keyof typeof ICONS;

/** Decorative icons inherit text sizing/color; the surrounding control supplies its label. */
export function AppIcon({ name, className }: {
  readonly name: AppIconName; readonly className?: string;
}): ReactNode {
  const Icon = ICONS[name];
  return <Icon className={`${styles.icon} ${className ?? ''}`} fontSize="inherit"
    aria-hidden="true" focusable="false" />;
}
