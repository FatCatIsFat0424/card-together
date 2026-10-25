import { describe, expect, it } from 'vitest';
import { applyReplayPatch, diffReplaySnapshot } from '@shared/replay-patch';

describe('replay snapshot patches', () => {
  it('reproduces the next snapshot with appended logs, replaced arrays, and removed members', () => {
    const before = { phase: 'play', log: [{ type: 'deal' }], hands: { N: [1, 2], E: [3] }, presentation: { id: 'a' } };
    const after = { phase: 'play', log: [{ type: 'deal' }, { type: 'play', card: 2 }], hands: { N: [1], E: [3] } };
    const ops = diffReplaySnapshot(before, after);
    expect(ops).toEqual([
      { op: 'delete', path: ['presentation'] },
      { op: 'append', path: ['log'], values: [{ type: 'play', card: 2 }] },
      { op: 'set', path: ['hands', 'N'], value: [1] },
    ]);
    expect(applyReplayPatch(before, ops)).toEqual(after);
  });

  it('treats undefined members as absent and leaves inputs untouched', () => {
    const before = { a: 1, b: undefined, nested: { keep: [1] } };
    const after = { a: 1, c: { d: true } };
    const frozen = structuredClone(before);
    const next = applyReplayPatch(before, diffReplaySnapshot(before, after));
    expect(next).toEqual(after);
    expect(before).toEqual(frozen);
    expect(diffReplaySnapshot({ a: 1, b: undefined }, { a: 1 })).toEqual([]);
  });

  it('shares unchanged branches with the previous snapshot', () => {
    const before = { left: { cards: [1] }, right: { cards: [2] } };
    const next = applyReplayPatch(before, diffReplaySnapshot(before, { left: { cards: [1] }, right: { cards: [3] } }));
    expect(next.left).toBe(before.left);
  });

  it('rejects patches that would reach a prototype or target a missing parent', () => {
    expect(() => applyReplayPatch({}, [{ op: 'set', path: ['__proto__', 'polluted'], value: true }])).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(() => applyReplayPatch({}, [{ op: 'set', path: ['missing', 'child'], value: 1 }])).toThrow();
    expect(() => applyReplayPatch({ log: 1 }, [{ op: 'append', path: ['log'], values: [2] }])).toThrow();
    expect(() => applyReplayPatch({}, [{ op: 'delete', path: [] }])).toThrow();
  });
});
