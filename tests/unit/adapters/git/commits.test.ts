import { describe, expect, it } from 'vitest';
import { parseCommitLog } from '../../../../src/adapters/git/commits.js';

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

function record(sha: string, iso: string, title: string): string {
  return `${sha}${FIELD_SEP}${iso}${FIELD_SEP}${title}${RECORD_SEP}`;
}

describe('parseCommitLog', () => {
  it('empty output is an empty list', () => {
    expect(parseCommitLog('')).toStrictEqual([]);
  });

  it('parses one record into sha/title/committedAt', () => {
    const stdout = record('1b7fd99', '2026-08-16T20:41:11-03:00', 'docs: initial spec');
    const result = parseCommitLog(stdout);

    expect(result).toStrictEqual([
      {
        sha: '1b7fd99',
        title: 'docs: initial spec',
        committedAt: new Date('2026-08-16T20:41:11-03:00'),
      },
    ]);
  });

  it('parses multiple records, in the order git printed them', () => {
    const stdout =
      record('aaa1111', '2026-08-16T10:00:00Z', 'first') +
      record('bbb2222', '2026-08-16T11:00:00Z', 'second');

    expect(parseCommitLog(stdout).map((c) => c.sha)).toStrictEqual(['aaa1111', 'bbb2222']);
  });

  it('a title containing the field separator character never occurs from real git output, but a malformed record (missing a field) is dropped rather than guessed at', () => {
    const malformed = `onlyonefield${RECORD_SEP}`;
    expect(parseCommitLog(malformed)).toStrictEqual([]);
  });

  it('tolerates trailing whitespace/newlines around records', () => {
    const stdout = `\n${record('ccc3333', '2026-08-16T09:00:00Z', 'third')}\n`;
    expect(parseCommitLog(stdout).map((c) => c.sha)).toStrictEqual(['ccc3333']);
  });
});
