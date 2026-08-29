import { describe, expect, it } from 'vitest';
import { buildDeepArgs, buildLeanArgs } from '../../../../src/adapters/generation/args.js';
import { GENERATION_SYSTEM_PROMPT } from '../../../../src/adapters/generation/system-prompt.js';
import { UNDERSTANDING_JSON_SCHEMA } from '../../../../src/adapters/generation/understanding-schema.js';

const COMMON_OPTIONS = { model: 'sonnet', budgetPerSessionUsd: 0.25 };

describe('buildLeanArgs', () => {
  const args = buildLeanArgs(COMMON_OPTIONS);

  it('always runs in print+json mode with no tools (D-011)', () => {
    expect(args).toContain('-p');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
  });

  it('passes the fixed system prompt and understanding schema as arguments (short/known, D-015)', () => {
    expect(args[args.indexOf('--system-prompt') + 1]).toBe(GENERATION_SYSTEM_PROMPT);
    expect(args[args.indexOf('--json-schema') + 1]).toBe(UNDERSTANDING_JSON_SCHEMA);
  });

  it('passes model and budget straight through', () => {
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('0.25');
  });

  it('adds --no-session-persistence (D-017: lean wants no persistence at all)', () => {
    expect(args).toContain('--no-session-persistence');
  });

  it('never mentions --resume, --fork-session or --session-id', () => {
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--fork-session');
    expect(args).not.toContain('--session-id');
  });
});

describe('buildDeepArgs', () => {
  const args = buildDeepArgs({
    ...COMMON_OPTIONS,
    resumeSessionId: '11111111-1111-4111-8111-111111111111',
    forkSessionId: '22222222-2222-4222-8222-222222222222',
  });

  it('resumes the original session and forks it', () => {
    expect(args[args.indexOf('--resume') + 1]).toBe('11111111-1111-4111-8111-111111111111');
    expect(args).toContain('--fork-session');
  });

  it("assigns the fork's own --session-id", () => {
    expect(args[args.indexOf('--session-id') + 1]).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('never adds --no-session-persistence (persistence is wanted, via the env variable instead)', () => {
    expect(args).not.toContain('--no-session-persistence');
  });

  it('still carries every common flag lean does (D-011: one shared implementation underneath)', () => {
    expect(args).toContain('-p');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--system-prompt') + 1]).toBe(GENERATION_SYSTEM_PROMPT);
  });
});
