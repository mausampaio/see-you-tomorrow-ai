import { describe, expect, it } from 'vitest';
import { GenerationError } from '../../../../src/adapters/generation/errors.js';

/**
 * AGENTS.md § "Mensagens de erro": the message names the offending value and the expected shape,
 * not just "failed". One test per `GenerationFailureReason` kind confirms every branch of
 * `describe()` actually produces a message with the value that caused it, not a generic string.
 */
describe('GenerationError', () => {
  it('is an instance of Error with name "GenerationError"', () => {
    const error = new GenerationError({ kind: 'timeout', timeoutMs: 500 });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GenerationError');
  });

  it('spawnError: message includes the underlying spawn failure message', () => {
    const error = new GenerationError({ kind: 'spawnError', message: 'ENOENT: no such file' });
    expect(error.message).toContain('ENOENT: no such file');
  });

  it('timeout: message includes the configured timeout in ms', () => {
    const error = new GenerationError({ kind: 'timeout', timeoutMs: 1234 });
    expect(error.message).toContain('1234');
  });

  it('nonZeroExit: message includes the exit code, stderr and stdout', () => {
    const error = new GenerationError({
      kind: 'nonZeroExit',
      exitCode: 7,
      stderr: 'boom',
      stdout: 'this is not json {{{',
    });
    expect(error.message).toContain('7');
    expect(error.message).toContain('boom');
    expect(error.message).toContain('this is not json {{{');
  });

  it('nonZeroExit: empty stderr and stdout are reported explicitly, not silently omitted', () => {
    const error = new GenerationError({ kind: 'nonZeroExit', exitCode: 1, stderr: '', stdout: '' });
    const emptyMentions = error.message.match(/\(empty\)/g) ?? [];
    expect(emptyMentions).toHaveLength(2);
  });

  it('invalidJson: message includes the parse error and the raw text', () => {
    const error = new GenerationError({
      kind: 'invalidJson',
      raw: 'not json',
      message: 'Unexpected token',
    });
    expect(error.message).toContain('Unexpected token');
    expect(error.message).toContain('not json');
  });

  it('invalidOutputShape: message includes the zod validation message', () => {
    const error = new GenerationError({
      kind: 'invalidOutputShape',
      raw: { type: 'result' },
      message: 'missing session_id',
    });
    expect(error.message).toContain('missing session_id');
  });

  it('invalidUnderstandingShape: message includes the zod validation message', () => {
    const error = new GenerationError({
      kind: 'invalidUnderstandingShape',
      raw: {},
      message: 'missing understanding',
    });
    expect(error.message).toContain('missing understanding');
  });

  it('modelReportedError: message includes the exit code, the subtype and the result text', () => {
    const error = new GenerationError({
      kind: 'modelReportedError',
      subtype: 'error_max_turns',
      result: 'gave up after 50 turns',
      exitCode: 0,
    });
    expect(error.message).toContain('0');
    expect(error.message).toContain('error_max_turns');
    expect(error.message).toContain('gave up after 50 turns');
  });

  it('modelReportedError: distinguishes a clean exit from a non-zero one reporting the same subtype', () => {
    const cleanExit = new GenerationError({
      kind: 'modelReportedError',
      subtype: 'error_max_turns',
      result: 'gave up after 50 turns',
      exitCode: 0,
    });
    const nonZeroExit = new GenerationError({
      kind: 'modelReportedError',
      subtype: 'error_max_turns',
      result: 'gave up after 50 turns',
      exitCode: 1,
    });
    expect(cleanExit.message).not.toBe(nonZeroExit.message);
  });

  it('modelReportedError: result is capped so an oversized model payload cannot bloat the on-disk handoff', () => {
    const oversizedResult = 'x'.repeat(5_000);
    const error = new GenerationError({
      kind: 'modelReportedError',
      subtype: 'error_during_execution',
      result: oversizedResult,
      exitCode: 1,
    });
    expect(error.message.length).toBeLessThan(oversizedResult.length);
    expect(error.message).toContain('more characters omitted');
  });

  it('carries the structured reason for programmatic matching, not just the message', () => {
    const error = new GenerationError({ kind: 'timeout', timeoutMs: 42 });
    expect(error.reason).toStrictEqual({ kind: 'timeout', timeoutMs: 42 });
  });
});
