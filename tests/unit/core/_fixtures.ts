import type {
  Config,
  Handoff,
  SessionWithPid,
  SessionWithoutPid,
} from '../../../src/core/types.js';

/**
 * Factories for `DiscoveredSession` for the `core/` tests (S1-T1). Synthetic values — UUIDs with
 * only the digits 1/2/4/8 (CLAUDE.md § "Este projeto é de código aberto"), never real data.
 *
 * `Omit<..., 'hasPid'>` on the overrides parameter, with the discriminant fixed after the spread:
 * this guarantees its `true`/`false` literal never widens to generic `boolean` because
 * `Partial<SessionWithPid>` broadens the field's type — a common trap when building test
 * factories for a discriminated union.
 *
 * **This file briefly had a third factory, `createSessionWithoutSessionId` (D-023, S1-T10), and
 * both factories below took `Omit<..., 'hasPid' | 'hasSessionId'>` to match the union's second
 * discriminant of that era.** Removed in S1-T11 along with the shape itself — see
 * docs/DECISOES.md D-029.
 */
export function createSessionWithPid(
  overrides: Partial<Omit<SessionWithPid, 'hasPid'>> = {},
): SessionWithPid {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: 'c:\\code\\projeto',
    name: 'projeto-01',
    pid: 4242,
    procStart: '123456789',
    processIsAlive: true,
    hasTranscript: true,
    lastTranscriptWrite: new Date('2026-08-16T20:00:00.000Z'),
    lastActivity: new Date('2026-08-16T20:00:00.000Z'),
    ...overrides,
    hasPid: true,
  };
}

export function createSessionWithoutPid(
  overrides: Partial<Omit<SessionWithoutPid, 'hasPid'>> = {},
): SessionWithoutPid {
  return {
    sessionId: '22222222-2222-4222-8222-222222222222',
    cwd: 'c:\\code\\outro-projeto',
    name: 'outro-projeto-02',
    hasTranscript: true,
    lastTranscriptWrite: new Date('2026-08-16T20:00:00.000Z'),
    lastActivity: new Date('2026-08-16T20:00:00.000Z'),
    ...overrides,
    hasPid: false,
  };
}

/**
 * Minimal, complete `Handoff` — every field a caller doesn't override comes from a plain,
 * unremarkable "everything went fine, model ran, nothing pending" session. Synthetic UUID only
 * (CLAUDE.md § "Este projeto é de código aberto").
 *
 * Lifted out of `briefing.test.ts` (S2-T4) into this shared file when S3-T1's own tests
 * (`pending-briefing.test.ts`, `resume-prompt.test.ts`, `consolidated-plan.test.ts`) needed the
 * exact same factory — three copies of the same object literal would have been the duplication
 * AGENTS.md § "Estilo de código" rules out.
 */
export function createHandoff(overrides: Partial<Handoff> = {}): Handoff {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    cwd: 'c:\\code\\projeto',
    name: 'projeto-01',
    capturedAt: new Date('2026-08-16T21:00:00.000Z'),
    sessionState: 'ended',
    capturedDuringActiveTurn: false,
    source: 'model',
    captureMode: 'lean',
    sources: ['git', 'transcript', 'registry'],
    facts: {
      lastActivity: new Date('2026-08-16T20:45:00.000Z'),
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

/**
 * Minimal, complete `Config` for `schedule.test.ts` (S4-T2) — same "everything at a plain,
 * unremarkable default" spirit as `createHandoff` above. Values match
 * `tests/unit/application/_fakes.ts#DEFAULT_TEST_CONFIG` (not imported from there: that file
 * lives under `tests/unit/application/`, and `core/`'s own test suite doesn't reach across test
 * directories any more than `src/core/` reaches into `src/application/`) except `endOfDayTime`,
 * which schedule tests almost always want to set explicitly, so it defaults here to a concrete
 * `"19:30"` rather than the production default of `null` — a `Config` a schedule test builds
 * without overriding `endOfDayTime` is a `Config` that means to have a schedule.
 */
export function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    endOfDayTime: '19:30',
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
