import { describe, expect, it } from 'vitest';
import { isEnoent, nodeErrorCode } from '../../../../src/adapters/storage/fs-errors.js';

describe('nodeErrorCode', () => {
  it('reads .code off a Node-shaped error', () => {
    const error = Object.assign(new Error('nope'), { code: 'ENOENT' });
    expect(nodeErrorCode(error)).toBe('ENOENT');
  });

  it('returns undefined for a plain Error with no .code', () => {
    expect(nodeErrorCode(new Error('plain'))).toBeUndefined();
  });

  it('returns undefined for a non-object thrown value', () => {
    expect(nodeErrorCode('a string was thrown')).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(nodeErrorCode(null)).toBeUndefined();
  });

  it('coerces a non-string .code to a string', () => {
    const error = Object.assign(new Error('nope'), { code: 404 });
    expect(nodeErrorCode(error)).toBe('404');
  });
});

describe('isEnoent', () => {
  it('is true for ENOENT', () => {
    expect(isEnoent(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe(true);
  });

  it('is false for a different code (e.g. EPERM)', () => {
    expect(isEnoent(Object.assign(new Error('nope'), { code: 'EPERM' }))).toBe(false);
  });

  it('is false for an error with no code at all', () => {
    expect(isEnoent(new Error('plain'))).toBe(false);
  });
});
