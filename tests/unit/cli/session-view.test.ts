import { describe, expect, it } from 'vitest';
import { buildSessionRows } from '../../../src/cli/session-view.js';
import type { Config } from '../../../src/core/types.js';
import { createSessionWithPid, createSessionWithoutPid } from '../core/_fixtures.js';

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

describe('buildSessionRows', () => {
  it('classifies each session using classifyState, threading now/idleMinutes through', () => {
    const alive = createSessionWithPid({
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'alive-project',
      processIsAlive: true,
      lastTranscriptWrite: null,
    });
    const idle = createSessionWithPid({
      sessionId: '22222222-2222-4222-8222-222222222222',
      name: 'idle-project',
      processIsAlive: true,
      lastTranscriptWrite: new Date(NOW.getTime() - 60 * 60_000),
    });
    const ended = createSessionWithPid({
      sessionId: '33333333-3333-4333-8333-333333333333',
      name: 'ended-project',
      processIsAlive: false,
    });
    const unknown = createSessionWithoutPid({
      sessionId: '44444444-4444-4444-8444-444444444444',
      name: 'headless-project',
    });

    const rows = buildSessionRows([alive, idle, ended, unknown], config(), NOW);

    const stateByName = Object.fromEntries(rows.map((row) => [row.name, row.state]));
    expect(stateByName).toEqual({
      'alive-project': 'alive',
      'idle-project': 'idle',
      'ended-project': 'ended',
      'headless-project': 'unknown',
    });
  });

  it('carries lastActivity through unchanged, including null (D-025 — never invented here)', () => {
    const session = createSessionWithPid({ lastActivity: null });

    const [row] = buildSessionRows([session], config(), NOW);

    expect(row?.lastActivity).toBeNull();
  });

  describe('canTerminate', () => {
    it('is true only when config.projectPolicy names this exact cwd with canTerminate: true', () => {
      const session = createSessionWithPid({ cwd: 'c:\\code\\projeto' });
      const cfg = config({
        projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: false } },
      });

      const [row] = buildSessionRows([session], cfg, NOW);

      expect(row?.canTerminate).toBe(true);
    });

    it('defaults to false (D-002: opt-in) when the cwd is not mentioned in projectPolicy at all', () => {
      const session = createSessionWithPid({ cwd: 'c:\\code\\unmentioned' });

      const [row] = buildSessionRows([session], config(), NOW);

      expect(row?.canTerminate).toBe(false);
    });
  });

  it('sorts rows by name then cwd, independent of discovery order', () => {
    const zebra = createSessionWithPid({
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'zebra',
    });
    const alpha = createSessionWithPid({
      sessionId: '22222222-2222-4222-8222-222222222222',
      name: 'alpha',
    });

    const rows = buildSessionRows([zebra, alpha], config(), NOW);

    expect(rows.map((row) => row.name)).toEqual(['alpha', 'zebra']);
  });

  it('a session with the D-021 default name (derived from cwd, never empty) still gets a row', () => {
    const session = createSessionWithPid({ name: 'derived-from-cwd' });

    const rows = buildSessionRows([session], config(), NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('derived-from-cwd');
  });
});
