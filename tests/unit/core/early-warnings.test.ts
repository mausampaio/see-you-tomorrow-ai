/**
 * `detectEarlyWarnings` (S1-T7, D-018/D-029) — pure, no I/O (docs/TESTES.md § Unidade:
 * "Detecção precoce sem transcript: notifica na primeira vez que vê o sessionId, e não notifica de
 * novo nas passagens seguintes. A mensagem inclui a correção (D-018).").
 */
import { describe, expect, it } from 'vitest';
import {
  detectEarlyWarnings,
  EMPTY_EARLY_WARNING_STATE,
} from '../../../src/core/early-warnings.js';
import { createSessionWithPid, createSessionWithoutPid } from './_fixtures.js';

describe('detectEarlyWarnings — missing-transcript trigger (D-018)', () => {
  it('warns the first time it sees a session without a transcript', () => {
    const session = createSessionWithPid({ hasTranscript: false, lastTranscriptWrite: null });

    const { warnings } = detectEarlyWarnings([session], [], EMPTY_EARLY_WARNING_STATE);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'missingTranscript', sessionId: session.sessionId });
  });

  it("the message names the session, the likely cause and the fix (D-018's acceptance)", () => {
    const session = createSessionWithPid({
      hasTranscript: false,
      lastTranscriptWrite: null,
      name: 'agente-interno-ui-03',
      cwd: 'c:\\work\\projeto',
    });

    const { warnings } = detectEarlyWarnings([session], [], EMPTY_EARLY_WARNING_STATE);

    const [warning] = warnings;
    expect(warning?.kind).toBe('missingTranscript');
    expect(warning?.message).toContain('agente-interno-ui-03');
    expect(warning?.message).toContain('c:\\work\\projeto');
    expect(warning?.message).toContain('CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1');
  });

  it('a session that has a transcript never triggers this warning', () => {
    const session = createSessionWithPid({ hasTranscript: true });

    const { warnings, nextState } = detectEarlyWarnings([session], [], EMPTY_EARLY_WARNING_STATE);

    expect(warnings).toStrictEqual([]);
    expect(nextState.notifiedMissingTranscriptSessionIds.size).toBe(0);
  });

  it('does not repeat the warning for a sessionId already recorded as notified', () => {
    const session = createSessionWithPid({ hasTranscript: false, lastTranscriptWrite: null });
    const previousState = {
      ...EMPTY_EARLY_WARNING_STATE,
      notifiedMissingTranscriptSessionIds: new Set([session.sessionId]),
    };

    const { warnings } = detectEarlyWarnings([session], [], previousState);

    expect(warnings).toStrictEqual([]);
  });

  it('two discovery passes in a row: warns once, then never again for the same sessionId', () => {
    const session = createSessionWithPid({ hasTranscript: false, lastTranscriptWrite: null });

    const first = detectEarlyWarnings([session], [], EMPTY_EARLY_WARNING_STATE);
    expect(first.warnings).toHaveLength(1);

    const second = detectEarlyWarnings([session], [], first.nextState);
    expect(second.warnings).toStrictEqual([]);
  });

  it('a session without a PID missing its transcript is warned about too (common to both shapes)', () => {
    const session = createSessionWithoutPid({ hasTranscript: false, lastTranscriptWrite: null });

    const { warnings } = detectEarlyWarnings([session], [], EMPTY_EARLY_WARNING_STATE);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: 'missingTranscript', sessionId: session.sessionId });
  });
});

describe('detectEarlyWarnings — uninspectable-session trigger (D-029)', () => {
  const KEY_FILE_NAME = '4242.deadbeef.key';

  it('warns the first time it sees a .key file with no matching .json', () => {
    const { warnings } = detectEarlyWarnings([], [KEY_FILE_NAME], EMPTY_EARLY_WARNING_STATE);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'uninspectableSession',
      keyFileName: KEY_FILE_NAME,
    });
  });

  it('the message names the file and does NOT affirm a cause (D-029 acceptance)', () => {
    const { warnings } = detectEarlyWarnings([], [KEY_FILE_NAME], EMPTY_EARLY_WARNING_STATE);

    const [warning] = warnings;
    expect(warning?.message).toContain(KEY_FILE_NAME);
    // D-029: the cause is not established. The message may name the one known lead, but must
    // frame it as unconfirmed, never as fact.
    expect(warning?.message).toMatch(/not (a )?confirmed|not established|known lead/i);
    expect(warning?.message).not.toMatch(/^Likely cause/);
  });

  it('never repeats for the same file name across two passes', () => {
    const first = detectEarlyWarnings([], [KEY_FILE_NAME], EMPTY_EARLY_WARNING_STATE);
    expect(first.warnings).toHaveLength(1);

    const second = detectEarlyWarnings([], [KEY_FILE_NAME], first.nextState);
    expect(second.warnings).toStrictEqual([]);
  });

  it('a different .key file name (new hash) after a PID recycle still warns — dedup key is the file name, not the pid', () => {
    const stale = '4242.deadbeef.key';
    const recycled = '4242.f00dcafe.key'; // same pid text, different hash: a genuinely new artifact
    const afterFirst = detectEarlyWarnings([], [stale], EMPTY_EARLY_WARNING_STATE).nextState;

    const { warnings } = detectEarlyWarnings([], [recycled], afterFirst);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ keyFileName: recycled });
  });

  it('an empty list of key file names produces no warnings and an unchanged empty set', () => {
    const { warnings, nextState } = detectEarlyWarnings([], [], EMPTY_EARLY_WARNING_STATE);

    expect(warnings).toStrictEqual([]);
    expect(nextState.notifiedUninspectableSessionKeys.size).toBe(0);
  });
});

describe('detectEarlyWarnings — both triggers together', () => {
  it('fires both kinds of warning in the same call and keeps each dedup set independent', () => {
    const session = createSessionWithPid({ hasTranscript: false, lastTranscriptWrite: null });
    const keyFileName = '9999.cafebabe.key';

    const { warnings, nextState } = detectEarlyWarnings(
      [session],
      [keyFileName],
      EMPTY_EARLY_WARNING_STATE,
    );

    expect(warnings.map((w) => w.kind).sort()).toStrictEqual(
      ['missingTranscript', 'uninspectableSession'].sort(),
    );
    expect(nextState.notifiedMissingTranscriptSessionIds.has(session.sessionId)).toBe(true);
    expect(nextState.notifiedUninspectableSessionKeys.has(keyFileName)).toBe(true);
  });

  it('previousState is not mutated — callers can compare it against nextState afterward', () => {
    const previousState = {
      notifiedMissingTranscriptSessionIds: new Set<string>(),
      notifiedUninspectableSessionKeys: new Set<string>(),
    };
    const session = createSessionWithPid({ hasTranscript: false, lastTranscriptWrite: null });

    detectEarlyWarnings([session], [], previousState);

    expect(previousState.notifiedMissingTranscriptSessionIds.size).toBe(0);
  });
});
