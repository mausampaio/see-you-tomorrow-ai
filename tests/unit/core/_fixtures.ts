import type { SessionWithPid, SessionWithoutPid } from '../../../src/core/types.js';

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
