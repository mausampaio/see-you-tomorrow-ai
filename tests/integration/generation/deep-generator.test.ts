/**
 * `DeepHandoffGenerator` against a real spawned fake `claude` (docs/TESTES.md § `generation/`).
 * Two concerns unique to the deep variant, on top of everything `lean-generator.test.ts` already
 * covers via the shared `run-generation.ts` path: the `--resume`/`--fork-session`/`--session-id`
 * arguments and `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` (D-017's other table row), and D-012's
 * fork registration — including the robustness property that registration survives a `claude`
 * call that later fails or hangs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeepHandoffGenerator } from '../../../src/adapters/generation/deep-generator.js';
import { FakeClock } from '../discovery/_fake-clock.js';
import type { SessionWithoutPid } from '../../../src/core/types.js';
import {
  createFakeClaudeFixture,
  readCapturedClaudeCall,
  removeFakeClaudeFixture,
  type FakeClaudeFixture,
} from './_fixtures.js';

const ORIGINAL_SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-08-16T21:00:00.000Z');

const ENV_VARS_UNDER_TEST = [
  'FAKE_CLAUDE_MODE',
  'FAKE_CLAUDE_STDOUT',
  'FAKE_CLAUDE_EXIT_CODE',
  'FAKE_CLAUDE_CAPTURE_FILE',
] as const;

function session(overrides: Partial<SessionWithoutPid> = {}): SessionWithoutPid {
  return {
    hasPid: false,
    sessionId: ORIGINAL_SESSION_ID,
    cwd: process.cwd(),
    name: 'projeto-01',
    hasTranscript: true,
    lastTranscriptWrite: NOW,
    lastActivity: NOW,
    ...overrides,
  };
}

function canonicalSuccessStdout(sessionId: string): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1200,
    num_turns: 1,
    result: JSON.stringify({ understanding: 'resumed.', pendingItems: [], tomorrowPlan: [] }),
    session_id: sessionId,
    total_cost_usd: 0.05,
    usage: {
      input_tokens: 9,
      output_tokens: 20,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: '33333333-3333-4333-8333-333333333333',
  });
}

let fixture: FakeClaudeFixture;
let seeyaHome: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  fixture = await createFakeClaudeFixture();
  seeyaHome = await mkdtemp(path.join(tmpdir(), 'seeya-deep-generator-'));
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
  await rm(seeyaHome, { recursive: true, force: true });
});

function generator(timeoutMs?: number): DeepHandoffGenerator {
  return new DeepHandoffGenerator({
    model: 'sonnet',
    budgetPerSessionUsd: 0.5,
    seeyaHome,
    clock: new FakeClock(NOW),
    claudeBinary: fixture.binaryPath,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

async function readForksJson(): Promise<{ schemaVersion: number; forks: unknown[] }> {
  const text = await readFile(path.join(seeyaHome, 'forks.json'), 'utf8');
  return JSON.parse(text) as { schemaVersion: number; forks: unknown[] };
}

describe('DeepHandoffGenerator — arguments and environment (D-011, D-017)', () => {
  it('resumes the original sessionId, forks, and assigns the fork its own --session-id', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'success';
    const call = generator().generate(session());
    // The fork id is only known once forks.json is written (before the process even starts) —
    // read it back to get the exact id this call chose, then confirm the same id was handed to
    // `claude` as --session-id and echoed back as session_id.
    await call.catch(() => undefined);
    const registry = await readForksJson();
    const forkId = (registry.forks[0] as { sessionId: string }).sessionId;

    const captured = await readCapturedClaudeCall(fixture);
    expect(captured.argv).toContain('--resume');
    expect(captured.argv[captured.argv.indexOf('--resume') + 1]).toBe(ORIGINAL_SESSION_ID);
    expect(captured.argv).toContain('--fork-session');
    expect(captured.argv).toContain('--session-id');
    expect(captured.argv[captured.argv.indexOf('--session-id') + 1]).toBe(forkId);
  });

  it('sets CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 and never passes --no-session-persistence', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'success';
    process.env['FAKE_CLAUDE_STDOUT'] = canonicalSuccessStdout(
      '44444444-4444-4444-8444-444444444444',
    );

    await generator().generate(session());

    const captured = await readCapturedClaudeCall(fixture);
    expect(captured.env['CLAUDE_CODE_FORCE_SESSION_PERSISTENCE']).toBe('1');
    expect(captured.argv).not.toContain('--no-session-persistence');
  });
});

describe('DeepHandoffGenerator — D-012: the fork is registered even when the call fails', () => {
  it('a non-zero exit still leaves the fork registered in forks.json', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'nonzero';

    await expect(generator().generate(session())).rejects.toMatchObject({
      reason: { kind: 'nonZeroExit' },
    });

    const registry = await readForksJson();
    expect(registry.schemaVersion).toBe(1);
    expect(registry.forks).toHaveLength(1);
    const entry = registry.forks[0] as { sessionId: unknown; createdAt: unknown };
    expect(typeof entry.sessionId).toBe('string');
    expect(entry.createdAt).toBe(NOW.toISOString());
  });

  it('a call that times out still leaves the fork registered — the case D-012 exists for', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'hang';

    await expect(generator(300).generate(session())).rejects.toMatchObject({
      reason: { kind: 'timeout' },
    });

    const registry = await readForksJson();
    expect(registry.forks).toHaveLength(1);
  });

  it('two successful calls each register their own fork, both using the Clock port for createdAt (D-019)', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'success';
    // `--session-id` (assigned by the generator, not by this fixture) is what determines the
    // REAL fork id in forks.json — the fake claude's own `session_id` field only has to be
    // present and well-formed for `claudePrintOutputSchema` to accept it.
    process.env['FAKE_CLAUDE_STDOUT'] = canonicalSuccessStdout(
      '44444444-4444-4444-8444-444444444444',
    );

    await generator().generate(session());
    await generator().generate(session());

    const registry = await readForksJson();
    expect(registry.forks).toHaveLength(2);
    const createdAts = registry.forks.map((entry) => (entry as { createdAt: string }).createdAt);
    expect(createdAts).toStrictEqual([NOW.toISOString(), NOW.toISOString()]);
  });
});
