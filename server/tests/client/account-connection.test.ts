import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerSnapshot } from '@shared/types';
import { startAccountConnection } from '../../../client/src/hooks/account-connection-controller';
import type {
  AccountConnectionOptions,
  ConnectionSocket,
  ConnectionState,
} from '../../../client/src/hooks/account-connection-controller';

type ResumeCallback = (error: Error | null, snapshot?: PlayerSnapshot) => void;

interface FakeSocket {
  connected: boolean;
  handlers: Map<string, Set<(...args: unknown[]) => void>>;
  resumes: ResumeCallback[];
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
}

function fakeSocket(connected = false): FakeSocket {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const socket: FakeSocket = {
    connected,
    handlers,
    resumes: [],
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit(event: string, ...args: unknown[]): void {
      for (const handler of [...(handlers.get(event) ?? [])]) handler(...args);
    },
  };
  return socket;
}

function asConnectionSocket(socket: FakeSocket): ConnectionSocket {
  return {
    get connected(): boolean { return socket.connected; },
    on(event: string, handler: (...args: unknown[]) => void) {
      const set = socket.handlers.get(event) ?? new Set();
      set.add(handler);
      socket.handlers.set(event, set);
      return this;
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      socket.handlers.get(event)?.delete(handler);
      return this;
    },
    timeout: () => ({
      emit: (_event: string, callback: ResumeCallback): void => { socket.resumes.push(callback); },
    }),
    connect: socket.connect,
    disconnect: socket.disconnect,
  } as unknown as ConnectionSocket;
}

class FakePage extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  show(visibility: DocumentVisibilityState): void {
    this.visibilityState = visibility;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

const READY: PlayerSnapshot = { success: true };

function setup(connected = false, overrides: Partial<AccountConnectionOptions> = {}): {
  socket: FakeSocket;
  network: EventTarget;
  page: FakePage;
  states: ConnectionState[];
  applySnapshot: ReturnType<typeof vi.fn>;
  restoreAccount: ReturnType<typeof vi.fn>;
  clock: { value: number };
  stop: () => void;
} {
  const socket = fakeSocket(connected);
  const network = new EventTarget();
  const page = new FakePage();
  const states: ConnectionState[] = [];
  const applySnapshot = vi.fn();
  const restoreAccount = vi.fn();
  const clock = { value: 0 };
  const stop = startAccountConnection({
    socket: asConnectionSocket(socket),
    network,
    page,
    setConnection: (state) => { states.push(state); },
    applySnapshot,
    restoreAccount,
    now: () => clock.value,
    staleAfterMs: 1000,
    ...overrides,
  });
  return { socket, network, page, states, applySnapshot, restoreAccount, clock, stop };
}

function connect(socket: FakeSocket): void {
  socket.connected = true;
  socket.emit('connect');
}

function drop(socket: FakeSocket, reason = 'transport close'): void {
  socket.connected = false;
  socket.emit('disconnect', reason);
}

let active: (() => void) | null = null;

afterEach(() => {
  active?.();
  active = null;
});

describe('account connection controller', () => {
  it('should connect, resume, and apply the snapshot', () => {
    const run = setup();
    active = run.stop;
    expect(run.socket.connect).toHaveBeenCalledOnce();
    connect(run.socket);
    expect(run.states).toEqual(['connecting']);
    run.socket.resumes[0](null, READY);
    expect(run.applySnapshot).toHaveBeenCalledExactlyOnceWith(READY);
  });

  it('should resume immediately when the socket is already connected', () => {
    const run = setup(true);
    active = run.stop;
    expect(run.socket.connect).not.toHaveBeenCalled();
    expect(run.socket.resumes).toHaveLength(1);
  });

  it('should stay connecting when the socket drops during resume', () => {
    const run = setup();
    active = run.stop;
    connect(run.socket);
    const pending = run.socket.resumes[0];
    run.socket.connected = false;
    pending(new Error('socket has been disconnected'));
    expect(run.states).toEqual(['connecting']);
    drop(run.socket);
    expect(run.states).toEqual(['connecting', 'connecting']);
  });

  it('should ignore a stale resume acknowledgment after reconnecting', () => {
    const run = setup();
    active = run.stop;
    connect(run.socket);
    const stale = run.socket.resumes[0];
    drop(run.socket);
    connect(run.socket);
    stale(new Error('operation has timed out'));
    stale(null, READY);
    expect(run.states).toEqual(['connecting', 'connecting', 'connecting']);
    expect(run.applySnapshot).not.toHaveBeenCalled();
    run.socket.resumes[1](null, READY);
    expect(run.applySnapshot).toHaveBeenCalledOnce();
  });

  it('should report errors for unanswered or rejected resumes on a live socket', () => {
    const run = setup();
    active = run.stop;
    connect(run.socket);
    run.socket.resumes[0](new Error('operation has timed out'));
    expect(run.states.at(-1)).toBe('error');
    drop(run.socket);
    connect(run.socket);
    run.socket.resumes[1](null, { success: false, error: 'Not authenticated' });
    expect(run.states.at(-1)).toBe('error');
    expect(run.applySnapshot).not.toHaveBeenCalled();
  });

  it('should report server disconnects and connection errors and recheck the account', () => {
    const run = setup();
    active = run.stop;
    connect(run.socket);
    drop(run.socket, 'io server disconnect');
    expect(run.states.at(-1)).toBe('error');
    run.socket.emit('connect_error', new Error('xhr poll error'));
    expect(run.states.at(-1)).toBe('error');
    expect(run.restoreAccount).toHaveBeenCalledTimes(2);
  });

  it('should reconnect immediately when the network returns or the page becomes visible', () => {
    const run = setup();
    active = run.stop;
    run.socket.connect.mockClear();
    run.network.dispatchEvent(new Event('online'));
    expect(run.socket.disconnect).toHaveBeenCalledOnce();
    expect(run.socket.connect).toHaveBeenCalledOnce();
    run.page.show('hidden');
    expect(run.socket.connect).toHaveBeenCalledOnce();
    run.page.show('visible');
    expect(run.socket.connect).toHaveBeenCalledTimes(2);
    connect(run.socket);
    run.network.dispatchEvent(new Event('online'));
    expect(run.socket.connect).toHaveBeenCalledTimes(2);
  });

  it('should verify a long-hidden connected page and reconnect when the check is unanswered', () => {
    const run = setup();
    active = run.stop;
    connect(run.socket);
    run.socket.resumes[0](null, READY);
    run.page.show('hidden');
    run.clock.value = 500;
    run.page.show('visible');
    expect(run.socket.resumes).toHaveLength(1);
    run.page.show('hidden');
    run.clock.value = 2000;
    run.page.show('visible');
    expect(run.socket.resumes).toHaveLength(2);
    expect(run.states).toEqual(['connecting']);
    run.page.show('hidden');
    run.clock.value = 4000;
    run.page.show('visible');
    expect(run.socket.resumes).toHaveLength(2);
    run.socket.connect.mockClear();
    run.socket.resumes[1](new Error('operation has timed out'));
    expect(run.socket.disconnect).toHaveBeenCalledOnce();
    expect(run.socket.connect).toHaveBeenCalledOnce();
    expect(run.states).toEqual(['connecting']);
  });

  it('should apply a successful verification without leaving the ready state', () => {
    const run = setup();
    active = run.stop;
    connect(run.socket);
    run.socket.resumes[0](null, READY);
    run.page.show('hidden');
    run.clock.value = 5000;
    run.page.show('visible');
    run.socket.resumes[1](null, READY);
    expect(run.applySnapshot).toHaveBeenCalledTimes(2);
    expect(run.states).toEqual(['connecting']);
  });

  it('should detach every listener, ignore late acknowledgments, and disconnect when stopped', () => {
    const run = setup();
    connect(run.socket);
    run.stop();
    expect(run.socket.disconnect).toHaveBeenCalledOnce();
    expect([...run.socket.handlers.values()].every((set) => set.size === 0)).toBe(true);
    run.socket.resumes[0](null, READY);
    run.network.dispatchEvent(new Event('online'));
    run.page.show('visible');
    expect(run.applySnapshot).not.toHaveBeenCalled();
    expect(run.socket.disconnect).toHaveBeenCalledOnce();
  });
});
