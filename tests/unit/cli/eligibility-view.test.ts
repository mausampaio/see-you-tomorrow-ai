import { describe, expect, it } from 'vitest';
import { countEligibleSessions } from '../../../src/cli/eligibility-view.js';
import type { Config } from '../../../src/core/types.js';
import { createSessionWithPid } from '../core/_fixtures.js';

const NOW = new Date('2026-08-29T12:00:00.000Z');

function config(overrides: Partial<Config> = {}): Config {
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
    ...overrides,
  };
}

describe('countEligibleSessions', () => {
  it('counts a session with recent activity and no other disqualifier as eligible', () => {
    const session = createSessionWithPid({ lastActivity: new Date(NOW.getTime() - 60_000) });

    expect(countEligibleSessions([session], config(), NOW)).toBe(1);
  });

  it('excludes a session with no activity evidence at all (lastActivity: null)', () => {
    const session = createSessionWithPid({ lastActivity: null });

    expect(countEligibleSessions([session], config(), NOW)).toBe(0);
  });

  it('excludes a session whose most recent activity is older than relevanceHours', () => {
    const tooOld = new Date(NOW.getTime() - 13 * 3_600_000);
    const session = createSessionWithPid({ lastActivity: tooOld });

    expect(countEligibleSessions([session], config({ relevanceHours: 12 }), NOW)).toBe(0);
  });

  it('excludes a session whose cwd is in config.ignore', () => {
    const session = createSessionWithPid({
      cwd: 'c:\\code\\rascunhos',
      lastActivity: new Date(NOW.getTime() - 60_000),
    });

    expect(countEligibleSessions([session], config({ ignore: ['c:\\code\\rascunhos'] }), NOW)).toBe(
      0,
    );
  });

  it('counts only the eligible ones out of a mixed batch', () => {
    const eligible = createSessionWithPid({
      sessionId: '11111111-1111-4111-8111-111111111111',
      lastActivity: new Date(NOW.getTime() - 60_000),
    });
    const noEvidence = createSessionWithPid({
      sessionId: '22222222-2222-4222-8222-222222222222',
      lastActivity: null,
    });
    const ignored = createSessionWithPid({
      sessionId: '33333333-3333-4333-8333-333333333333',
      cwd: 'c:\\code\\ignored',
      lastActivity: new Date(NOW.getTime() - 60_000),
    });

    const count = countEligibleSessions(
      [eligible, noEvidence, ignored],
      config({ ignore: ['c:\\code\\ignored'] }),
      NOW,
    );

    expect(count).toBe(1);
  });
});
