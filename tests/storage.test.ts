import test from 'node:test';
import assert from 'node:assert/strict';

import { clearAppData, safeGetItem, safeSetItem } from '../src/storage.ts';

test('factory reset clears Curator storage and its session fallback only', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map<string, string>([
    ['curator_sources', '[]'],
    ['other_app_setting', 'keep me'],
  ]);
  const fakeStorage = {
    get length() { return entries.size; },
    key(index: number) { return Array.from(entries.keys())[index] ?? null; },
    removeItem(key: string) { entries.delete(key); },
    setItem() { throw new Error('Storage is blocked'); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage });

  try {
    safeSetItem('curator_session_only', 'temporary');
    assert.equal(safeGetItem('curator_session_only'), 'temporary');
    assert.equal(clearAppData(), true);
    assert.deepEqual([...entries.entries()], [['other_app_setting', 'keep me']]);
    assert.equal(safeGetItem('curator_session_only'), null);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    } else {
      delete (globalThis as any).localStorage;
    }
  }
});
