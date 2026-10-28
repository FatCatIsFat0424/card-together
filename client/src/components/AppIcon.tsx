import type { ReactNode } from 'react';
import Add from '@mui/icons-material/Add';
import Android from '@mui/icons-material/Android';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import ChatBubbleOutline from '@mui/icons-material/ChatBubbleOutlined';
import CallEnd from '@mui/icons-material/CallEnd';
import Check from '@mui/icons-material/Check';
import Headset from '@mui/icons-material/Headset';
import HeadsetOff from '@mui/icons-material/HeadsetOff';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import HowToRegOutlined from '@mui/icons-material/HowToRegOutlined';
import MeetingRoomOutlined from '@mui/icons-material/MeetingRoomOutlined';
import Search from '@mui/icons-material/Search';
import ArrowBack from '@mui/icons-material/ArrowBack';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import PeopleOutline from '@mui/icons-material/PeopleOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutlined';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import Circle from '@mui/icons-material/Circle';
import Close from '@mui/icons-material/Close';
import ContentCopy from '@mui/icons-material/ContentCopy';
import DragIndicator from '@mui/icons-material/DragIndicator';
import MonetizationOnOutlined from '@mui/icons-material/MonetizationOnOutlined';
import EmojiEventsOutlined from '@mui/icons-material/EmojiEventsOutlined';
import Filter7 from '@mui/icons-material/Filter7';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import Flare from '@mui/icons-material/Flare';
import GpsFixed from '@mui/icons-material/GpsFixed';
import HighlightOff from '@mui/icons-material/HighlightOff';
import LockOutlined from '@mui/icons-material/LockOutlined';
import Logout from '@mui/icons-material/Logout';
import Menu from '@mui/icons-material/Menu';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import MicNone from '@mui/icons-material/MicNone';
import MicOff from '@mui/icons-material/MicOff';
import MoreHoriz from '@mui/icons-material/MoreHoriz';
import MusicNote from '@mui/icons-material/MusicNote';
import NotificationsNone from '@mui/icons-material/NotificationsNone';
import Pause from '@mui/icons-material/Pause';
import PersonAddOutlined from '@mui/icons-material/PersonAddOutlined';
import PersonOutline from '@mui/icons-material/PersonOutlineOutlined';
import PlayArrow from '@mui/icons-material/PlayArrow';
import Repeat from '@mui/icons-material/Repeat';
import RepeatOne from '@mui/icons-material/RepeatOne';
import Refresh from '@mui/icons-material/Refresh';
import SentimentSatisfiedOutlined from '@mui/icons-material/SentimentSatisfiedOutlined';
import Shuffle from '@mui/icons-material/Shuffle';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import SkipNext from '@mui/icons-material/SkipNext';
import SkipPrevious from '@mui/icons-material/SkipPrevious';
import SmartToyOutlined from '@mui/icons-material/SmartToyOutlined';
import SportsBar from '@mui/icons-material/SportsBar';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import StyleOutlined from '@mui/icons-material/StyleOutlined';
import SwapHoriz from '@mui/icons-material/SwapHoriz';
import TimerOutlined from '@mui/icons-material/TimerOutlined';
import Tune from '@mui/icons-material/Tune';
import UnfoldMore from '@mui/icons-material/UnfoldMore';
import VolumeOff from '@mui/icons-material/VolumeOff';
import VolumeUp from '@mui/icons-material/VolumeUp';
import WarningAmber from '@mui/icons-material/WarningAmber';
import { createSvgIcon } from '@mui/material/utils';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import FileUploadOutlined from '@mui/icons-material/FileUploadOutlined';
import GridViewOutlined from '@mui/icons-material/GridViewOutlined';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import Undo from '@mui/icons-material/Undo';
import styles from './AppIcon.module.css';

/** A person sending a paper plane: inviting someone into a room, unlike the person-plus of adding a friend. */
const InviteToRoom = createSvgIcon(<g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
  <circle cx="7.5" cy="7.5" r="3.2" />
  <path d="M10.6 15.4c-.95-.28-2-.4-3.1-.4-2.8 0-6 1.5-6 3.9V20h9" />
  <path d="M13.4 14.2 22.5 10.2 19 20.6 17.1 16.4z" />
  <path d="M17.1 16.4 22.5 10.2" />
</g>, 'InviteToRoom');

const ICONS = {
  add: Add, android: Android, person: PersonOutline, personAdd: PersonAddOutlined, more: MoreHoriz, home: HomeOutlined, friends: PeopleOutline,
  calendar: CalendarMonthOutlined,
  shop: StorefrontOutlined,
  drag: DragIndicator,
  coins: MonetizationOnOutlined,
  arrowDown: ArrowDownward, arrowUp: ArrowUpward, info: AssignmentOutlined,
  chat: ChatBubbleOutline, check: Check, agree: CheckCircleOutline,
  previousPage: ChevronLeft, nextPage: ChevronRight, circle: Circle,
  close: Close, copy: ContentCopy, trophy: EmojiEventsOutlined,
  seven: Filter7, flag: FlagOutlined, burst: Flare, target: GpsFixed, disagree: HighlightOff,
  lock: LockOutlined, logout: Logout, menu: Menu, microphone: MicNone,
  music: MusicNote, pause: Pause, play: PlayArrow, repeat: Repeat,
  repeatOne: RepeatOne, shuffle: Shuffle, next: SkipNext, previous: SkipPrevious,
  refresh: Refresh, notifications: NotificationsNone,
  rules: MenuBookOutlined, settings: SettingsOutlined,
  beer: SportsBar, timer: TimerOutlined, sort: UnfoldMore, warning: WarningAmber,
  emoji: SentimentSatisfiedOutlined, robot: SmartToyOutlined, table: StyleOutlined,
  hangUp: CallEnd, headset: Headset, headsetOff: HeadsetOff, microphoneOff: MicOff,
  volume: VolumeUp, volumeOff: VolumeOff,
  invite: InviteToRoom, personCheck: HowToRegOutlined, room: MeetingRoomOutlined, search: Search, back: ArrowBack,
  cards: StyleOutlined, spectate: VisibilityOutlined,
  trash: DeleteOutlined, upload: FileUploadOutlined, grid: GridViewOutlined, expand: KeyboardArrowDown, undo: Undo,
  swap: SwapHoriz, tune: Tune,
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
