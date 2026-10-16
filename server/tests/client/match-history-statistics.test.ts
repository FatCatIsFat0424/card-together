import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import { MatchHistoryStatistics } from '../../../client/src/components/MatchHistoryStatistics';

describe('match history statistics', () => {
  it('sizes the win-rate chart to one table row per game and colours every game', () => {
    const html = renderToStaticMarkup(createElement(MatchHistoryStatistics, { matches: [] }));
    // The bars line up with the table: a 32px axis over the head, then one 52px band per game row.
    expect(html).toContain('--axis-height:32px;--row-height:52px');
    expect(html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g)).toHaveLength(GAME_TYPES.length);
    expect(html).toMatch(new RegExp(`height="${32 + GAME_TYPES.length * 52}"|height:${32 + GAME_TYPES.length * 52}px`));
    expect(html).not.toContain('background:undefined');
  });
});
