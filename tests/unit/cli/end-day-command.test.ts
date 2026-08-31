/**
 * `runEndDayCommand` (S2-T5, extended by S3-T5): `--session`'s matching (sessionId, sessionId
 * prefix, display name, or path-normalized cwd — `cli/session-reference.ts`), the ambiguity and
 * "no match" short circuits, and the wiring into `application/endDay` + `formatEndDayReport`.
 * Reuses `tests/unit/application/_fakes.ts`'s named doubles (docs/TESTES.md: "duplo de I/O é
 * classe/objeto nomeado implementando a porta") instead of a second copy — `dependency-cruiser`
 * only governs `src/`, so a test-to-test import across faixas is not a layer violation.
 */
import { describe, expect, it } from 'vitest';
import { runEndDayCommand } from '../../../src/cli/end-day-command.js';
import { createSessionWithPid } from '../core/_fixtures.js';
import type { EndDayDeps } from '../../../src/application/types.js';
import type { Config } from '../../../src/core/types.js';
import type { DiscoveryResult, SessionProvider } from '../../../src/core/ports.js';
import {
  DEFAULT_TEST_CONFIG,
  FakeClock,
  FakeForkCleanup,
  FakeGitReader,
  FakeProcessControl,
  FakeSessionProvider,
  FakeStorage,
  FakeTranscriptReader,
  succeedingGenerator,
} from '../application/_fakes.js';
import { RecordingNotifier, ThrowingNotifier } from './_fakes.js';

const NOW = new Date('2026-08-16T21:00:00.000Z');

/**
 * A `SessionProvider` that answers a DIFFERENT `DiscoveryResult` each call — models the rare race
 * `end-day-command.ts#formatVanishedMatchMessage` exists for: `--session` resolves against one
 * discovery snapshot, and `application/endDay` takes its own, separate one moments later. Named
 * per docs/TESTES.md's "duplo de I/O é classe/objeto nomeado implementando a porta"; local to this
 * file because no other test needs a `SessionProvider` whose answer changes between calls.
 */
class SequenceSessionProvider implements SessionProvider {
  private index = 0;
  constructor(private readonly results: readonly DiscoveryResult[]) {}
  list(): Promise<DiscoveryResult> {
    const result = this.results[this.index] ??
      this.results.at(-1) ?? { sessions: [], rejected: [] };
    this.index += 1;
    return Promise.resolve(result);
  }
}

function buildDeps(overrides: Partial<EndDayDeps> = {}): EndDayDeps {
  return {
    sessionProvider: new FakeSessionProvider({ sessions: [], rejected: [] }),
    transcriptReader: new FakeTranscriptReader(),
    gitReader: new FakeGitReader(),
    leanGenerator: succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
    deepGenerator: succeedingGenerator({ understanding: '', pendingItems: [], tomorrowPlan: [] }),
    storage: new FakeStorage(DEFAULT_TEST_CONFIG),
    processControl: new FakeProcessControl(),
    clock: new FakeClock(NOW),
    forkCleanup: new FakeForkCleanup(),
    ...overrides,
  };
}

describe('runEndDayCommand — no --session', () => {
  it('captures every eligible session and formats the full report', async () => {
    const session = createSessionWithPid({ name: 'projeto-01', lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, { dryRun: false });
    expect(report).toContain('seeya end-day — 2026-08-16');
    expect(report).toContain('projeto-01');
  });
});

describe('runEndDayCommand — --session (S2-T5, matching extended by S3-T5)', () => {
  function twoSessions() {
    const alpha = createSessionWithPid({
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'c:\\code\\alpha',
      name: 'alpha',
      lastActivity: NOW,
    });
    const beta = createSessionWithPid({
      sessionId: '22222222-2222-4222-8222-222222222222',
      cwd: 'c:\\code\\beta',
      name: 'beta',
      lastActivity: NOW,
    });
    return { alpha, beta };
  }

  it('matches by sessionId and excludes the other discovered session', async () => {
    const { alpha, beta } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: alpha.sessionId,
    });
    expect(report).toContain('alpha');
    expect(report).not.toContain('beta');
    expect(report).toContain('1 in scope');
  });

  it('matches by cwd just as well as by sessionId', async () => {
    const { alpha, beta } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: beta.cwd,
    });
    expect(report).toContain('beta');
    expect(report).not.toContain('alpha');
  });

  it('matches by cwd through path normalization (separator + trailing slash)', async () => {
    const { alpha, beta } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: 'c:/code/beta/',
    });
    expect(report).toContain('beta');
    expect(report).not.toContain('alpha');
  });

  it('matches by a unique sessionId prefix', async () => {
    const { alpha, beta } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: '11111111',
    });
    expect(report).toContain('alpha');
    expect(report).not.toContain('beta');
  });

  it('matches by exact display name', async () => {
    const { alpha, beta } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: 'beta',
    });
    expect(report).toContain('beta');
    expect(report).not.toContain('alpha');
  });

  it('a value matching nothing reports so explicitly, instead of a silent "0 in scope" report', async () => {
    const { alpha } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: 'nothing-matches-this',
    });
    expect(report).toBe(
      'No discovered session matches "nothing-matches-this" ' +
        '(checked against sessionId, a sessionId prefix, the display name, and cwd). ' +
        '1 session was discovered in total — see "seeya sessions" to list them.',
    );
  });

  // The count above is 1, so it only ever exercised the singular. Pairing it with a two-session
  // run is what actually covers the agreement — the message used to dodge the question with
  // "session(s)", and a test that never sees a plural would let that come back unnoticed.
  it('agrees with a plural count when more than one session was discovered', async () => {
    const { alpha, beta } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: 'nothing-matches-this',
    });
    expect(report).toContain('2 sessions were discovered in total');
  });

  /**
   * S3-T5, requirement 4: the "no match" message shows the RAW received value plainly — never a
   * silently normalized stand-in for it (the maintainer's own `C:\Users\<usuario>` → `C:Users<usuario>`
   * shell-mangling story) — and additionally names the normalized form when normalizing it as a
   * `cwd` candidate would have changed it, so the reader can see path normalization was tried.
   */
  it('the no-match message shows both the raw value and its normalized-as-cwd form when they differ', async () => {
    const { alpha } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: 'c:/Nothing/Here/',
    });
    expect(report).toContain('"c:/Nothing/Here/"');
    expect(report).toContain('normalized to');
  });

  it('the no-match message does not add a normalized-form note when normalizing changes nothing', async () => {
    const { alpha } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: 'nothing-matches-this',
    });
    expect(report).not.toContain('normalized to');
  });

  it('never calls endDay in a way that captures the excluded session (dry-run branch too)', async () => {
    const { alpha, beta } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: true,
      session: alpha.sessionId,
    });
    expect(report).toContain('dry run');
    expect(report).toContain('alpha');
    expect(report).not.toContain('beta');
  });

  /**
   * The hard rule (docs/PLANO-DE-ENTREGA.md S3-T5): a prefix (or cwd, or name) matching more than
   * one discovered session is refused outright, not narrowed to one by guessing — `end-day
   * --session` can terminate the process it resolves to (D-002), so picking wrong here is
   * expensive. Both sessions are named in the report so the person can retry with a full
   * sessionId.
   */
  it('a cwd shared by two sessions is refused as ambiguous, never captures either one', async () => {
    const sharedCwd = 'c:\\users\\<usuario>';
    const first = createSessionWithPid({
      sessionId: '88881111-0000-4000-8000-000000000000',
      cwd: sharedCwd,
      name: 'first',
      lastActivity: NOW,
    });
    const second = createSessionWithPid({
      sessionId: '44442222-0000-4000-8000-000000000000',
      cwd: sharedCwd,
      name: 'second',
      lastActivity: NOW,
    });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [first, second], rejected: [] }),
    });

    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: sharedCwd,
    });

    expect(report).toContain('matches 2 discovered sessions');
    expect(report).toContain('first');
    expect(report).toContain('second');
    expect(report).toContain(first.sessionId);
    expect(report).toContain(second.sessionId);
    // Neither actually got captured (dry-run-independent, since ambiguity refuses before endDay
    // even runs): no "Captured:" section, no "seeya end-day —" header from a real report.
    expect(report).not.toContain('Captured:');
  });

  it('an ambiguous sessionId prefix is refused the same way', async () => {
    const alpha = createSessionWithPid({
      sessionId: '88881111-0000-4000-8000-000000000000',
      cwd: 'c:\\code\\alpha',
      name: 'alpha',
      lastActivity: NOW,
    });
    const beta = createSessionWithPid({
      sessionId: '88882222-0000-4000-8000-000000000000',
      cwd: 'c:\\code\\beta',
      name: 'beta',
      lastActivity: NOW,
    });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [alpha, beta], rejected: [] }),
    });

    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: '8888',
    });

    expect(report).toContain('matches 2 discovered sessions');
  });

  it('a session that vanishes between the resolving discovery and endDay\'s own says so, not "0 in scope"', async () => {
    const { alpha } = twoSessions();
    const deps = buildDeps({
      sessionProvider: new SequenceSessionProvider([
        { sessions: [alpha], rejected: [] },
        { sessions: [], rejected: [] },
      ]),
    });

    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, {
      dryRun: false,
      session: alpha.sessionId,
    });

    expect(report).toContain(`"${alpha.sessionId}"`);
    expect(report).toContain('alpha');
    expect(report).toContain('no longer discovered');
  });
});

describe('runEndDayCommand — Config threading', () => {
  it('passes the config through to formatting (e.g. termination policy shown for a dry-run preview)', async () => {
    const session = createSessionWithPid({
      hasTranscript: true,
      cwd: 'c:\\code\\p',
      lastActivity: NOW,
    });
    const config: Config = {
      ...DEFAULT_TEST_CONFIG,
      projectPolicy: { 'c:\\code\\p': { canTerminate: true, deepCapture: false } },
    };
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
      storage: new FakeStorage(config),
    });
    const report = await runEndDayCommand(deps, config, { dryRun: true });
    expect(report).toContain('would terminate: yes');
  });
});

describe('runEndDayCommand — notifier (S4-T1)', () => {
  it('with no notifier given, still returns the same report as before (backward compatible)', async () => {
    const session = createSessionWithPid({ name: 'projeto-01', lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });
    const report = await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, { dryRun: false });
    expect(report).toContain('seeya end-day — 2026-08-16');
  });

  it('notifies the real result of a full run', async () => {
    const session = createSessionWithPid({ name: 'projeto-01', lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });
    const notifier = new RecordingNotifier();

    await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, { dryRun: false }, notifier);

    expect(notifier.notices).toHaveLength(1);
    expect(notifier.notices[0]?.title).toBe('seeya end-day: 2026-08-16');
    expect(notifier.notices[0]?.body).toContain('1 session captured');
  });

  it('never notifies for a dry run', async () => {
    const session = createSessionWithPid({ name: 'projeto-01', lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });
    const notifier = new RecordingNotifier();

    await runEndDayCommand(deps, DEFAULT_TEST_CONFIG, { dryRun: true }, notifier);

    expect(notifier.notices).toHaveLength(0);
  });

  it('never notifies when --session matches nothing (no real run happened)', async () => {
    const session = createSessionWithPid({ name: 'projeto-01', lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });
    const notifier = new RecordingNotifier();

    await runEndDayCommand(
      deps,
      DEFAULT_TEST_CONFIG,
      { dryRun: false, session: 'nothing-matches-this' },
      notifier,
    );

    expect(notifier.notices).toHaveLength(0);
  });

  it('a Notifier that rejects never aborts the command — the report still comes back', async () => {
    const session = createSessionWithPid({ name: 'projeto-01', lastActivity: NOW });
    const deps = buildDeps({
      sessionProvider: new FakeSessionProvider({ sessions: [session], rejected: [] }),
    });

    const report = await runEndDayCommand(
      deps,
      DEFAULT_TEST_CONFIG,
      { dryRun: false },
      new ThrowingNotifier(),
    );

    expect(report).toContain('seeya end-day — 2026-08-16');
    expect(report).toContain('projeto-01');
  });
});
