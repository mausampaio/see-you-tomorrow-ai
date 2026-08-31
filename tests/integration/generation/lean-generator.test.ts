/**
 * `LeanHandoffGenerator` against a REAL spawned process (a fake `claude` on PATH, docs/TESTES.md
 * § `generation/`) — no test here or anywhere else in the suite calls the real API
 * (CLAUDE.md / docs/PLANO-DE-ENTREGA.md).
 *
 * The first `describe` block is the task's centerpiece (D-015): proof that a prompt containing a
 * newline, both quote styles, `%` and accented text reaches the child process byte-for-byte,
 * inspected on the RECEIVING end (the fake `claude`'s own capture of what it got), not just on
 * the sending end.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LeanHandoffGenerator } from '../../../src/adapters/generation/lean-generator.js';
import { GenerationError } from '../../../src/adapters/generation/errors.js';
import { buildLeanPrompt } from '../../../src/adapters/generation/prompt.js';
import type { SessionFacts, SessionWithoutPid } from '../../../src/core/types.js';
import {
  createFakeClaudeFixture,
  readCapturedClaudeCall,
  removeFakeClaudeFixture,
  type FakeClaudeFixture,
} from './_fixtures.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

/** Env vars this file may set on the TEST process before spawning (mirroring D-017's own list
 * plus this fixture's own control vars) — every one of them is deleted in `afterEach` so no test
 * leaks state into the next one, even though vitest's default pool isolates files from each other
 * (AGENTS.md § Testes: "independente" is taken seriously). */
const ENV_VARS_UNDER_TEST = [
  'FAKE_CLAUDE_MODE',
  'FAKE_CLAUDE_STDOUT',
  'FAKE_CLAUDE_EXIT_CODE',
  'FAKE_CLAUDE_CAPTURE_FILE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_PID',
  'CLAUDECODE',
  'CLAUDE_AGENT_SDK_VERSION',
] as const;

function session(overrides: Partial<SessionWithoutPid> = {}): SessionWithoutPid {
  return {
    hasPid: false,
    sessionId: SESSION_ID,
    // A real, existing directory: this becomes the child process's `cwd`.
    cwd: process.cwd(),
    name: 'projeto-01',
    hasTranscript: true,
    lastTranscriptWrite: new Date('2026-08-16T10:00:00.000Z'),
    lastActivity: new Date('2026-08-16T10:00:00.000Z'),
    ...overrides,
  };
}

function facts(overrides: Partial<SessionFacts> = {}): SessionFacts {
  return {
    lastActivity: new Date('2026-08-16T10:00:00.000Z'),
    lastPrompts: [],
    assistantMessages: [],
    touchedFiles: [],
    ...overrides,
  };
}

function canonicalSuccessStdout(): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1200,
    num_turns: 1,
    result: JSON.stringify({
      understanding: 'Working on the lean generator.',
      pendingItems: ['write tests'],
      tomorrowPlan: ['finish tests'],
    }),
    session_id: '22222222-2222-4222-8222-222222222222',
    total_cost_usd: 0.02,
    usage: {
      input_tokens: 9,
      output_tokens: 40,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: '33333333-3333-4333-8333-333333333333',
  });
}

let fixture: FakeClaudeFixture;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  fixture = await createFakeClaudeFixture();
  savedEnv = Object.fromEntries(ENV_VARS_UNDER_TEST.map((name) => [name, process.env[name]]));
  process.env['FAKE_CLAUDE_CAPTURE_FILE'] = fixture.captureFile;
});

afterEach(async () => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await removeFakeClaudeFixture(fixture);
});

function generator(): LeanHandoffGenerator {
  return new LeanHandoffGenerator({
    model: 'sonnet',
    budgetPerSessionUsd: 0.25,
    claudeBinary: fixture.binaryPath,
  });
}

describe('LeanHandoffGenerator — D-015: stdin integrity, the heart of S2-T2', () => {
  it('a prompt with a newline, both quote styles, % and accented text reaches the child byte-for-byte', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'success';
    process.env['FAKE_CLAUDE_STDOUT'] = canonicalSuccessStdout();
    const trickyPrompt =
      'line one\nline two with "double" and \'single\' quotes and % percent and ' +
      'acentuação: café ação, coração, não';
    const testSession = session();
    const testFacts = facts({ lastPrompts: [trickyPrompt], touchedFiles: [] });
    const expectedStdin = buildLeanPrompt(testSession, testFacts);
    expect(expectedStdin).toContain(trickyPrompt);

    await generator().generate(testSession, testFacts);

    const captured = await readCapturedClaudeCall(fixture);
    expect(captured.stdin).toBe(expectedStdin);
    expect(captured.stdin).toContain(trickyPrompt);
    // Assert the exact substring boundary too — a mangled shell would have split on the space
    // after "Vamos"-equivalent text (Spike C's actual failure) rather than truncating cleanly.
    expect(captured.stdin.split('\n')).toContain(
      'line two with "double" and \'single\' quotes and % percent and acentuação: café ação, ' +
        'coração, não',
    );
  });
});

describe('LeanHandoffGenerator — D-017: the child never inherits session-identity variables', () => {
  it('CLAUDE_CODE_CHILD_SESSION/SESSION_ID/PID/CLAUDECODE on the parent do not reach the child', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'success';
    process.env['FAKE_CLAUDE_STDOUT'] = canonicalSuccessStdout();
    process.env['CLAUDE_CODE_CHILD_SESSION'] = '1';
    process.env['CLAUDE_CODE_SESSION_ID'] = 'parent-session-id';
    process.env['CLAUDE_PID'] = '99999';
    process.env['CLAUDECODE'] = '1';

    await generator().generate(session(), facts());

    const captured = await readCapturedClaudeCall(fixture);
    expect(captured.env['CLAUDE_CODE_CHILD_SESSION']).toBeUndefined();
    expect(captured.env['CLAUDE_CODE_SESSION_ID']).toBeUndefined();
    expect(captured.env['CLAUDE_PID']).toBeUndefined();
    expect(captured.env['CLAUDECODE']).toBeUndefined();
  });

  it('lean mode passes --no-session-persistence and never sets the force-persistence variable', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'success';
    process.env['FAKE_CLAUDE_STDOUT'] = canonicalSuccessStdout();

    await generator().generate(session(), facts());

    const captured = await readCapturedClaudeCall(fixture);
    expect(captured.argv).toContain('--no-session-persistence');
    expect(captured.env['CLAUDE_CODE_FORCE_SESSION_PERSISTENCE']).toBeUndefined();
  });
});

describe('LeanHandoffGenerator — the three failure fixtures, none a silent success', () => {
  it('valid JSON, valid understanding: resolves with the parsed fields', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'success';
    process.env['FAKE_CLAUDE_STDOUT'] = canonicalSuccessStdout();

    const result = await generator().generate(session(), facts());

    expect(result).toStrictEqual({
      understanding: 'Working on the lean generator.',
      pendingItems: ['write tests'],
      tomorrowPlan: ['finish tests'],
    });
  });

  it('invalid JSON on stdout: rejects with a GenerationError, never a fabricated result', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'invalid-json';

    const call = generator().generate(session(), facts());

    await expect(call).rejects.toThrow(GenerationError);
    await expect(call).rejects.toMatchObject({ reason: { kind: 'invalidJson' } });
  });

  it('non-zero exit code: rejects naming the exit code and stderr, never a fabricated result', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'nonzero';
    process.env['FAKE_CLAUDE_EXIT_CODE'] = '7';

    const call = generator().generate(session(), facts());

    await expect(call).rejects.toMatchObject({ reason: { kind: 'nonZeroExit', exitCode: 7 } });
    const error = await call.catch((error: unknown) => error);
    expect(error).toBeInstanceOf(GenerationError);
    if (error instanceof GenerationError && error.reason.kind === 'nonZeroExit') {
      expect(error.reason.stderr).toContain('simulated failure');
    }
  });

  it('non-zero exit code with an unreadable stdout: rejects as nonZeroExit with the raw stdout attached', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'nonzero';
    process.env['FAKE_CLAUDE_EXIT_CODE'] = '1';
    process.env['FAKE_CLAUDE_STDOUT'] = 'not json at all {{{';

    const call = generator().generate(session(), facts());

    await expect(call).rejects.toMatchObject({ reason: { kind: 'nonZeroExit', exitCode: 1 } });
    const error = await call.catch((error: unknown) => error);
    if (error instanceof GenerationError && error.reason.kind === 'nonZeroExit') {
      expect(error.reason.stdout).toContain('not json at all {{{');
    }
  });

  // S4-T00d's regression test: a real capture failed with exit code 1 and `claude` had actually
  // written a `--output-format json` envelope (`is_error: true`, `subtype`, `result`) to stdout —
  // evidence the previous version of run-generation.ts never looked at, because it treated a
  // non-zero exit code as its own terminal failure. This is that exact shape, reproduced through
  // the fake claude binary rather than by asserting against the real captured session (no real
  // session output goes into a fixture, per AGENTS.md's local-terms guard).
  it('non-zero exit code with a valid is_error envelope on stdout: rejects as modelReportedError, not nonZeroExit', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'nonzero';
    process.env['FAKE_CLAUDE_EXIT_CODE'] = '1';
    process.env['FAKE_CLAUDE_STDOUT'] = JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      duration_ms: 400,
      num_turns: 1,
      result: 'budget exhausted before the turn completed',
      session_id: '22222222-2222-4222-8222-222222222222',
      total_cost_usd: 0.25,
      usage: {
        input_tokens: 9,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      modelUsage: {},
      permission_denials: [],
      uuid: '33333333-3333-4333-8333-333333333333',
    });

    const call = generator().generate(session(), facts());

    await expect(call).rejects.toMatchObject({
      reason: {
        kind: 'modelReportedError',
        subtype: 'error_during_execution',
        exitCode: 1,
      },
    });
    const error = await call.catch((error: unknown) => error);
    expect(error).toBeInstanceOf(GenerationError);
    if (error instanceof GenerationError && error.reason.kind === 'modelReportedError') {
      expect(error.message).toContain('budget exhausted before the turn completed');
      expect(error.message).not.toContain('(empty)');
    }
  });

  it('a process that hangs: rejects with a timeout once the hard deadline passes, never hangs the caller', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'hang';
    const shortTimeoutGenerator = new LeanHandoffGenerator({
      model: 'sonnet',
      budgetPerSessionUsd: 0.25,
      claudeBinary: fixture.binaryPath,
      timeoutMs: 300,
    });

    const call = shortTimeoutGenerator.generate(session(), facts());

    await expect(call).rejects.toMatchObject({ reason: { kind: 'timeout', timeoutMs: 300 } });
  });

  it('valid JSON but is_error: true (model gave up): rejects naming the subtype, never resolves', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'success';
    process.env['FAKE_CLAUDE_STDOUT'] = JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      duration_ms: 800,
      num_turns: 50,
      result: 'gave up after 50 turns',
      session_id: '22222222-2222-4222-8222-222222222222',
      total_cost_usd: 0.3,
      usage: {
        input_tokens: 9,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      modelUsage: {},
      permission_denials: [],
      uuid: '33333333-3333-4333-8333-333333333333',
    });

    const call = generator().generate(session(), facts());

    await expect(call).rejects.toMatchObject({
      reason: { kind: 'modelReportedError', subtype: 'error_max_turns' },
    });
  });

  it('valid JSON but missing a required field (session_id): rejects as an invalid output shape', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'success';
    const withoutSessionId = JSON.parse(canonicalSuccessStdout()) as Record<string, unknown>;
    delete withoutSessionId['session_id'];
    process.env['FAKE_CLAUDE_STDOUT'] = JSON.stringify(withoutSessionId);

    const call = generator().generate(session(), facts());

    await expect(call).rejects.toMatchObject({ reason: { kind: 'invalidOutputShape' } });
  });

  it('the understanding payload does not match {understanding, pendingItems, tomorrowPlan}: rejects', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'success';
    const output = JSON.parse(canonicalSuccessStdout()) as Record<string, unknown>;
    output['result'] = JSON.stringify({ somethingElse: true });
    process.env['FAKE_CLAUDE_STDOUT'] = JSON.stringify(output);

    const call = generator().generate(session(), facts());

    await expect(call).rejects.toMatchObject({ reason: { kind: 'invalidUnderstandingShape' } });
  });

  it('prefers structured_output over parsing result, when both are present', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'success';
    const output = JSON.parse(canonicalSuccessStdout()) as Record<string, unknown>;
    output['structured_output'] = {
      understanding: 'from structured_output',
      pendingItems: [],
      tomorrowPlan: [],
    };
    process.env['FAKE_CLAUDE_STDOUT'] = JSON.stringify(output);

    const result = await generator().generate(session(), facts());

    expect(result.understanding).toBe('from structured_output');
  });
});

describe('LeanHandoffGenerator — the binary itself is missing', () => {
  it('a claudeBinary that does not exist on disk rejects with a spawnError, never hangs', async () => {
    const missingBinaryGenerator = new LeanHandoffGenerator({
      model: 'sonnet',
      budgetPerSessionUsd: 0.25,
      claudeBinary: `${fixture.dir}/does-not-exist-claude`,
    });

    const call = missingBinaryGenerator.generate(session(), facts());

    await expect(call).rejects.toMatchObject({ reason: { kind: 'spawnError' } });
  });
});
