/**
 * `ChainNotifier` (docs/TESTES.md § Unidade: "Cadeia de fallback do notificador: primeiro
 * disponível vence; nenhum disponível cai para stderr sem lançar"). Every backend here is a named
 * in-memory fake (`_fakes.ts`) — no real OS, no real process, exercisable identically on any of
 * the three CI systems.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainNotifier } from '../../../../src/adapters/notification/chain.js';
import {
  AlwaysAvailableBackend,
  FailingSendBackend,
  NeverAvailableBackend,
  ThrowingAvailabilityBackend,
} from './_fakes.js';
import { StderrCapture } from './_stderr-capture.js';

const NOTICE = { title: 'seeya end-day: 2026-08-16', body: '1 session captured.' };

describe('ChainNotifier — first available wins', () => {
  it('uses the first available backend, never asking the ones after it', async () => {
    const first = new AlwaysAvailableBackend('first');
    const second = new AlwaysAvailableBackend('second');
    const chain = new ChainNotifier([first, second]);

    await chain.notify(NOTICE);

    expect(first.sent).toEqual([NOTICE]);
    expect(second.sent).toEqual([]);
  });

  it('skips an unavailable backend and uses the next available one', async () => {
    const unavailable = new NeverAvailableBackend();
    const available = new AlwaysAvailableBackend();
    const chain = new ChainNotifier([unavailable, available]);

    await chain.notify(NOTICE);

    expect(available.sent).toEqual([NOTICE]);
  });
});

describe('ChainNotifier — none available falls to stderr without throwing', () => {
  // A fresh instance per test — `StderrCapture.writes` accumulates for as long as it's installed,
  // and reusing one across tests would let an earlier test's writes leak into a later assertion.
  let capture: StderrCapture;

  beforeEach(() => {
    capture = new StderrCapture();
    capture.install();
  });

  afterEach(() => {
    capture.restore();
  });

  it('an empty backend list never throws — the built-in stderr fallback answers', async () => {
    const chain = new ChainNotifier([]);

    await expect(chain.notify(NOTICE)).resolves.toBeUndefined();
    expect(capture.writes).toHaveLength(1);
    expect(capture.writes[0]).toContain(NOTICE.title);
    expect(capture.writes[0]).toContain(NOTICE.body);
  });

  it('every backend unavailable also falls to stderr without throwing', async () => {
    const chain = new ChainNotifier([new NeverAvailableBackend(), new NeverAvailableBackend()]);

    await expect(chain.notify(NOTICE)).resolves.toBeUndefined();
    expect(capture.writes).toHaveLength(1);
  });

  it('a backend whose isAvailable() itself throws is treated as unavailable, not as a crash', async () => {
    const chain = new ChainNotifier([new ThrowingAvailabilityBackend()]);

    await expect(chain.notify(NOTICE)).resolves.toBeUndefined();
    expect(capture.writes).toHaveLength(1);
  });

  it('an available backend whose send() rejects falls through to the next, never throwing', async () => {
    const failing = new FailingSendBackend();
    const chain = new ChainNotifier([failing]);

    await expect(chain.notify(NOTICE)).resolves.toBeUndefined();
    expect(capture.writes).toHaveLength(1);
  });

  it('a failing first backend still lets a working second one win — stderr is untouched', async () => {
    const failing = new FailingSendBackend();
    const working = new AlwaysAvailableBackend();
    const chain = new ChainNotifier([failing, working]);

    await chain.notify(NOTICE);

    expect(working.sent).toEqual([NOTICE]);
    expect(capture.writes).toHaveLength(0);
  });
});
