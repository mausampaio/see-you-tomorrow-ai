/**
 * `runStartDayCommand` (S3-T3): the five-step orchestration of `seeya start-day`
 * (docs/ESPECIFICACAO.md § `seeya start-day`). Reuses `tests/unit/application/_fakes.ts`'s named
 * doubles (docs/TESTES.md: "duplo de I/O é classe/objeto nomeado implementando a porta") — a
 * cross-faixa test-to-test import, not a layer violation (`dependency-cruiser` only governs
 * `src/`). Stdin/stdout are real `node:stream` `PassThrough`s, not a hand-rolled fake: a
 * `PassThrough` fully implements `Readable`/`Writable`, which is exactly what
 * `node:readline/promises#createInterface` needs, without an `as` anywhere.
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  runStartDayCommand,
  type StartDayCommandContext,
  type StartDayIo,
} from '../../../src/cli/start-day-command.js';
import { createHandoff } from '../core/_fixtures.js';
import {
  DEFAULT_TEST_CONFIG,
  FakeClock,
  FakeStorage,
  cleanlyResumingResumer,
  throwingResumer,
} from '../application/_fakes.js';

const TODAY = new Date(2026, 7, 16, 21, 0, 0); // 2026-08-16, local

function makeIo(options: { readonly isTTY: boolean; readonly answer?: string }): {
  readonly io: StartDayIo;
  readonly output: () => string;
} {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let collected = '';
  stdout.on('data', (chunk: Buffer) => {
    collected += chunk.toString('utf8');
  });
  if (options.answer !== undefined) {
    stdin.write(`${options.answer}\n`);
  }
  return {
    io: { stdin, stdout, isTTY: options.isTTY },
    output: () => collected,
  };
}

function makeContext(overrides: Partial<StartDayCommandContext> = {}): StartDayCommandContext {
  return {
    storage: new FakeStorage(DEFAULT_TEST_CONFIG),
    clock: new FakeClock(TODAY),
    sessionResumer: cleanlyResumingResumer(),
    ...overrides,
  };
}

describe('runStartDayCommand — no pending briefing (aceite: caso normal, não erro)', () => {
  it('reports how many days were scanned and exits 0', async () => {
    const context = makeContext();
    const { io, output } = makeIo({ isTTY: true });
    const exitCode = await runStartDayCommand(context, { all: false }, io);
    expect(exitCode).toBe(0);
    expect(output()).toContain('No pending briefing found');
  });
});

describe('runStartDayCommand — --all', () => {
  it('resumes every unresumed handoff, marks each resumed, and reports progress', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const alpha = createHandoff({
      sessionId: 'alpha-id',
      name: 'alpha',
      cwd: 'c:\\code\\alpha',
      pendingItems: ['finish alpha'],
    });
    const beta = createHandoff({
      sessionId: 'beta-id',
      name: 'beta',
      cwd: 'c:\\code\\beta',
      pendingItems: ['finish beta'],
    });
    await storage.saveHandoff('2026-08-15', alpha);
    await storage.saveHandoff('2026-08-15', beta);
    const resumer = cleanlyResumingResumer();
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io, output } = makeIo({ isTTY: true });

    const exitCode = await runStartDayCommand(context, { all: true }, io);

    expect(exitCode).toBe(0);
    expect(output()).toContain('Resuming 1 of 2: alpha');
    expect(output()).toContain('Resuming 2 of 2: beta');
    expect(output()).toContain('Resumed:');
    expect(resumer.calls.map((call) => call.sessionId)).toEqual(['alpha-id', 'beta-id']);
    expect([...(await storage.readResumedSessionIds('2026-08-15'))].sort()).toEqual([
      'alpha-id',
      'beta-id',
    ]);
  });

  it('a session already resumed earlier is skipped by a later --all run (S3-T3 aceite: nothing re-resumed)', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const alpha = createHandoff({ sessionId: 'alpha-id', name: 'alpha' });
    const beta = createHandoff({
      sessionId: 'beta-id',
      name: 'beta',
      pendingItems: ['finish beta'],
    });
    await storage.saveHandoff('2026-08-15', alpha);
    await storage.saveHandoff('2026-08-15', beta);
    await storage.saveResumedSessionIds('2026-08-15', new Set(['alpha-id']));
    const resumer = cleanlyResumingResumer();
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io } = makeIo({ isTTY: true });

    const exitCode = await runStartDayCommand(context, { all: true }, io);

    expect(exitCode).toBe(0);
    expect(resumer.calls.map((call) => call.sessionId)).toEqual(['beta-id']);
  });

  it('stops the loop when resume() throws, reports both sides, and exits non-zero (Q-027 item 5)', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const alpha = createHandoff({
      sessionId: 'alpha-id',
      name: 'alpha',
      pendingItems: ['finish alpha'],
    });
    const beta = createHandoff({
      sessionId: 'beta-id',
      name: 'beta',
      pendingItems: ['finish beta'],
    });
    await storage.saveHandoff('2026-08-15', alpha);
    await storage.saveHandoff('2026-08-15', beta);
    const resumer = throwingResumer('claude is not on PATH');
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io, output } = makeIo({ isTTY: true });

    const exitCode = await runStartDayCommand(context, { all: true }, io);

    expect(exitCode).toBe(1);
    expect(output()).toContain('stopped after');
    expect(output()).toContain('claude is not on PATH');
    expect([...(await storage.readResumedSessionIds('2026-08-15'))]).toEqual([]);
  });
});

describe('runStartDayCommand — --session', () => {
  it('resumes only the matching session, by sessionId', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const alpha = createHandoff({
      sessionId: 'alpha-id',
      name: 'alpha',
      pendingItems: ['finish alpha'],
    });
    const beta = createHandoff({
      sessionId: 'beta-id',
      name: 'beta',
      pendingItems: ['finish beta'],
    });
    await storage.saveHandoff('2026-08-15', alpha);
    await storage.saveHandoff('2026-08-15', beta);
    const resumer = cleanlyResumingResumer();
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io } = makeIo({ isTTY: true });

    const exitCode = await runStartDayCommand(context, { all: false, session: 'alpha-id' }, io);

    expect(exitCode).toBe(0);
    expect(resumer.calls.map((call) => call.sessionId)).toEqual(['alpha-id']);
  });

  it('resumes only the matching session, by cwd', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const alpha = createHandoff({
      sessionId: 'alpha-id',
      name: 'alpha',
      cwd: 'c:\\code\\alpha',
      pendingItems: ['finish alpha'],
    });
    await storage.saveHandoff('2026-08-15', alpha);
    const resumer = cleanlyResumingResumer();
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io } = makeIo({ isTTY: true });

    await runStartDayCommand(context, { all: false, session: 'c:\\code\\alpha' }, io);

    expect(resumer.calls.map((call) => call.sessionId)).toEqual(['alpha-id']);
  });

  it('a value matching nothing says so, and exits 0 (consistent with end-day --session)', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff('2026-08-15', createHandoff({ pendingItems: ['x'] }));
    const context = makeContext({ storage });
    const { io, output } = makeIo({ isTTY: true });

    const exitCode = await runStartDayCommand(
      context,
      { all: false, session: 'does-not-exist' },
      io,
    );

    expect(exitCode).toBe(0);
    expect(output()).toContain('No session in this briefing matches "does-not-exist"');
  });

  it('--session can re-target a session already marked resumed (explicit intent overrides the filter)', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const alpha = createHandoff({ sessionId: 'alpha-id', name: 'alpha' });
    const beta = createHandoff({ sessionId: 'beta-id', name: 'beta', pendingItems: ['x'] });
    await storage.saveHandoff('2026-08-15', alpha);
    await storage.saveHandoff('2026-08-15', beta);
    await storage.saveResumedSessionIds('2026-08-15', new Set(['alpha-id']));
    const resumer = cleanlyResumingResumer();
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io } = makeIo({ isTTY: true });

    await runStartDayCommand(context, { all: false, session: 'alpha-id' }, io);

    expect(resumer.calls.map((call) => call.sessionId)).toEqual(['alpha-id']);
  });
});

describe('runStartDayCommand — no flags, no TTY (decision: honest "cannot ask", exit 0)', () => {
  it('prints the plan and instructions to use --all/--session, resumes nothing', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff('2026-08-15', createHandoff({ name: 'alpha', pendingItems: ['x'] }));
    const resumer = throwingResumer('should never be called');
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io, output } = makeIo({ isTTY: false });

    const exitCode = await runStartDayCommand(context, { all: false }, io);

    expect(exitCode).toBe(0);
    expect(output()).toContain('alpha');
    expect(output()).toContain('--all');
    expect(output()).toContain('--session');
    expect(resumer.calls).toHaveLength(0);
  });
});

describe('runStartDayCommand — interactive picker (a TTY, no flags)', () => {
  it('resumes exactly the numbered session the user typed', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const alpha = createHandoff({
      sessionId: 'alpha-id',
      name: 'alpha',
      pendingItems: ['finish alpha'],
    });
    const beta = createHandoff({
      sessionId: 'beta-id',
      name: 'beta',
      pendingItems: ['finish beta'],
    });
    await storage.saveHandoff('2026-08-15', alpha);
    await storage.saveHandoff('2026-08-15', beta);
    const resumer = cleanlyResumingResumer();
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io, output } = makeIo({ isTTY: true, answer: '2' });

    const exitCode = await runStartDayCommand(context, { all: false }, io);

    expect(exitCode).toBe(0);
    expect(output()).toContain('Which sessions do you want to resume?');
    expect(resumer.calls.map((call) => call.sessionId)).toEqual(['beta-id']);
  });

  // S3-T6: the first real run printed the plan and the picker question back to back, with no
  // visual break — one wall of text. A blank line between them is the fix.
  it('prints a blank line between the plan and the picker question', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff('2026-08-15', createHandoff({ name: 'alpha', pendingItems: ['x'] }));
    const context = makeContext({ storage });
    const { io, output } = makeIo({ isTTY: true, answer: '' });

    await runStartDayCommand(context, { all: false }, io);

    expect(output()).toContain('\n\nWhich sessions do you want to resume?');
  });

  it('"all" typed at the prompt resumes every candidate', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff(
      '2026-08-15',
      createHandoff({ sessionId: 'alpha-id', name: 'alpha', pendingItems: ['finish alpha'] }),
    );
    await storage.saveHandoff(
      '2026-08-15',
      createHandoff({ sessionId: 'beta-id', name: 'beta', pendingItems: ['finish beta'] }),
    );
    const resumer = cleanlyResumingResumer();
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io } = makeIo({ isTTY: true, answer: 'all' });

    await runStartDayCommand(context, { all: false }, io);

    expect(resumer.calls.map((call) => call.sessionId).sort()).toEqual(['alpha-id', 'beta-id']);
  });

  it('a blank answer resumes nothing and exits 0', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff('2026-08-15', createHandoff({ pendingItems: ['x'] }));
    const resumer = throwingResumer('should never be called');
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io, output } = makeIo({ isTTY: true, answer: '' });

    const exitCode = await runStartDayCommand(context, { all: false }, io);

    expect(exitCode).toBe(0);
    expect(output()).toContain('Nothing selected');
    expect(resumer.calls).toHaveLength(0);
  });

  it('an invalid answer reports the problem and resumes nothing, instead of guessing', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff('2026-08-15', createHandoff({ pendingItems: ['x'] }));
    const resumer = throwingResumer('should never be called');
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io, output } = makeIo({ isTTY: true, answer: 'banana' });

    const exitCode = await runStartDayCommand(context, { all: false }, io);

    expect(exitCode).toBe(0);
    expect(output()).toContain('"banana"');
    expect(resumer.calls).toHaveLength(0);
  });

  // Maintainer follow-up on the same run: the reason alone ("expected a number from...") left
  // implicit that nothing happened as a result, and that --all/--session would have skipped the
  // question entirely. Both stated now, without re-litigating the "no retry loop" choice (S3-T3).
  it('an invalid answer also states nothing was resumed, and points at --help', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff('2026-08-15', createHandoff({ pendingItems: ['x'] }));
    const resumer = throwingResumer('should never be called');
    const context = makeContext({ storage, sessionResumer: resumer });
    const { io, output } = makeIo({ isTTY: true, answer: 'banana' });

    const exitCode = await runStartDayCommand(context, { all: false }, io);

    expect(exitCode).toBe(0);
    expect(output()).toContain('Nothing was resumed');
    expect(output()).toContain('seeya start-day --help');
    expect(resumer.calls).toHaveLength(0);
  });

  it('already-resumed sessions are not offered at the prompt', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff(
      '2026-08-15',
      createHandoff({ sessionId: 'alpha-id', name: 'alpha' }),
    );
    await storage.saveHandoff(
      '2026-08-15',
      createHandoff({ sessionId: 'beta-id', name: 'beta', pendingItems: ['x'] }),
    );
    await storage.saveResumedSessionIds('2026-08-15', new Set(['alpha-id']));
    const context = makeContext({ storage });
    const { io, output } = makeIo({ isTTY: true, answer: '1' });

    await runStartDayCommand(context, { all: false }, io);

    // Only one candidate offered (beta) — the prompt numbers it "1)", never mentions alpha.
    expect(output()).toContain('1) beta');
    expect(output()).not.toContain('2) ');
  });
});
