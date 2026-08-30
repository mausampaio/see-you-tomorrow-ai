/**
 * `normalizeCwdForComparison` (S3-T5). Every case below is exercised with BOTH `'win32'` and
 * `'posix'` hints explicitly, from whichever OS this suite happens to run on — the platform is a
 * parameter precisely so a Windows-only defect can't hide on Linux CI the way S2-T1's did
 * (docs/PLANO-DE-ENTREGA.md S2-T1: a symlink-only bug that only showed on macOS, a short-path-only
 * bug that only showed on one Windows runner).
 */
import { describe, expect, it } from 'vitest';
import { normalizeCwdForComparison } from '../../../src/core/cwd-normalization.js';

describe('normalizeCwdForComparison', () => {
  it('unifies backslash and forward-slash separators, on both platform hints', () => {
    expect(normalizeCwdForComparison('c:\\code\\project', 'win32')).toBe(
      normalizeCwdForComparison('c:/code/project', 'win32'),
    );
    expect(normalizeCwdForComparison('/home/x/code/project', 'posix')).toBe(
      normalizeCwdForComparison('/home/x\\code\\project', 'posix'),
    );
  });

  it('strips a trailing separator (either style), on both platform hints', () => {
    expect(normalizeCwdForComparison('c:\\code\\project\\', 'win32')).toBe(
      normalizeCwdForComparison('c:\\code\\project', 'win32'),
    );
    expect(normalizeCwdForComparison('/home/x/code/project/', 'posix')).toBe(
      normalizeCwdForComparison('/home/x/code/project', 'posix'),
    );
  });

  it('keeps a bare root as a single slash, never collapsing it to empty', () => {
    expect(normalizeCwdForComparison('/', 'posix')).toBe('/');
    expect(normalizeCwdForComparison('//', 'posix')).toBe('/');
  });

  it('folds case ONLY on the win32 hint — NTFS is case-insensitive, POSIX filesystems are not', () => {
    expect(normalizeCwdForComparison('C:\\Code\\Project', 'win32')).toBe(
      normalizeCwdForComparison('c:\\code\\project', 'win32'),
    );
    expect(normalizeCwdForComparison('/Home/X/Project', 'posix')).not.toBe(
      normalizeCwdForComparison('/home/x/project', 'posix'),
    );
  });

  it('combines separator, trailing-slash and case differences into the same normalized value (win32)', () => {
    const messy = 'C:/Code/Project/';
    const clean = 'c:\\code\\project';
    expect(normalizeCwdForComparison(messy, 'win32')).toBe(
      normalizeCwdForComparison(clean, 'win32'),
    );
  });

  it('two genuinely different directories never normalize to the same value, on either hint', () => {
    expect(normalizeCwdForComparison('c:\\code\\alpha', 'win32')).not.toBe(
      normalizeCwdForComparison('c:\\code\\beta', 'win32'),
    );
    expect(normalizeCwdForComparison('/code/alpha', 'posix')).not.toBe(
      normalizeCwdForComparison('/code/beta', 'posix'),
    );
  });

  /**
   * The exact real-world case that motivated S3-T5: a `C:\Users\<usuario>` argument arrives in
   * `process.argv` as `C:Users<usuario>` once a Git Bash shell eats the backslashes. This is NOT a
   * spelling difference this function can bridge — there is no separator left to unify — and it
   * shouldn't be: the value that arrived genuinely isn't the same string as any real `cwd`. What
   * matters is that normalizing it doesn't ACCIDENTALLY make it collide with something real.
   */
  it('a shell-mangled value with no separators left does not spuriously match a real cwd', () => {
    const mangled = 'C:Users<usuario>';
    const real = 'C:\\Users\\<usuario>';
    expect(normalizeCwdForComparison(mangled, 'win32')).not.toBe(
      normalizeCwdForComparison(real, 'win32'),
    );
  });
});
