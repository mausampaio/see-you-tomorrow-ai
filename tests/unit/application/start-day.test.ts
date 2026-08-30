/**
 * `resumeSessions` (S3-T3, `application/start-day.ts`) — steps 4-5 of `seeya start-day`
 * (docs/ESPECIFICACAO.md § `seeya start-day`). Reuses `_fakes.ts`'s named doubles
 * (docs/TESTES.md: "duplo de I/O é classe/objeto nomeado implementando a porta").
 */
import { describe, expect, it } from 'vitest';
import { resumeSessions, type StartDayDeps } from '../../../src/application/start-day.js';
import { createHandoff } from '../core/_fixtures.js';
import {
  DEFAULT_TEST_CONFIG,
  FakeSessionResumer,
  FakeStorage,
  cleanlyResumingResumer,
  throwingResumer,
} from './_fakes.js';
import type { ResumeOutcome } from '../../../src/core/types.js';

const DAY = '2026-08-16';

function deps(overrides: Partial<StartDayDeps> = {}): StartDayDeps {
  return {
    storage: new FakeStorage(DEFAULT_TEST_CONFIG),
    sessionResumer: cleanlyResumingResumer(),
    ...overrides,
  };
}

describe('resumeSessions — the happy path', () => {
  it('resumes every handoff, in order, and reports every outcome', async () => {
    const alpha = createHandoff({ sessionId: 'alpha', name: 'alpha', cwd: 'c:\\code\\alpha' });
    const beta = createHandoff({ sessionId: 'beta', name: 'beta', cwd: 'c:\\code\\beta' });
    const resumer = cleanlyResumingResumer();
    const result = await resumeSessions(deps({ sessionResumer: resumer }), {
      day: DAY,
      handoffs: [alpha, beta],
    });

    expect(result.stoppedEarly).toBe(false);
    expect(result.remaining).toEqual([]);
    expect(result.resumed).toEqual([
      { sessionId: 'alpha', cwd: 'c:\\code\\alpha', fellBack: false },
      { sessionId: 'beta', cwd: 'c:\\code\\beta', fellBack: false },
    ]);
    expect(resumer.calls.map((call) => call.sessionId)).toEqual(['alpha', 'beta']);
  });

  it('reports progress with the right index/total, BEFORE each attempt', async () => {
    const alpha = createHandoff({ sessionId: 'alpha' });
    const beta = createHandoff({ sessionId: 'beta' });
    const events: { index: number; total: number; sessionId: string }[] = [];
    await resumeSessions(deps(), { day: DAY, handoffs: [alpha, beta] }, (event) =>
      events.push({ index: event.index, total: event.total, sessionId: event.handoff.sessionId }),
    );
    expect(events).toEqual([
      { index: 1, total: 2, sessionId: 'alpha' },
      { index: 2, total: 2, sessionId: 'beta' },
    ]);
  });

  it('marks each session resumed in storage right after it resumes — one write per session, not batched', async () => {
    const alpha = createHandoff({ sessionId: 'alpha' });
    const beta = createHandoff({ sessionId: 'beta' });
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const seenAfterFirst: ReadonlySet<string>[] = [];
    const resumer = new FakeSessionResumer(async (sessionId, cwd) => {
      seenAfterFirst.push(await storage.readResumedSessionIds(DAY));
      return { sessionId, cwd, fellBack: false };
    });
    await resumeSessions(
      { storage, sessionResumer: resumer },
      { day: DAY, handoffs: [alpha, beta] },
    );

    // At the moment beta is attempted, alpha must already be marked — proves the write happened
    // between the two attempts, not after the whole loop.
    expect([...seenAfterFirst[0]!]).toEqual([]);
    expect([...seenAfterFirst[1]!]).toEqual(['alpha']);
    expect([...(await storage.readResumedSessionIds(DAY))].sort()).toEqual(['alpha', 'beta']);
  });

  it('a fallback outcome (fellBack !== false) still counts as resumed — the person got a session', async () => {
    const handoff = createHandoff({ sessionId: 'alpha', cwd: 'c:\\code\\alpha' });
    const fallbackOutcome: ResumeOutcome = {
      sessionId: 'alpha',
      cwd: 'c:\\code\\alpha',
      fellBack: { kind: 'resumeFailed', exitCode: 1 },
    };
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const resumer = new FakeSessionResumer(() => Promise.resolve(fallbackOutcome));
    const result = await resumeSessions(
      { storage, sessionResumer: resumer },
      { day: DAY, handoffs: [handoff] },
    );

    expect(result.resumed).toEqual([fallbackOutcome]);
    expect([...(await storage.readResumedSessionIds(DAY))]).toEqual(['alpha']);
  });

  it('starts from whatever was already resumed for the day, and keeps it in the saved set', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveResumedSessionIds(DAY, new Set(['already-done']));
    const handoff = createHandoff({ sessionId: 'alpha' });
    await resumeSessions(
      { storage, sessionResumer: cleanlyResumingResumer() },
      { day: DAY, handoffs: [handoff] },
    );

    expect([...(await storage.readResumedSessionIds(DAY))].sort()).toEqual([
      'alpha',
      'already-done',
    ]);
  });
});

describe('resumeSessions — a resume() that throws stops the loop (docs/QUESTOES.md Q-027 item 5)', () => {
  it('stops before the failing session, reports it as remaining, and never marks it resumed', async () => {
    const alpha = createHandoff({ sessionId: 'alpha', name: 'alpha' });
    const beta = createHandoff({ sessionId: 'beta', name: 'beta' });
    const gamma = createHandoff({ sessionId: 'gamma', name: 'gamma' });
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const resumer = new FakeSessionResumer((sessionId) =>
      sessionId === 'beta'
        ? Promise.reject(new Error('claude is not on PATH'))
        : Promise.resolve({ sessionId, cwd: 'c:\\code\\x', fellBack: false }),
    );

    const result = await resumeSessions(
      { storage, sessionResumer: resumer },
      { day: DAY, handoffs: [alpha, beta, gamma] },
    );

    expect(result.resumed).toHaveLength(1);
    expect(result.resumed[0]?.sessionId).toBe('alpha');
    expect(result.stoppedEarly).not.toBe(false);
    if (result.stoppedEarly !== false) {
      expect(result.stoppedEarly.handoff.sessionId).toBe('beta');
      expect(result.stoppedEarly.error.message).toBe('claude is not on PATH');
    }
    // beta AND gamma never ran — gamma is never even attempted once the loop stops.
    expect(result.remaining.map((h) => h.sessionId)).toEqual(['beta', 'gamma']);
    expect(resumer.calls.map((call) => call.sessionId)).toEqual(['alpha', 'beta']);
    expect([...(await storage.readResumedSessionIds(DAY))]).toEqual(['alpha']);
  });

  it('a value thrown that is not an Error is wrapped, never left as a non-Error in the result', async () => {
    const handoff = createHandoff({ sessionId: 'alpha' });
    // Deliberately a non-Error rejection — this is exactly the case `toError` (start-day.ts) exists
    // to normalize, so the test needs a real one to reject with.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const resumer = new FakeSessionResumer(() => Promise.reject('a plain string failure'));
    const result = await resumeSessions(
      { storage: new FakeStorage(DEFAULT_TEST_CONFIG), sessionResumer: resumer },
      { day: DAY, handoffs: [handoff] },
    );
    expect(result.stoppedEarly).not.toBe(false);
    if (result.stoppedEarly !== false) {
      expect(result.stoppedEarly.error).toBeInstanceOf(Error);
      expect(result.stoppedEarly.error.message).toBe('a plain string failure');
    }
  });

  it('an empty handoff list resumes nothing and never touches the resumer', async () => {
    const resumer = throwingResumer('should never be called');
    const result = await resumeSessions(deps({ sessionResumer: resumer }), {
      day: DAY,
      handoffs: [],
    });
    expect(result).toEqual({ resumed: [], remaining: [], stoppedEarly: false });
    expect(resumer.calls).toHaveLength(0);
  });
});
