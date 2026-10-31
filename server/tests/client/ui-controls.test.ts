import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Button, buttonClassName } from '../../../client/src/components/Button';
import { Chip } from '../../../client/src/components/Chip';
import { IconButton, IconLink, badgeText } from '../../../client/src/components/IconButton';
import { ActionButton } from '../../../client/src/components/ActionButton';
import { Tabs, nextTabIndex, tabElementId } from '../../../client/src/components/Tabs';

describe('Button', () => {
  it('should default to a non-submitting ghost button', () => {
    const html = renderToStaticMarkup(createElement(Button, null, 'Cancel'));
    expect(html).toContain('type="button"');
    expect(html).toContain('ghost');
    expect(html).toContain('regular');
  });

  it('should map each variant and size to its own classes', () => {
    for (const variant of ['primary', 'success', 'ghost', 'text', 'danger-text'] as const) {
      const html = renderToStaticMarkup(createElement(Button, { variant, size: 'small' }, 'Go'));
      expect(html).toContain('small');
      expect(html).toContain(variant === 'danger-text' ? 'dangerText' : variant);
    }
  });

  it('should keep disabled state and a caller-provided submit type', () => {
    const html = renderToStaticMarkup(createElement(Button, { type: 'submit', disabled: true, variant: 'primary' }, 'Create'));
    expect(html).toContain('type="submit"');
    expect(html).toContain('disabled=""');
  });

  it('should expose its look for router links', () => {
    expect(buttonClassName('primary', 'small', 'extra')).toMatch(/primary.*extra|extra.*primary/);
  });
});

describe('IconButton', () => {
  it('should name the button and hide the decorative glyph', () => {
    const html = renderToStaticMarkup(createElement(IconButton, { icon: 'chat', label: 'Messages' }));
    expect(html).toContain('aria-label="Messages"');
    expect(html).toContain('title="Messages"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('should show a capped count only above zero and a dot on request', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe('7');
    expect(badgeText(250)).toBe('99+');
    expect(badgeText('dot')).toBeNull();
    const count = renderToStaticMarkup(createElement(IconButton, { icon: 'chat', label: 'Messages, 3 unread', badge: 3 }));
    expect(count).toMatch(/aria-hidden="true">3</);
    const dot = renderToStaticMarkup(createElement(IconButton, { icon: 'friends', label: 'Friends', badge: 'dot' }));
    expect(dot).toMatch(/<span class="[^"]*dot[^"]*" aria-hidden="true">/);
    expect(renderToStaticMarkup(createElement(IconButton, { icon: 'chat', label: 'Messages', badge: 0 }))).not.toContain('count');
  });

  it('should pass through expanded state for popover triggers', () => {
    const html = renderToStaticMarkup(createElement(IconButton, { icon: 'menu', label: 'Menu', 'aria-expanded': true }));
    expect(html).toContain('aria-expanded="true"');
  });

  it('prioritizes a distinct capped mention count on compact chat controls', () => {
    const icon = renderToStaticMarkup(createElement(IconButton, {
      icon: 'chat', label: 'Chat, 150 mentions', badge: 200, mentionCount: 150,
    }));
    const action = renderToStaticMarkup(createElement(ActionButton, {
      icon: 'chat', text: 'Chat', label: 'Chat, 2 mentions', badge: 8, mentionCount: 2,
    }));
    expect(icon).toMatch(/aria-hidden="true">@99\+</);
    expect(action).toMatch(/aria-hidden="true">@2</);
    expect(icon).not.toContain('mentionCount=');
    expect(action).not.toContain('mentionCount=');
    const ordinary = renderToStaticMarkup(createElement(IconButton, {
      icon: 'chat', label: 'Chat, 8 unread', badge: 8, mentionCount: 0,
    }));
    expect(ordinary).toMatch(/aria-hidden="true">8</);
  });

  it('should render navigation as a labelled link with aria-current on the current page', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(IconLink, { to: '/shop', icon: 'shop', label: 'Shop', current: true })));
    expect(html).toContain('href="/shop"');
    expect(html).toContain('aria-label="Shop"');
    expect(html).toContain('aria-current="page"');
    const other = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(IconLink, { to: '/shop', icon: 'shop', label: 'Shop' })));
    expect(other).not.toContain('aria-current');
  });
});

describe('Tabs', () => {
  const tabs = [{ id: 'cards', label: 'Cards' }, { id: 'dice', label: 'Dice' }, { id: 'board', label: 'Board' }] as const;
  const render = (value: 'cards' | 'dice' | 'board'): string => renderToStaticMarkup(createElement(Tabs<'cards' | 'dice' | 'board'>, {
    tabs, value, onChange: () => undefined, label: 'Categories', idPrefix: 'lobby', controls: 'lobby-panel',
  }));

  it('should expose a labelled tab list with one selected tab in the Tab order', () => {
    const html = render('dice');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Categories"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(html.match(/aria-controls="lobby-panel"/g)).toHaveLength(3);
    expect(html).toContain(`id="${tabElementId('lobby', 'dice')}"`);
    expect(html).toMatch(/<button[^>]*id="lobby-tab-dice"[^>]*aria-selected="true"[^>]*tabindex="0"/);
  });

  it('should move with arrow keys, wrap around, and jump with Home and End', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextTabIndex('ArrowLeft', 2, 3)).toBe(1);
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
    expect(nextTabIndex('Enter', 0, 3)).toBeNull();
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('Chip', () => {
  it('should expose the filter state as a toggle button', () => {
    const on = renderToStaticMarkup(createElement(Chip, { selected: true, count: 15 }, 'Card backs'));
    const off = renderToStaticMarkup(createElement(Chip, { selected: false }, 'Card faces'));
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('type="button"');
    expect(on).toContain('>15<');
    expect(off).toContain('aria-pressed="false"');
    expect(off).not.toMatch(/>\d+</);
  });
});
