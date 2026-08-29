import { describe, expect, it } from 'vitest';
import { buildGenerationEnv } from '../../../../src/adapters/generation/env.js';

/**
 * Pure-function unit test for D-017 (docs/TESTES.md § Unidade: "Sanitização de ambiente"). No
 * spawning here — `tests/integration/generation/*.test.ts` proves the same property end-to-end
 * against a real child process; this is the fast, precise version of the same guarantee.
 */
describe('buildGenerationEnv — D-017', () => {
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

  it('strips every session-identity variable in both modes', () => {
    for (const mode of ['lean', 'deep'] as const) {
      const result = buildGenerationEnv(parentEnv, mode);
      expect(result['CLAUDE_CODE_CHILD_SESSION']).toBeUndefined();
      expect(result['CLAUDE_CODE_SESSION_ID']).toBeUndefined();
      expect(result['CLAUDE_CODE_ENTRYPOINT']).toBeUndefined();
      expect(result['CLAUDE_PID']).toBeUndefined();
      expect(result['CLAUDECODE']).toBeUndefined();
      expect(result['CLAUDE_AGENT_SDK_VERSION']).toBeUndefined();
    }
  });

  it('keeps unrelated variables untouched', () => {
    const result = buildGenerationEnv(parentEnv, 'lean');
    expect(result['PATH']).toBe('/usr/bin');
    expect(result['SOME_UNRELATED_VAR']).toBe('kept');
  });

  it('lean mode does not add CLAUDE_CODE_FORCE_SESSION_PERSISTENCE', () => {
    const result = buildGenerationEnv(parentEnv, 'lean');
    expect(result['CLAUDE_CODE_FORCE_SESSION_PERSISTENCE']).toBeUndefined();
  });

  it("deep mode sets CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 (D-017's table)", () => {
    const result = buildGenerationEnv(parentEnv, 'deep');
    expect(result['CLAUDE_CODE_FORCE_SESSION_PERSISTENCE']).toBe('1');
  });

  it('does not mutate the input env object', () => {
    const before = { ...parentEnv };
    buildGenerationEnv(parentEnv, 'deep');
    expect(parentEnv).toStrictEqual(before);
  });

  it('an env with none of the inherited variables passes through unchanged (lean)', () => {
    const clean = { PATH: '/usr/bin', HOME: '/home/<usuario>' };
    const result = buildGenerationEnv(clean, 'lean');
    expect(result).toStrictEqual(clean);
  });
});
