import { describe, expect, it } from 'vitest';
import { mergeDiscoveryResults } from '../../../../src/adapters/discovery/merge.js';
import type {
  RegistryDiscoveryResult,
  RejectedSessionRecord,
} from '../../../../src/adapters/discovery/registry.js';
import type {
  RejectedTranscriptRecord,
  TranscriptScanResult,
} from '../../../../src/adapters/discovery/transcript-scan.js';
import type { SessionWithPid, SessionWithoutPid } from '../../../../src/core/types.js';

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';

function registrySession(overrides: Partial<SessionWithPid> = {}): SessionWithPid {
  return {
    hasPid: true,
    sessionId: SESSION_A,
    cwd: 'c:\\code\\projeto-01',
    name: 'projeto-01',
    pid: 4242,
    procStart: '999999000011112222',
    processIsAlive: true,
    hasTranscript: false,
    lastTranscriptWrite: null,
    lastActivity: new Date('2026-08-16T10:00:00.000Z'),
    ...overrides,
  };
}

function scanSession(overrides: Partial<SessionWithoutPid> = {}): SessionWithoutPid {
  return {
    hasPid: false,
    sessionId: SESSION_A,
    cwd: 'c:\\code\\projeto-01',
    name: 'projeto-01',
    hasTranscript: true,
    lastTranscriptWrite: new Date('2026-08-16T20:00:00.000Z'),
    lastActivity: new Date('2026-08-16T20:00:00.000Z'),
    ...overrides,
  };
}

function registryResult(
  sessions: SessionWithPid[] = [],
  rejected: RejectedSessionRecord[] = [],
): RegistryDiscoveryResult {
  return { sessions, rejected };
}

function scanResult(
  sessions: SessionWithoutPid[] = [],
  rejected: RejectedTranscriptRecord[] = [],
): TranscriptScanResult {
  return { sessions, rejected };
}

describe('mergeDiscoveryResults — sessions in only one origin', () => {
  it('a registry-only session enters untouched, in the registry shape (hasPid: true)', () => {
    const result = mergeDiscoveryResults(registryResult([registrySession()]), scanResult());

    expect(result.sessions).toStrictEqual([registrySession()]);
  });

  it('a transcript-scan-only session enters untouched, in that shape (hasPid: false)', () => {
    const result = mergeDiscoveryResults(registryResult(), scanResult([scanSession()]));

    expect(result.sessions).toStrictEqual([scanSession()]);
  });

  it('independent sessions from each origin both appear, neither one absorbing the other', () => {
    const result = mergeDiscoveryResults(
      registryResult([registrySession({ sessionId: SESSION_A })]),
      scanResult([scanSession({ sessionId: SESSION_B, cwd: 'c:\\code\\projeto-02' })]),
    );

    expect(result.sessions).toHaveLength(2);
    expect(result.sessions.map((s) => s.sessionId).sort()).toStrictEqual(
      [SESSION_A, SESSION_B].sort(),
    );
  });
});

describe('mergeDiscoveryResults — a session in both origins appears once, fused', () => {
  it('produces exactly one entry, in the registry shape (hasPid: true)', () => {
    const result = mergeDiscoveryResults(
      registryResult([registrySession()]),
      scanResult([scanSession()]),
    );

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.hasPid).toBe(true);
  });

  it('pid, procStart and processIsAlive always come from the registry — the scan side has no such fields', () => {
    const result = mergeDiscoveryResults(
      registryResult([registrySession({ pid: 9999, procStart: 'abc', processIsAlive: false })]),
      scanResult([scanSession()]),
    );

    expect(result.sessions[0]).toMatchObject({
      pid: 9999,
      procStart: 'abc',
      processIsAlive: false,
    });
  });

  it('cwd and name come from the registry, not the transcript-scan reconstruction', () => {
    const result = mergeDiscoveryResults(
      registryResult([registrySession({ cwd: 'c:\\code\\registro', name: 'nome-do-registro' })]),
      scanResult([scanSession({ cwd: 'c:\\code\\transcript', name: 'nome-do-transcript' })]),
    );

    expect(result.sessions[0]).toMatchObject({
      cwd: 'c:\\code\\registro',
      name: 'nome-do-registro',
    });
  });

  it('hasTranscript is true if either origin says so, even when the registry alone says false', () => {
    const result = mergeDiscoveryResults(
      registryResult([registrySession({ hasTranscript: false })]),
      scanResult([scanSession({ hasTranscript: true })]),
    );

    expect(result.sessions[0]?.hasTranscript).toBe(true);
  });

  /**
   * The field-by-field rule the PO asked for explicitly (docs/PLANO-DE-ENTREGA.md S1-T9): the
   * fresher of the two independent reads wins, regardless of which side produced it — never
   * "the registry always wins" for these two fields. Tested in both directions so neither
   * implementation shortcut ("always prefer registry" / "always prefer scan") can pass.
   */
  it('lastTranscriptWrite and lastActivity take the more recent value when the scan is fresher', () => {
    const older = new Date('2026-08-16T08:00:00.000Z');
    const fresher = new Date('2026-08-16T23:00:00.000Z');

    const result = mergeDiscoveryResults(
      registryResult([
        registrySession({ hasTranscript: true, lastTranscriptWrite: older, lastActivity: older }),
      ]),
      scanResult([
        scanSession({ hasTranscript: true, lastTranscriptWrite: fresher, lastActivity: fresher }),
      ]),
    );

    expect(result.sessions[0]?.lastTranscriptWrite).toStrictEqual(fresher);
    expect(result.sessions[0]?.lastActivity).toStrictEqual(fresher);
  });

  it('lastTranscriptWrite and lastActivity take the more recent value when the registry is fresher', () => {
    const fresher = new Date('2026-08-16T23:00:00.000Z');
    const older = new Date('2026-08-16T08:00:00.000Z');

    const result = mergeDiscoveryResults(
      registryResult([
        registrySession({
          hasTranscript: true,
          lastTranscriptWrite: fresher,
          lastActivity: fresher,
        }),
      ]),
      scanResult([
        scanSession({ hasTranscript: true, lastTranscriptWrite: older, lastActivity: older }),
      ]),
    );

    expect(result.sessions[0]?.lastTranscriptWrite).toStrictEqual(fresher);
    expect(result.sessions[0]?.lastActivity).toStrictEqual(fresher);
  });

  it('a null lastTranscriptWrite on the registry side never hides a real timestamp from the scan side', () => {
    const scanWrite = new Date('2026-08-16T20:00:00.000Z');

    const result = mergeDiscoveryResults(
      registryResult([registrySession({ hasTranscript: false, lastTranscriptWrite: null })]),
      scanResult([scanSession({ hasTranscript: true, lastTranscriptWrite: scanWrite })]),
    );

    expect(result.sessions[0]?.lastTranscriptWrite).toStrictEqual(scanWrite);
  });

  /**
   * The mirror of the test above. Today's `discoverSessionsFromTranscriptScan` never actually
   * produces a `null` `lastTranscriptWrite` (S1-T8 always sets it from the file's mtime), but
   * `SessionWithoutPid`'s type allows it, and `laterOf` (this module) has to stay correct for
   * that boundary regardless of what the current strategy happens to emit — otherwise the day a
   * caller does hand it `null`, the wrong branch has never been exercised.
   */
  it('a null lastTranscriptWrite on the scan side never hides a real timestamp from the registry side', () => {
    const registryWrite = new Date('2026-08-16T20:00:00.000Z');

    const result = mergeDiscoveryResults(
      registryResult([
        registrySession({ hasTranscript: true, lastTranscriptWrite: registryWrite }),
      ]),
      scanResult([scanSession({ hasTranscript: true, lastTranscriptWrite: null })]),
    );

    expect(result.sessions[0]?.lastTranscriptWrite).toStrictEqual(registryWrite);
  });
});

describe('mergeDiscoveryResults — rejections are summed, not dropped', () => {
  it('rejections from both origins appear together, unrelated files', () => {
    const registryRejection: RejectedSessionRecord = {
      file: 'c:\\claude\\sessions\\broken.json',
      raw: undefined,
      reason: 'not valid JSON',
    };
    const scanRejection: RejectedTranscriptRecord = {
      file: 'c:\\claude\\projects\\slug\\bad.jsonl',
      raw: undefined,
      reason: 'no readable cwd',
    };

    const result = mergeDiscoveryResults(
      registryResult([], [registryRejection]),
      scanResult([], [scanRejection]),
    );

    expect(result.rejected).toHaveLength(2);
    expect(result.rejected).toStrictEqual(
      expect.arrayContaining([registryRejection, scanRejection]),
    );
  });

  /**
   * Both strategies independently read `forks.json` for D-012 exclusion — a corrupted file
   * produces one rejection from each. Reporting it twice would inflate "N entries ignored" for a
   * single broken file (see merge.ts#isSameRejection's docstring).
   */
  it('an identical rejection (same file, same reason) from both origins is reported once', () => {
    const sharedRejection = {
      file: 'c:\\seeya\\forks.json',
      raw: 'not json {{{',
      reason: 'forks.json: not valid JSON',
    };

    const result = mergeDiscoveryResults(
      registryResult([], [sharedRejection]),
      scanResult([], [{ ...sharedRejection }]),
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toStrictEqual(sharedRejection);
  });

  it('two rejections for the same file but different reasons both survive (not treated as duplicates)', () => {
    const first: RejectedSessionRecord = {
      file: 'c:\\seeya\\forks.json',
      raw: undefined,
      reason: 'missing schemaVersion',
    };
    const second: RejectedTranscriptRecord = {
      file: 'c:\\seeya\\forks.json',
      raw: undefined,
      reason: 'a completely different reason',
    };

    const result = mergeDiscoveryResults(registryResult([], [first]), scanResult([], [second]));

    expect(result.rejected).toHaveLength(2);
  });

  it('no rejections on either side produces an empty rejected list', () => {
    const result = mergeDiscoveryResults(registryResult(), scanResult());

    expect(result.rejected).toStrictEqual([]);
  });
});
