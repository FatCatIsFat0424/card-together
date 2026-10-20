import { layeredChip } from './chip-designs';
import type { ChipDesign } from './chip-designs';

export const CAMPAIGN_CHIPS = {
  'chips-starfleet': layeredChip({
    palette: { rim: '#174783', spot: '#f7cf70', ring: '#65dff5', face: '#0c2546', main: '#78e6ff', detail: '#f7cf70' },
    spots: { shape: 'bar', count: 10, size: 8 },
    layers: [
      { motion: 'warp', draw: ({ main }) => <circle cx="32" cy="32" r="17" fill="none" stroke={main} strokeDasharray="18 9 3 9" strokeWidth="1.3" /> },
      { draw: ({ main }) => <>
        <path d="M32 16L37 29L47 40L36 36L34 43H30L28 36L17 40L27 29Z" fill={main} stroke="#28558e" strokeWidth="1.2" />
        <path d="M32 23L34 30H30Z" fill="#174783" />
      </> },
      { motion: 'engine', draw: ({ detail }) => <path d="M29 42V48M35 42V48" stroke={detail} strokeWidth="2" /> },
    ],
  }),
  'chips-shrine': layeredChip({
    palette: { rim: '#236d64', spot: '#f7ce77', ring: '#49baa6', face: '#142f36', main: '#ed7450', detail: '#f7ce77' },
    spots: { shape: 'dot', count: 12, size: 2 },
    layers: [
      { draw: ({ main, detail }) => <>
        <path d="M15 19Q32 24 49 19L47 24H17Z M18 28H46V31H18Z M22 24H26V46H21Z M38 24H42L43 46H38Z" fill={main} />
        <path d="M32 24V29" stroke={detail} />
        <rect x="29" y="29" width="6" height="8" rx="2" fill={detail} />
      </> },
      { motion: 'foxfire', draw: () => <path d="M17 45Q10 42 17 34Q16 38 20 37Q25 44 17 45Z M46 45Q39 42 46 34Q45 38 49 37Q54 44 46 45Z" fill="#68dfca" /> },
    ],
  }),
  'chips-ironfront': layeredChip({
    palette: { rim: '#4d5e3c', spot: '#d6bc69', ring: '#98aa72', face: '#253626', main: '#a6b77d', detail: '#e8c16b' },
    spots: { shape: 'dot', count: 16, size: 1.5 },
    layers: [
      { draw: ({ main, detail }) => <>
        <path d="M16 35L22 29H40L47 36V43H16Z M25 29V23H36L39 29Z" fill={main} />
        <path d="M35 25H49" stroke={detail} strokeWidth="3" />
        <rect x="15" y="38" width="34" height="8" rx="4" fill="#142519" stroke={detail} />
        {[21, 28, 35, 42].map((x) => <circle key={x} cx={x} cy="42" r="2.2" fill={main} />)}
      </> },
      { motion: 'propeller', draw: ({ main, detail }) => <>
        <path d="M32 14Q29 18 32 22Q35 18 32 14M24 22Q28 25 32 22Q28 19 24 22M32 22Q36 25 40 22Q36 19 32 22" fill={detail} />
        <circle cx="32" cy="22" r="1.7" fill={main} />
      </> },
    ],
  }),
  'chips-neoncity': layeredChip({
    palette: { rim: '#503067', spot: '#36d5e4', ring: '#f06bdc', face: '#141e39', main: '#ef68dd', detail: '#78f7f5' },
    spots: { shape: 'bar', count: 8, size: 10 },
    layers: [
      { draw: ({ main, detail }) => <>
        <path d="M16 19H24L28 23M47 17V25L42 29M17 47V37L23 32M47 43H40L36 39" fill="none" stroke={detail} strokeWidth="1.6" />
        <path d="M25 22H39L43 26V39L39 43H25L21 39V26Z" fill="#352653" stroke={main} strokeWidth="1.8" />
      </> },
      { motion: 'processor', draw: ({ detail }) => <path d="M27 27H37V37H27Z" fill={detail} /> },
      { draw: ({ main }) => <>
        <path d="M30 29H34V35H30Z" fill="#141e39" />
        <g fill={main}><circle cx="16" cy="19" r="2" /><circle cx="47" cy="43" r="2" /></g>
      </> },
    ],
  }),
  'chips-crownrealm': layeredChip({
    palette: { rim: '#b28a39', spot: '#204d8d', ring: '#f6d87c', face: '#102c58', main: '#f1cd73', detail: '#a98232' },
    spots: { shape: 'bar', count: 12, size: 7 },
    layers: [
      { draw: ({ main }) => <path d="M18 24H46L43 40Q39 46 32 50Q25 46 21 40Z" fill="#24519a" stroke={main} strokeWidth="1.5" /> },
      { motion: 'crown', draw: ({ main, detail }) => <path d="M22 23L19 14L26 18L32 11L38 18L45 14L42 23Z" fill={main} stroke={detail} /> },
      { draw: ({ main }) => <>
        <path d="M26 29L28 26L32 28L36 26L40 31L37 35L39 39L33 45L26 40L28 35L24 33Z" fill={main} />
        <path d="M29 31H31M34 31H36M31 35L33 37L35 35M33 37V40" stroke="#204d8d" fill="none" strokeWidth="1.3" />
      </> },
    ],
  }),
} as const satisfies Record<string, ChipDesign>;
