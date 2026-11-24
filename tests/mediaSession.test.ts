// The lock screen is only reachable through the browser's Media Session API, so these tests put
// a stand-in in its place and press the buttons the way a headphone or a car stereo would.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerListeningCommands, setListeningPiece, type ListeningCommands } from '../src/lib/mediaSession.ts';

interface PressedButton {
  action: MediaSessionAction;
  handler: (() => void) | null;
}

interface FakeSession {
  metadata: FakeMediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
}

class FakeMediaMetadata {
  title = '';
  artist = '';
  album = '';
  artwork: unknown[] = [];
  constructor(init: MediaMetadataInit = {}) {
    Object.assign(this, init);
  }
}

// Runs `body` with a fake media session installed, then puts the globals back as they were
function withMediaSession(body: (pressed: PressedButton[], session: FakeSession) => void, refuse: MediaSessionAction[] = []) {
  const pressed: PressedButton[] = [];
  const session: FakeSession = { metadata: null, playbackState: 'none' };
  const withHandlers = session as unknown as MediaSession;
  withHandlers.setActionHandler = (action, handler) => {
    if (refuse.includes(action)) throw new Error(`${action} is not a shape this browser offers`);
    pressed.push({ action, handler: handler ? () => handler({ action }) : null });
  };

  const hadNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const hadMetadata = Object.getOwnPropertyDescriptor(globalThis, 'MediaMetadata');
  Object.defineProperty(globalThis, 'navigator', { value: { mediaSession: withHandlers }, configurable: true });
  Object.defineProperty(globalThis, 'MediaMetadata', { value: FakeMediaMetadata, configurable: true });
  try {
    body(pressed, session);
  } finally {
    if (hadNavigator) Object.defineProperty(globalThis, 'navigator', hadNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
    if (hadMetadata) Object.defineProperty(globalThis, 'MediaMetadata', hadMetadata);
    else delete (globalThis as { MediaMetadata?: unknown }).MediaMetadata;
  }
}

const silentCommands = (heard: string[]): ListeningCommands => ({
  play: () => heard.push('play'),
  pause: () => heard.push('pause'),
  stop: () => heard.push('stop'),
  nextPiece: () => heard.push('nextPiece'),
  previousPiece: () => heard.push('previousPiece'),
  nextSentence: () => heard.push('nextSentence'),
  previousSentence: () => heard.push('previousSentence'),
});

test('each lock-screen button presses its own command', () => {
  withMediaSession(pressed => {
    const heard: string[] = [];
    registerListeningCommands(() => silentCommands(heard));
    const buttons = new Map(pressed.map(button => [button.action, button.handler]));

    const expected: [MediaSessionAction, string][] = [
      ['play', 'play'],
      ['pause', 'pause'],
      ['stop', 'stop'],
      ['nexttrack', 'nextPiece'],
      ['previoustrack', 'previousPiece'],
      ['seekforward', 'nextSentence'],
      ['seekbackward', 'previousSentence'],
    ];
    for (const [action, command] of expected) {
      const handler = buttons.get(action);
      assert.ok(handler, `${action} has no handler, so that button would do nothing`);
      heard.length = 0;
      handler();
      assert.deepEqual(heard, [command], `${action} should ${command}`);
    }
  });
});

test('a button the browser refuses does not take the others with it', () => {
  withMediaSession(pressed => {
    registerListeningCommands(() => silentCommands([]));
    const actions = pressed.map(button => button.action);
    assert.ok(!actions.includes('seekforward'), 'the refused action is not registered');
    assert.equal(actions.length, 6, 'every other button is still live');
  }, ['seekforward']);
});

test('unregistering leaves no button behind', () => {
  withMediaSession(pressed => {
    registerListeningCommands(null);
    assert.equal(pressed.length, 7);
    assert.ok(pressed.every(button => button.handler === null), 'each handler is cleared');
  });
});

test('the lock screen names the piece and its source', () => {
  withMediaSession((_pressed, session) => {
    setListeningPiece({ title: 'Gambling for Goals', source: 'Marginal Revolution' }, 'playing');
    assert.equal(session.metadata?.title, 'Gambling for Goals');
    assert.equal(session.metadata?.artist, 'Marginal Revolution');
    assert.equal(session.playbackState, 'playing');

    setListeningPiece({ title: 'Gambling for Goals', source: 'Marginal Revolution' }, 'paused');
    assert.equal(session.playbackState, 'paused');

    // A stopped queue goes quiet rather than leaving the last title on the phone
    setListeningPiece(null, 'none');
    assert.equal(session.metadata, null);
    assert.equal(session.playbackState, 'none');
  });
});

test('a browser with no media session is left alone', () => {
  const hadNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  try {
    assert.doesNotThrow(() => registerListeningCommands(() => silentCommands([])));
    assert.doesNotThrow(() => registerListeningCommands(null));
    assert.doesNotThrow(() => setListeningPiece({ title: 'Anything', source: 'Anywhere' }, 'playing'));
  } finally {
    if (hadNavigator) Object.defineProperty(globalThis, 'navigator', hadNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});
