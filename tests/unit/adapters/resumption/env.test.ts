import { describe, expect, it } from 'vitest';
import { buildResumptionEnv } from '../../../../src/adapters/resumption/env.js';

/**
 * Pure-function unit test for D-017, resumption's own spawn point (S3-T2). Mirrors
 * `tests/unit/adapters/generation/env.test.ts` — same six variables, same guarantee, different
 * caller.
 */
describe('buildResumptionEnv — D-017', () => {
  const parentEnv = {
    PATH: '/usr/bin',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_SESSION_ID: 'parent-session',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_PID: '4242',
    CLAUDECODE: '1',
    CLAUDE_AGENT_SDK_VERSION: '1.2.3',
    SOME_UNRELATED_VAR: 'kept',
  };

  it('strips every session-identity variable', () => {
    const result = buildResumptionEnv(parentEnv);
    expect(result['CLAUDE_CODE_CHILD_SESSION']).toBeUndefined();
    expect(result['CLAUDE_CODE_SESSION_ID']).toBeUndefined();
    expect(result['CLAUDE_CODE_ENTRYPOINT']).toBeUndefined();
    expect(result['CLAUDE_PID']).toBeUndefined();
    expect(result['CLAUDECODE']).toBeUndefined();
    expect(result['CLAUDE_AGENT_SDK_VERSION']).toBeUndefined();
  });

  it('keeps unrelated variables untouched', () => {
    const result = buildResumptionEnv(parentEnv);
    expect(result['PATH']).toBe('/usr/bin');
    expect(result['SOME_UNRELATED_VAR']).toBe('kept');
  });

  it('adds no persistence signal — unlike generation, a resumed session wants normal defaults', () => {
    const result = buildResumptionEnv(parentEnv);
    expect(result['CLAUDE_CODE_FORCE_SESSION_PERSISTENCE']).toBeUndefined();
  });

  it('does not mutate the input env object', () => {
    const before = { ...parentEnv };
    buildResumptionEnv(parentEnv);
    expect(parentEnv).toStrictEqual(before);
  });
});
