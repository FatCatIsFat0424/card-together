/** Server-authoritative prices for permanent avatar borders. */
export const AVATAR_BORDERS = [
  { id: 'cat', price: 150, category: 'ears' },
  { id: 'rabbit', price: 150, category: 'ears' },
  { id: 'frog', price: 160, category: 'ears' },
  { id: 'bear', price: 150, category: 'ears' },
  { id: 'dog', price: 150, category: 'ears' },
  { id: 'antlers', price: 220, category: 'ears' },
  { id: 'cthulhu', price: 280, category: 'special' },
  { id: 'copper', price: 50, category: 'metal' },
  { id: 'silver', price: 100, category: 'metal' },
  { id: 'gold', price: 300, category: 'metal' },
  { id: 'starlight', price: 200, category: 'special' },
  { id: 'rainbow', price: 250, category: 'special' },
  { id: 'neon', price: 180, category: 'special' },
] as const;

export type AvatarBorderId = typeof AVATAR_BORDERS[number]['id'];

export function isAvatarBorderId(value: unknown): value is AvatarBorderId {
  return AVATAR_BORDERS.some((item) => item.id === value);
}
