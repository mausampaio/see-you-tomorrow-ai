import type {
  SessionWithPid,
  SessionWithoutPid,
  SessionWithoutSessionId,
} from '../../../src/core/types.js';

/**
 * Factories for `DiscoveredSession` for the `core/` tests (S1-T1, grown by S1-T10). Synthetic
 * values — UUIDs with only the digits 1/2/4/8 (CLAUDE.md § "Este projeto é de código aberto"),
 * never real data.
 *
 * `Omit<..., 'hasPid' | 'hasSessionId'>` on the overrides parameter, with both discriminants
 * fixed after the spread: this guarantees their `true`/`false` literals never widen to generic
 * `boolean` because `Partial<SessionWithPid>` broadens the field's type — a common trap when
 * building test factories for a discriminated union. `SessionWithoutSessionId` only has one
 * discriminant to fix this way (`hasSessionId` is always `false` there and never appears in the
 * override type at all — there's nothing to omit).
 */
export function createSessionWithPid(
  overrides: Partial<Omit<SessionWithPid, 'hasPid' | 'hasSessionId'>> = {},
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
    hasSessionId: true,
  };
}

export function createSessionWithoutPid(
  overrides: Partial<Omit<SessionWithoutPid, 'hasPid' | 'hasSessionId'>> = {},
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
    hasSessionId: true,
  };
}

/** D-023/S1-T10: PID guaranteed, `sessionId` never present at all. */
export function createSessionWithoutSessionId(
  overrides: Partial<Omit<SessionWithoutSessionId, 'hasPid' | 'hasSessionId'>> = {},
): SessionWithoutSessionId {
  return {
    cwd: 'c:\\code\\terceiro-projeto',
    name: 'terceiro-projeto-03',
    pid: 5252,
    processIsAlive: true,
    commandLine: '/agente-interno:dev --item 2990',
    hasTranscript: false,
    lastTranscriptWrite: null,
    lastActivity: new Date('2026-08-16T20:00:00.000Z'),
    ...overrides,
    hasPid: true,
    hasSessionId: false,
  };
}
