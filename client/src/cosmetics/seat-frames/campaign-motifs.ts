import type { SeatFrameMotif } from './seat-frame-designs';

export const CAMPAIGN_SEAT_MOTIFS = {
  starfleet: {
    main: [
      { d: 'M3 3L10 5L20 17L13 14L14 21L5 10Z', kind: 'fill1' },
      { d: 'M4 4L9 5L8 9Z', kind: 'fill2' },
      { d: 'M13 16L18 22M16 13L22 18', kind: 'line2' },
      { d: 'M3 16V21H8M16 3H21V8', kind: 'line1' },
      { d: 'M6 17H9M17 6V9', kind: 'line2' },
    ],
    alt: [
      { d: 'M4 9L9 4H19L22 7V17L17 22H7L4 19Z', kind: 'line1' },
      { d: 'M7 10L10 7H18M7 18L10 21H17', kind: 'line2' },
      { d: 'M13 8L18 15H8Z', kind: 'fill3' },
      { d: 'M10 18H16', kind: 'line2' },
    ],
  },
  shrine: {
    main: [
      { d: 'M2 4Q12 8 22 4L21 8H3Z', kind: 'fill1' },
      { d: 'M4 11H20V14H4Z M6 8H9V23H6Z M16 8H19V23H16Z', kind: 'fill1' },
      { d: 'M12 8V12', kind: 'line2' },
      { d: 'M10 14H14V19H10Z', kind: 'fill3' },
      { d: 'M12 20V23', kind: 'line2' },
    ],
    alt: [
      { d: 'M12 21C2 19 4 12 8 9Q8 13 11 12Q8 6 14 2Q13 8 18 11Q23 18 12 21Z', kind: 'fill2' },
      { d: 'M12 20Q6 17 12 12Q18 17 12 20Z', kind: 'fill3' },
      { d: 'M3 7L5 4M19 5L21 8', kind: 'line1' },
      { d: 'M3 21H7M19 21H23', kind: 'line2' },
    ],
  },
  ironfront: {
    main: [
      { d: 'M2 7L7 2H22V8H9V22H2Z', kind: 'fill2' },
      { d: 'M3 7L7 3H20M3 20V10', kind: 'line1' },
      { d: 'M11 14H22V20H11Z M13 11H19V14H13Z', kind: 'fill1' },
      { d: 'M18 12H24M12 18H21', kind: 'line2' },
      { d: 'M5 5H6V6H5Z M4 17H6V19H4Z M17 4H19V6H17Z', kind: 'fill3' },
    ],
    alt: [
      { d: 'M12 2A10 10 0 1 1 2 12', kind: 'line1' },
      { d: 'M12 6A6 6 0 1 1 6 12M12 3V21M3 12H21', kind: 'line2' },
      { d: 'M12 12L20 5L20 10Z', kind: 'fill3' },
      { d: 'M8 15H10V17H8Z M15 17H17V19H15Z', kind: 'fill1' },
    ],
  },
  neoncity: {
    main: [
      { d: 'M2 19V8L8 2H21M6 20V10L10 6H20', kind: 'line1' },
      { d: 'M10 12H17V19H10Z', kind: 'fill2' },
      { d: 'M13 14H15V17H13Z', kind: 'fill3' },
      { d: 'M13 9V6M18 14H23M8 16H5M14 20V23', kind: 'line2' },
      { d: 'M20 3H23V6H20Z M2 21H5V24H2Z', kind: 'fill3' },
    ],
  },
  crownrealm: {
    main: [
      { d: 'M5 8H21L20 17Q17 22 13 24Q9 22 6 17Z', kind: 'fill2' },
      { d: 'M5 8H21L20 17Q17 22 13 24Q9 22 6 17Z', kind: 'line1' },
      { d: 'M6 7L4 1L9 4L13 0L17 4L22 1L20 7Z', kind: 'fill3' },
      { d: 'M10 12L11 10L14 11L16 10L18 13L16 15L17 18L13 21L10 18L11 15Z', kind: 'fill1' },
      { d: 'M12 14H15M13 17H15', kind: 'line2' },
    ],
    alt: [
      { d: 'M3 3H10V22L6.5 18L3 22Z M14 3H21V22L17.5 18L14 22Z', kind: 'fill2' },
      { d: 'M2 2H22', kind: 'line1' },
      { d: 'M6 5V15M17 5V15', kind: 'line2' },
      { d: 'M10 7L12 3L14 7L12 11Z', kind: 'fill3' },
    ],
  },
} as const satisfies Record<string, SeatFrameMotif>;
