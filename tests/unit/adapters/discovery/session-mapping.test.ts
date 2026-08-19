import { describe, expect, it } from 'vitest';
import {
  buildSessionWithPid,
  computeLastActivity,
  deriveNameFromCwd,
} from '../../../../src/adapters/discovery/session-mapping.js';
import type { SessionRecord } from '../../../../src/adapters/discovery/schemas.js';

const baseRecord: SessionRecord = {
  pid: 4242,
  sessionId: '11111111-1111-4111-8111-111111111111',
  cwd: 'c:\\code\\projeto-03',
  startedAt: 1_755_360_000_000,
  procStart: '999999000011112222',
};

describe('deriveNameFromCwd', () => {
  it('takes the last segment of a Windows-style path', () => {
    expect(deriveNameFromCwd('c:\\code\\projeto-03')).toBe('projeto-03');
  });

  it('takes the last segment of a POSIX-style path', () => {
    expect(deriveNameFromCwd('/home/<usuario>/code/projeto-03')).toBe('projeto-03');
  });

  it('ignores a trailing separator', () => {
    expect(deriveNameFromCwd('/home/<usuario>/code/projeto-03/')).toBe('projeto-03');
  });

  it('falls back to the whole string when there is no separator at all', () => {
    expect(deriveNameFromCwd('projeto-03')).toBe('projeto-03');
  });

  it('handles a bare root without crashing (no segment left to pick)', () => {
    expect(deriveNameFromCwd('/')).toBe('/');
  });
});

describe('computeLastActivity', () => {
  const startedAt = Date.parse('2026-08-16T10:00:00.000Z');

  it('picks the transcript write when it is more recent than startedAt', () => {
    const transcriptWrite = new Date('2026-08-16T20:00:00.000Z');

    expect(computeLastActivity(startedAt, transcriptWrite)).toStrictEqual(transcriptWrite);
  });

  it('picks startedAt when there is no transcript at all (null, not a timestamp — D-025 shape)', () => {
    expect(computeLastActivity(startedAt, null)).toStrictEqual(new Date(startedAt));
  });

  it('picks startedAt when the transcript write is older (session started later than its own transcript mtime never happens, but the comparison must hold anyway)', () => {
    const olderTranscriptWrite = new Date('2026-08-15T00:00:00.000Z');

    expect(computeLastActivity(startedAt, olderTranscriptWrite)).toStrictEqual(new Date(startedAt));
  });
});

describe('buildSessionWithPid', () => {
  it('carries a live session through untouched, deriving nothing (name present)', () => {
    const session = buildSessionWithPid(
      { ...baseRecord, name: 'projeto-03' },
      {
        processIsAlive: true,
        hasTranscript: true,
        lastTranscriptWrite: new Date(baseRecord.startedAt),
      },
    );

    expect(session).toStrictEqual({
      hasPid: true,
      sessionId: baseRecord.sessionId,
      cwd: baseRecord.cwd,
      name: 'projeto-03',
      pid: baseRecord.pid,
      procStart: baseRecord.procStart,
      processIsAlive: true,
      hasTranscript: true,
      lastTranscriptWrite: new Date(baseRecord.startedAt),
      lastActivity: new Date(baseRecord.startedAt),
    });
  });

  it('derives the name from cwd when the record has none (D-021)', () => {
    const session = buildSessionWithPid(baseRecord, {
      processIsAlive: true,
      hasTranscript: false,
      lastTranscriptWrite: null,
    });

    expect(session.name).toBe('projeto-03');
  });

  /**
   * The exact case docs/ESPECIFICACAO.md § "Como as sessões são descobertas" and D-016 call out:
   * a stale registry entry (dead PID) is still built as a normal `SessionWithPid`, not dropped —
   * `core/classification.ts` is what later turns `processIsAlive: false` into the `ended` state.
   */
  it('a dead PID still produces a normal session, not a rejection (stale entries are reported, D-016)', () => {
    const session = buildSessionWithPid(baseRecord, {
      processIsAlive: false,
      hasTranscript: true,
      lastTranscriptWrite: new Date(baseRecord.startedAt),
    });

    expect(session.hasPid).toBe(true);
    expect(session.processIsAlive).toBe(false);
  });
});
