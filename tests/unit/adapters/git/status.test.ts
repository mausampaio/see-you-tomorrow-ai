import { describe, expect, it } from 'vitest';
import { parseStatusPorcelain } from '../../../../src/adapters/git/status.js';

describe('parseStatusPorcelain', () => {
  it('empty output means no modified files', () => {
    expect(parseStatusPorcelain('')).toStrictEqual([]);
  });

  it('a single modified tracked file', () => {
    expect(parseStatusPorcelain(' M src/a.ts\n')).toStrictEqual(['src/a.ts']);
  });

  it('an untracked file is included (dirty covers untracked work, not just tracked changes)', () => {
    expect(parseStatusPorcelain('?? src/new-file.ts\n')).toStrictEqual(['src/new-file.ts']);
  });

  it('a staged rename keeps the destination path, not the source', () => {
    expect(parseStatusPorcelain('R  old-name.ts -> new-name.ts\n')).toStrictEqual(['new-name.ts']);
  });

  it('multiple entries, each on its own line', () => {
    const stdout = ' M src/a.ts\n?? src/b.ts\nA  src/c.ts\n';
    expect(parseStatusPorcelain(stdout)).toStrictEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('tolerates trailing CRLF line endings', () => {
    expect(parseStatusPorcelain(' M src/a.ts\r\n')).toStrictEqual(['src/a.ts']);
  });
});
