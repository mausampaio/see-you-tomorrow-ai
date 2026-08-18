import { describe, expect, it } from 'vitest';
import {
  sessionRecordSchema,
  validateAgentsJsonOutput,
} from '../../../../src/adaptadores/descoberta/esquemas.js';

/**
 * Unit tests for the discovery schemas (S0-T5). Synthetic fixtures, not this machine's real
 * files — confirming against reality is tests/contrato/'s job, not this suite's (which needs to
 * run without touching `~/.claude`, per docs/TESTES.md).
 */
describe('sessionRecordSchema', () => {
  const validRecord = {
    pid: 12345,
    sessionId: '11111111-2222-4333-8444-555555555555',
    cwd: 'c:\\code\\projeto',
    startedAt: 1755360000000,
    procStart: '999999000011112222',
    version: '2.1.233',
    kind: 'interactive',
    entrypoint: 'cli',
    name: 'projeto-03',
    nameSource: 'derived',
    nameSince: 1755360000001,
  };

  it('accepts a real record and silently drops unknown fields', () => {
    const result = sessionRecordSchema.parse(validRecord);

    expect(result).toStrictEqual({
      pid: 12345,
      sessionId: '11111111-2222-4333-8444-555555555555',
      cwd: 'c:\\code\\projeto',
      kind: 'interactive',
      entrypoint: 'cli',
      startedAt: 1755360000000,
      procStart: '999999000011112222',
      name: 'projeto-03',
    });
    expect(result).not.toHaveProperty('version');
    expect(result).not.toHaveProperty('nameSource');
  });

  it('accepts procStart with more precision than Number.MAX_SAFE_INTEGER, as a string', () => {
    const giantProcStart = '999999999999999999999';
    const result = sessionRecordSchema.parse({
      ...validRecord,
      procStart: giantProcStart,
    });

    expect(result.procStart).toBe(giantProcStart);
  });

  it('rejects a procStart that is not digits-only', () => {
    const result = sessionRecordSchema.safeParse({
      ...validRecord,
      procStart: '134313811658518463n',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a sessionId that is not a uuid', () => {
    const result = sessionRecordSchema.safeParse({
      ...validRecord,
      sessionId: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a record without pid', () => {
    const withoutPid: Record<string, unknown> = { ...validRecord };
    delete withoutPid['pid'];
    const result = sessionRecordSchema.safeParse(withoutPid);

    expect(result.success).toBe(false);
  });

  it('rejects an empty cwd', () => {
    const result = sessionRecordSchema.safeParse({ ...validRecord, cwd: '' });

    expect(result.success).toBe(false);
  });

  it('rejects a record without sessionId (D-021: identity stays required)', () => {
    const withoutSessionId: Record<string, unknown> = { ...validRecord };
    delete withoutSessionId['sessionId'];
    const result = sessionRecordSchema.safeParse(withoutSessionId);

    expect(result.success).toBe(false);
  });

  it('rejects a record without cwd (D-021: identity stays required)', () => {
    const withoutCwd: Record<string, unknown> = { ...validRecord };
    delete withoutCwd['cwd'];
    const result = sessionRecordSchema.safeParse(withoutCwd);

    expect(result.success).toBe(false);
  });

  it('accepts a record without name (D-021: a display field cannot hide the session)', () => {
    const withoutName: Record<string, unknown> = { ...validRecord };
    delete withoutName['name'];
    const result = sessionRecordSchema.safeParse(withoutName);

    expect(result.success).toBe(true);
    expect(result.success && result.data.name).toBeUndefined();
  });

  it('accepts a record without entrypoint (D-021: a display field cannot hide the session)', () => {
    const withoutEntrypoint: Record<string, unknown> = { ...validRecord };
    delete withoutEntrypoint['entrypoint'];
    const result = sessionRecordSchema.safeParse(withoutEntrypoint);

    expect(result.success).toBe(true);
    expect(result.success && result.data.entrypoint).toBeUndefined();
  });

  it('accepts a record without kind (D-021: a display field cannot hide the session)', () => {
    const withoutKind: Record<string, unknown> = { ...validRecord };
    delete withoutKind['kind'];
    const result = sessionRecordSchema.safeParse(withoutKind);

    expect(result.success).toBe(true);
    expect(result.success && result.data.kind).toBeUndefined();
  });

  it('accepts a record without all three display fields at once', () => {
    const identityOnly: Record<string, unknown> = { ...validRecord };
    delete identityOnly['name'];
    delete identityOnly['entrypoint'];
    delete identityOnly['kind'];
    const result = sessionRecordSchema.safeParse(identityOnly);

    expect(result.success).toBe(true);
  });
});

describe('validateAgentsJsonOutput', () => {
  it('accepts an array with an item that has status and one that does not', () => {
    const result = validateAgentsJsonOutput([
      {
        pid: 12345,
        cwd: 'c:\\code\\projeto',
        kind: 'interactive',
        startedAt: 1755360000000,
        sessionId: '11111111-2222-4333-8444-555555555555',
        name: 'projeto-03',
        status: 'busy',
      },
      {
        pid: 67890,
        cwd: 'c:\\code\\outro-projeto',
        kind: 'interactive',
        startedAt: 1755360100000,
        sessionId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
        name: 'outro-projeto-24',
      },
    ]);

    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(result.accepted[0]?.status).toBe('busy');
    expect(result.accepted[1]?.status).toBeUndefined();
  });

  it('accepts an empty array (no active session)', () => {
    expect(validateAgentsJsonOutput([])).toStrictEqual({ accepted: [], rejected: [] });
  });

  it('rejects an item without sessionId, without taking down the array (D-022)', () => {
    const result = validateAgentsJsonOutput([
      {
        pid: 12345,
        cwd: 'c:\\code\\projeto',
        kind: 'interactive',
        startedAt: 1755360000000,
        name: 'projeto-03',
      },
    ]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it('rejects an item without cwd (D-021: identity stays required)', () => {
    const result = validateAgentsJsonOutput([
      {
        pid: 12345,
        kind: 'interactive',
        startedAt: 1755360000000,
        sessionId: '11111111-2222-4333-8444-555555555555',
        name: 'projeto-03',
      },
    ]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it('accepts an item without name and without kind (D-021: display cannot hide the session)', () => {
    const result = validateAgentsJsonOutput([
      {
        pid: 12345,
        cwd: 'c:\\code\\projeto',
        startedAt: 1755360000000,
        sessionId: '11111111-2222-4333-8444-555555555555',
      },
    ]);

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  /**
   * The real shape observed on the second machine (Linux) that took down the whole array before
   * this task (S1-T0c, D-022). Literal fixture values anonymized as described in the task —
   * `<usuario>` as a home placeholder and an obviously synthetic UUID (only 3 distinct symbols:
   * 1, 4, 8), per CLAUDE.md § "Este projeto é de código aberto".
   */
  const backgroundSampleFromTheSecondMachine = {
    id: '11111111',
    cwd: '/home/<usuario>/.claude/agente/ui',
    kind: 'background',
    startedAt: 1780000000000,
    sessionId: '11111111-1111-4111-8111-111111111111',
    name: 'background session',
    state: 'blocked',
  };

  it('accepts the background variant with no pid, preserving id and state (D-022)', () => {
    const result = validateAgentsJsonOutput([backgroundSampleFromTheSecondMachine]);

    expect(result.rejected).toHaveLength(0);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toStrictEqual({
      id: '11111111',
      cwd: '/home/<usuario>/.claude/agente/ui',
      kind: 'background',
      startedAt: 1780000000000,
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'background session',
      state: 'blocked',
    });
    expect(result.accepted[0]?.pid).toBeUndefined();
  });

  it('an array with one good entry and one invalid one returns the good one and reports the other with a reason (D-022)', () => {
    const validItem = {
      pid: 12345,
      cwd: 'c:\\code\\projeto',
      kind: 'interactive',
      startedAt: 1755360000000,
      sessionId: '22222222-2222-4222-8222-222222222222',
      name: 'projeto-03',
    };
    const invalidItem = { cwd: 'c:\\code\\outro-projeto', startedAt: 1755360100000 }; // no sessionId

    const result = validateAgentsJsonOutput([validItem, invalidItem]);

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.sessionId).toBe('22222222-2222-4222-8222-222222222222');
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.raw).toStrictEqual(invalidItem);
    expect(result.rejected[0]?.reason).toEqual(expect.any(String));
    expect(result.rejected[0]?.reason.length).toBeGreaterThan(0);
  });

  it('mixes the interactive and background variants in the same array (D-022)', () => {
    const result = validateAgentsJsonOutput([
      {
        pid: 12345,
        cwd: 'c:\\code\\projeto',
        kind: 'interactive',
        startedAt: 1755360000000,
        sessionId: '33333333-3333-4333-8333-333333333333',
        name: 'projeto-03',
        status: 'busy',
      },
      backgroundSampleFromTheSecondMachine,
    ]);

    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it('does not throw and reports a single rejected entry when the value is not even an array', () => {
    const result = validateAgentsJsonOutput({ this: 'is not an array' });

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });
});
