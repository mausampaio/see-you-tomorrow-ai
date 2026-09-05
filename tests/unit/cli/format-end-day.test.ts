import { describe, expect, it } from 'vitest';
import { formatEndDayReport } from '../../../src/cli/format-end-day.js';
import type {
  CapturedSession,
  EndDayResult,
  IneligibleSession,
} from '../../../src/application/types.js';
import type { Config, Handoff } from '../../../src/core/types.js';

/** Minimal, complete `Handoff` — same spirit as `core/briefing.test.ts`'s own `createHandoff`
 * (this file doesn't import that one: each test file keeps its own tiny fixture, the project's
 * existing convention — see e.g. `tests/unit/core/briefing.test.ts`). Synthetic UUID only. */
function createHandoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: 'c:\\code\\projeto',
    name: 'projeto-01',
    capturedAt: new Date('2026-08-16T21:00:00.000Z'),
    sessionState: 'ended',
    capturedDuringActiveTurn: false,
    source: 'model',
    captureMode: 'lean',
    sources: ['registry'],
    facts: {
      lastActivity: null,
      lastPrompts: [],
      assistantMessages: [],
      touchedFiles: [],
      git: [],
      filesOutsideRepository: 0,
      reposNotVisited: 0,
    },
    understanding: 'Refactored the parser.',
    pendingItems: [],
    tomorrowPlan: [],
    generationError: null,
    ...overrides,
  };
}

function captured(overrides: Partial<CapturedSession> = {}): CapturedSession {
  return { handoff: createHandoff(), terminated: false, ...overrides };
}

function ineligible(overrides: Partial<IneligibleSession> = {}): IneligibleSession {
  return {
    sessionId: '22222222-2222-4222-8222-222222222222',
    cwd: 'c:\\code\\ignorado',
    name: 'ignorado',
    reasons: ['ignoredCwd'],
    ...overrides,
  };
}

function buildResult(overrides: Partial<EndDayResult> = {}): EndDayResult {
  return {
    day: '2026-08-16',
    scope: { kind: 'fullDay' },
    discoveredCount: 0,
    rejectedDiscoveries: [],
    ineligible: [],
    captured: [],
    failedCaptures: [],
    terminationNotices: [],
    dryRun: false,
    briefingPreview: null,
    sessionsInScope: 0,
    listedSessions: [],
    forkCleanup: null,
    forkCleanupError: null,
    ...overrides,
  };
}

function buildConfig(overrides: Partial<Config> = {}): Config {
  return {
    endOfDayTime: null,
    leadTimesInMinutes: [30, 15],
    relevanceHours: 12,
    idleMinutes: 45,
    captureModel: 'sonnet',
    budgetPerSessionUsd: 0.25,
    captureConcurrency: 3,
    ignore: [],
    projectPolicy: {},
    forkCleanupDays: 7,
    ...overrides,
  };
}

describe('formatEndDayReport — header and discovery summary', () => {
  it('a real run has no dry-run suffix', () => {
    const report = formatEndDayReport(buildResult(), buildConfig());
    expect(report).toContain('seeya end-day — 2026-08-16');
    expect(report).not.toContain('dry run');
  });

  it('a dry run names itself explicitly', () => {
    const report = formatEndDayReport(buildResult({ dryRun: true }), buildConfig());
    expect(report).toContain(
      'seeya end-day — 2026-08-16 (dry run — nothing is written or terminated)',
    );
  });

  it('S4-T0c: a full-day run states its scope explicitly, right after the header', () => {
    const report = formatEndDayReport(buildResult(), buildConfig());
    const lines = report.split('\n');
    expect(lines[1]).toBe('Scope: full day.');
  });

  it('S4-T0c: a --session-narrowed run names the raw value, not the resolved sessionId', () => {
    const report = formatEndDayReport(
      buildResult({
        scope: {
          kind: 'singleSession',
          sessionValue: 'code-6d',
          captureCandidateCount: 4,
          consideredCount: 1,
        },
      }),
      buildConfig(),
    );
    expect(report).toContain('Scope: narrowed by --session "code-6d"');
  });

  it('S4-T0d: names how many capture candidates were considered and how many were discarded', () => {
    const report = formatEndDayReport(
      buildResult({
        scope: {
          kind: 'singleSession',
          sessionValue: 'code-6d',
          captureCandidateCount: 4,
          consideredCount: 1,
        },
      }),
      buildConfig(),
    );
    expect(report).toContain(
      'Scope: narrowed by --session "code-6d" — 1 of 4 capture candidates considered; 3 discarded ' +
        'by the filter.',
    );
  });

  it('S4-T0d: a full-day run never prints a discard count — there is nothing to report', () => {
    const report = formatEndDayReport(buildResult(), buildConfig());
    expect(report).toContain('Scope: full day.');
    expect(report).not.toContain('discarded');
  });

  it('reports discoveredCount and sessionsInScope, singular/plural correctly', () => {
    const report = formatEndDayReport(
      buildResult({ discoveredCount: 1, sessionsInScope: 1 }),
      buildConfig(),
    );
    expect(report).toContain('1 session discovered; 1 in scope.');
  });

  it('D-022: rejected discoveries are named, not just counted', () => {
    const report = formatEndDayReport(
      buildResult({
        discoveredCount: 2,
        sessionsInScope: 2,
        rejectedDiscoveries: [{ file: 'sessions/broken.json', raw: 'x', reason: 'not valid JSON' }],
      }),
      buildConfig(),
    );
    expect(report).toContain('2 sessions discovered, 1 entry ignored; 2 in scope.');
    expect(report).toContain('Ignored discovery entries:');
    expect(report).toContain('sessions/broken.json: not valid JSON');
  });

  it('D-031: names how many were kept out of scope, right in the summary line', () => {
    const report = formatEndDayReport(
      buildResult({
        discoveredCount: 2,
        sessionsInScope: 1,
        listedSessions: [
          {
            sessionId: '11111111-1111-4111-8111-111111111111',
            cwd: 'c:\\code\\fechada',
            name: 'fechada',
            info: { kind: 'read', aiTitle: null, lastPrompt: null },
          },
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('2 sessions discovered; 1 in scope, 1 session not captured (closed).');
  });
});

describe('formatEndDayReport — D-031 listing section', () => {
  it('names each listed session with its title and last prompt, separately from Captured', () => {
    const report = formatEndDayReport(
      buildResult({
        captured: [captured()],
        listedSessions: [
          {
            sessionId: '22222222-2222-4222-8222-222222222222',
            cwd: 'c:\\code\\fechada',
            name: 'fechada-01',
            info: { kind: 'read', aiTitle: 'Refactor the parser', lastPrompt: 'run the tests' },
          },
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('Not captured (closed sessions, D-031):');
    expect(report).toContain(
      '- fechada-01 (c:\\code\\fechada): "Refactor the parser" — last prompt: "run the tests"',
    );
    const capturedIndex = report.indexOf('Captured:');
    const listedIndex = report.indexOf('Not captured');
    expect(capturedIndex).toBeGreaterThanOrEqual(0);
    expect(listedIndex).toBeGreaterThan(capturedIndex);
  });

  it('D-025: a listing with no ai-title shows "(no title)", never an invented one', () => {
    const report = formatEndDayReport(
      buildResult({
        listedSessions: [
          {
            sessionId: '22222222-2222-4222-8222-222222222222',
            cwd: 'c:\\code\\fechada',
            name: 'fechada-01',
            info: { kind: 'read', aiTitle: null, lastPrompt: null },
          },
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('- fechada-01 (c:\\code\\fechada): "(no title)"');
    expect(report).not.toContain('last prompt:');
  });

  it('S4-T0c: an unreadable listing shows a distinct message and reason, and counts in the header', () => {
    const report = formatEndDayReport(
      buildResult({
        listedSessions: [
          {
            sessionId: '22222222-2222-4222-8222-222222222222',
            cwd: 'c:\\code\\fechada',
            name: 'fechada-01',
            info: { kind: 'unreadable', reason: 'EACCES: permission denied' },
          },
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('Not captured (closed sessions, D-031) (1 entry could not be read');
    expect(report).toContain(
      '- fechada-01 (c:\\code\\fechada): title unavailable — could not read the transcript ' +
        '(EACCES: permission denied)',
    );
    expect(report).not.toContain('(no title)');
  });

  it('omits the section entirely when nothing was listed', () => {
    const report = formatEndDayReport(buildResult(), buildConfig());
    expect(report).not.toContain('Not captured');
  });
});

describe('formatEndDayReport — captured sessions', () => {
  it('a model-sourced capture shows its understanding text', () => {
    const report = formatEndDayReport(
      buildResult({ captured: [captured({ handoff: createHandoff({ understanding: 'did X' }) })] }),
      buildConfig(),
    );
    expect(report).toContain('- projeto-01 (c:\\code\\projeto)');
    expect(report).toContain('mode: lean | source: model');
    expect(report).toContain('Understanding: did X');
  });

  it('D-025/D-003: a deterministic capture names the failure, never fabricates understanding', () => {
    const report = formatEndDayReport(
      buildResult({
        captured: [
          captured({
            handoff: createHandoff({
              source: 'deterministic',
              understanding: '',
              generationError: 'claude exited with code 1',
            }),
          }),
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('source: deterministic');
    expect(report).toContain('Understanding not available: claude exited with code 1');
  });

  it('a real run shows the actual "terminated" outcome', () => {
    const config = buildConfig({
      projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: false } },
    });
    const report = formatEndDayReport(
      buildResult({ captured: [captured({ terminated: true })] }),
      config,
    );
    expect(report).toContain('terminated: yes');
  });

  it('a dry run shows "would terminate" derived from policy, never the (always-false) terminated field', () => {
    const config = buildConfig({
      projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: false } },
    });
    const report = formatEndDayReport(
      buildResult({ dryRun: true, captured: [captured({ terminated: false })] }),
      config,
    );
    expect(report).toContain('would terminate: yes');
    expect(report).not.toContain('terminated:');
  });

  it('a dry run never claims "would terminate: yes" for a session with no PID (sessionState: unknown)', () => {
    const config = buildConfig({
      projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: false } },
    });
    const report = formatEndDayReport(
      buildResult({
        dryRun: true,
        captured: [captured({ handoff: createHandoff({ sessionState: 'unknown' }) })],
      }),
      config,
    );
    expect(report).toContain('would terminate: no');
  });

  it('omits the whole "Captured" section when nothing was captured', () => {
    const report = formatEndDayReport(buildResult(), buildConfig());
    expect(report).not.toContain('Captured:');
  });
});

describe('formatEndDayReport — pending/plan lists (S4-T0h)', () => {
  it("renders pendingItems and tomorrowPlan one item per line, reusing start-day's list shape", () => {
    const report = formatEndDayReport(
      buildResult({
        captured: [
          captured({
            handoff: createHandoff({
              pendingItems: ['fix the flaky test', 'write the missing docstring'],
              tomorrowPlan: ['ship the release'],
            }),
          }),
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain(
      '    pending:\n      - fix the flaky test\n      - write the missing docstring',
    );
    expect(report).toContain('    plan:\n      - ship the release');
  });

  it('shows only "pending" when there is no plan yet, and vice versa', () => {
    const onlyPending = formatEndDayReport(
      buildResult({
        captured: [
          captured({ handoff: createHandoff({ pendingItems: ['fix it'], tomorrowPlan: [] }) }),
        ],
      }),
      buildConfig(),
    );
    expect(onlyPending).toContain('pending:\n      - fix it');
    expect(onlyPending).not.toContain('plan:');

    const onlyPlan = formatEndDayReport(
      buildResult({
        captured: [
          captured({ handoff: createHandoff({ pendingItems: [], tomorrowPlan: ['ship it'] }) }),
        ],
      }),
      buildConfig(),
    );
    expect(onlyPlan).not.toContain('pending:');
    expect(onlyPlan).toContain('plan:\n      - ship it');
  });

  it('D-025: says plainly when a model-confirmed capture has nothing pending', () => {
    const report = formatEndDayReport(
      buildResult({
        captured: [captured({ handoff: createHandoff({ pendingItems: [], tomorrowPlan: [] }) })],
      }),
      buildConfig(),
    );
    expect(report).toContain('nothing pending recorded');
  });

  it('D-025: a deterministic capture never shows a pending list nor "nothing pending recorded" — the model never confirmed either', () => {
    const report = formatEndDayReport(
      buildResult({
        captured: [
          captured({
            handoff: createHandoff({
              source: 'deterministic',
              understanding: '',
              generationError: 'claude exited with code 1',
              // Contrived: these would never actually be non-empty on a deterministic handoff
              // (D-003's fallback always leaves them at `[]`), but the gate is on `source`, not
              // on emptiness — proven here so nobody "simplifies" the gate away later.
              pendingItems: ['should never render'],
              tomorrowPlan: ['should never render either'],
            }),
          }),
        ],
      }),
      buildConfig(),
    );
    expect(report).not.toContain('nothing pending recorded');
    expect(report).not.toContain('should never render');
  });
});

describe('formatEndDayReport — Understanding excerpt (S4-T0h)', () => {
  it('a short understanding prints in full, with no truncation note', () => {
    const report = formatEndDayReport(
      buildResult({
        captured: [
          captured({ handoff: createHandoff({ understanding: 'Refactored the parser.' }) }),
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('Understanding: Refactored the parser.');
    expect(report).not.toContain('full text in summary.md');
  });

  // The measured case from the maintainer's screenshot (docs/PLANO-DE-ENTREGA.md S4-T0h): a
  // sonnet capture produced a 1682-character `understanding` printed as one unbroken paragraph.
  // Built, not copied verbatim (CLAUDE.md § "Este projeto é de código aberto" — no real session
  // content in the repo), but the exact same measured length.
  it('a 1682-character understanding (the measured real case) is excerpted, never printed whole', () => {
    const sentence = 'Investigated the failing capture pipeline and traced it to a stale cache. ';
    let longUnderstanding = '';
    while (longUnderstanding.length < 1682) {
      longUnderstanding += sentence;
    }
    longUnderstanding = longUnderstanding.slice(0, 1682);
    expect(longUnderstanding).toHaveLength(1682);

    const report = formatEndDayReport(
      buildResult({
        captured: [captured({ handoff: createHandoff({ understanding: longUnderstanding }) })],
      }),
      buildConfig(),
    );
    expect(report).not.toContain(longUnderstanding);
    expect(report).toContain('full text in summary.md');
    // The excerpt line itself stays short — nowhere near the 1682-character wall.
    const understandingLine = report.split('\n').find((line) => line.includes('Understanding:'));
    expect(understandingLine).toBeDefined();
    expect(understandingLine!.length).toBeLessThan(260);
  });

  it('cuts at a sentence boundary when one falls within the excerpt budget', () => {
    // The first sentence ends at character 145 — past the 40%-of-200 = 80 cutoff, so the excerpt
    // should end there instead of running the full 200-character budget to a word boundary.
    const firstSentence =
      'Implemented the retry logic end to end, wired it into the capture pipeline, and confirmed ' +
      'the new behavior meets the stated goal for this session.';
    const text =
      `${firstSentence} ` +
      'This second sentence is padding that pushes the whole string well past the excerpt budget ' +
      'so truncation actually happens, repeated repeated repeated repeated.';
    const report = formatEndDayReport(
      buildResult({ captured: [captured({ handoff: createHandoff({ understanding: text }) })] }),
      buildConfig(),
    );
    expect(report).toContain(`Understanding: ${firstSentence} (…, full text in summary.md)`);
  });

  it('falls back to the last word boundary when no sentence end falls within the budget', () => {
    const items = Array.from({ length: 40 }, (_, i) => `item${i}`);
    const text = items.join(', ');
    const report = formatEndDayReport(
      buildResult({ captured: [captured({ handoff: createHandoff({ understanding: text }) })] }),
      buildConfig(),
    );
    // Cut right after "item25," (the last full item inside the 200-character budget), never
    // mid-word (e.g. not "item2" cut out of "item25").
    expect(report).toContain(
      'Understanding: item0, item1, item2, item3, item4, item5, item6, item7, item8, item9, ' +
        'item10, item11, item12, item13, item14, item15, item16, item17, item18, item19, item20, ' +
        'item21, item22, item23, item24, item25, (…, full text in summary.md)',
    );
  });

  it('D-025/D-003: a deterministic capture is unaffected by the excerpt logic — it names the failure, not a truncated understanding', () => {
    const report = formatEndDayReport(
      buildResult({
        captured: [
          captured({
            handoff: createHandoff({
              source: 'deterministic',
              understanding: '',
              generationError: 'claude exited with code 1',
            }),
          }),
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('Understanding not available: claude exited with code 1');
    expect(report).not.toContain('full text in summary.md');
  });
});

describe('formatEndDayReport — two-session realistic report (S4-T0h aceite)', () => {
  it('two captured sessions, one with a 1682-character understanding and several pending items, fit a legible report with the pending list visible', () => {
    const sentence = 'Migrated the storage schema and re-ran the affected integration suite. ';
    let longUnderstanding = '';
    while (longUnderstanding.length < 1682) {
      longUnderstanding += sentence;
    }
    longUnderstanding = longUnderstanding.slice(0, 1682);

    const sessionA = createHandoff({
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'agente-interno',
      cwd: 'c:\\code\\agente-interno',
      understanding: longUnderstanding,
      pendingItems: [
        'Confirm the migration handles a v1 document with no git facts recorded',
        'Add the missing regression test for the empty-repositories case',
        'Re-run the full suite once the fixture is in place',
      ],
      tomorrowPlan: ['Open a PR once the suite is green', 'Ask for review from the maintainer'],
    });
    const sessionB = createHandoff({
      sessionId: '22222222-2222-4222-8222-222222222222',
      name: 'seeya-todo-test',
      cwd: 'c:\\code\\seeya-todo-test',
      understanding: 'Added the sample todo list and marked two items done.',
      pendingItems: ['Verify the third item was left open on purpose'],
      tomorrowPlan: [],
    });

    const report = formatEndDayReport(
      buildResult({
        discoveredCount: 2,
        sessionsInScope: 2,
        captured: [captured({ handoff: sessionA }), captured({ handoff: sessionB })],
      }),
      buildConfig(),
    );

    // The wall is gone: no single line anywhere near the measured 1682-character size.
    for (const line of report.split('\n')) {
      expect(line.length).toBeLessThan(300);
    }
    // Every existing section survives.
    expect(report).toContain('seeya end-day — 2026-08-16');
    expect(report).toContain('Scope: full day.');
    expect(report).toContain('- agente-interno (c:\\code\\agente-interno)');
    expect(report).toContain('- seeya-todo-test (c:\\code\\seeya-todo-test)');
    // The pending list is visible without opening summary.md.
    expect(report).toContain(
      '    pending:\n      - Confirm the migration handles a v1 document with no git facts recorded',
    );
    expect(report).toContain(
      '      - Add the missing regression test for the empty-repositories case',
    );
    expect(report).toContain('    plan:\n      - Open a PR once the suite is green');
    expect(report).toContain(
      '    pending:\n      - Verify the third item was left open on purpose',
    );
    // The prose is excerpted, with an explicit pointer rather than a silent cut.
    expect(report).not.toContain(longUnderstanding);
    expect(report).toContain('full text in summary.md');
  });
});

describe('formatEndDayReport — ineligible, failed captures and termination notices', () => {
  it('lists ineligible sessions with their reasons', () => {
    const report = formatEndDayReport(
      buildResult({ ineligible: [ineligible({ reasons: ['ignoredCwd', 'noRecentActivity'] })] }),
      buildConfig(),
    );
    expect(report).toContain('Ineligible:');
    expect(report).toContain('- ignorado (c:\\code\\ignorado): ignoredCwd, noRecentActivity');
  });

  it('lists failed captures with the raw reason (AGENTS.md § "Mensagens de erro")', () => {
    const report = formatEndDayReport(
      buildResult({
        failedCaptures: [
          { sessionId: 's', cwd: 'c:\\code\\falhou', name: 'falhou', reason: 'disk is full' },
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('Failed captures:');
    expect(report).toContain('- falhou (c:\\code\\falhou): disk is full');
  });

  it('Q-007: names a termination notice explicitly, never silently', () => {
    const report = formatEndDayReport(
      buildResult({
        terminationNotices: [
          {
            sessionId: 's',
            cwd: 'c:\\code\\preso',
            name: 'preso',
            reason: 'terminateGracefully returned false; process pid 123 is still alive (Q-007)',
          },
        ],
      }),
      buildConfig(),
    );
    expect(report).toContain('Termination notices:');
    expect(report).toContain('- preso (c:\\code\\preso): terminateGracefully returned false');
  });

  it('omits all three sections when every bucket is empty', () => {
    const report = formatEndDayReport(buildResult(), buildConfig());
    expect(report).not.toContain('Ineligible:');
    expect(report).not.toContain('Failed captures:');
    expect(report).not.toContain('Termination notices:');
  });
});

describe('formatEndDayReport — fork cleanup (D-012)', () => {
  it('a dry run always reports the cleanup as skipped, never a preview', () => {
    const report = formatEndDayReport(buildResult({ dryRun: true }), buildConfig());
    expect(report).toContain('Fork cleanup: skipped (a dry run never deletes files, D-012).');
  });

  it('a real run with nothing stale says so plainly', () => {
    const report = formatEndDayReport(
      buildResult({ forkCleanup: { outcomes: [], rejected: [] } }),
      buildConfig(),
    );
    expect(report).toContain('Fork cleanup: nothing to clean up.');
  });

  it('summarizes deleted/alreadyAbsent/failed outcomes and rejected registry entries', () => {
    const report = formatEndDayReport(
      buildResult({
        forkCleanup: {
          outcomes: [
            { sessionId: 'a', outcome: 'deleted' },
            { sessionId: 'b', outcome: 'alreadyAbsent' },
            { sessionId: 'c', outcome: 'failed', reason: 'EPERM' },
          ],
          rejected: [{ file: 'forks.json', raw: 'x', reason: 'corrupted entry' }],
        },
      }),
      buildConfig(),
    );
    expect(report).toContain(
      'Fork cleanup: 1 fork deleted, 1 entry already absent, 1 fork failed to delete.',
    );
    expect(report).toContain('1 entry in forks.json ignored.');
  });

  it('a cleanup that itself failed reports the raw error, never silently', () => {
    const report = formatEndDayReport(
      buildResult({ forkCleanupError: 'forks.json is unwritable' }),
      buildConfig(),
    );
    expect(report).toContain('Fork cleanup: failed — forks.json is unwritable');
  });
});

describe('formatEndDayReport — briefing section', () => {
  it('a dry run prints the full preview markdown, never claims to have written', () => {
    const report = formatEndDayReport(
      buildResult({ dryRun: true, briefingPreview: '# Daily briefing — 2026-08-16\n' }),
      buildConfig(),
    );
    expect(report).toContain('Briefing preview (not written):');
    expect(report).toContain('# Daily briefing — 2026-08-16');
    expect(report).not.toContain('Wrote ');
  });

  it('a real run confirms the write with a count, singular/plural correctly', () => {
    const report = formatEndDayReport(
      buildResult({
        captured: [captured(), captured({ handoff: createHandoff({ sessionId: 'x' }) })],
      }),
      buildConfig(),
    );
    expect(report).toContain('Wrote 2 handoffs and the daily briefing (summary.md).');
  });
});
