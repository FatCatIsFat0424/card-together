import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MouseEvent } from 'react';
import { closeMessagesWindow, useMessagesWindowStore } from '../../../client/src/stores/messages-window-store';

function click(overrides: Partial<MouseEvent<HTMLAnchorElement>> = {}): MouseEvent<HTMLAnchorElement> {
  return { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(),
    ...overrides } as unknown as MouseEvent<HTMLAnchorElement>;
}

describe('messages window close', () => {
  afterEach(() => useMessagesWindowStore.getState().reset());

  it('holds a plain click until the window has animated out', () => {
    const event = click();
    closeMessagesWindow(event, '/shop?type=cardFace');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(useMessagesWindowStore.getState().closingTo).toBe('/shop?type=cardFace');
  });

  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    'keeps normal link behaviour for %o', (modifier) => {
      const event = click(modifier);
      closeMessagesWindow(event, '/');
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(useMessagesWindowStore.getState().closingTo).toBeNull();
    });
});
