import { describe, expect, it } from 'vitest';
import {
  parseLsofCwdOutput,
  parseProcCmdline,
  readCommandLine,
  readCwd,
} from '../../../../src/adapters/process/inspection.js';

describe('parseLsofCwdOutput', () => {
  it('extracts the path from the "n"-prefixed line of `lsof -Fn` output', () => {
    // Real shape: `lsof -a -p <pid> -d cwd -Fn`, one field per line.
    const output = 'p4242\nfcwd\nn/home/<usuario>/code/projeto\n';
    expect(parseLsofCwdOutput(output)).toBe('/home/<usuario>/code/projeto');
  });

  it('returns undefined when there is no "n"-prefixed line at all', () => {
    expect(parseLsofCwdOutput('p4242\nfcwd\n')).toBeUndefined();
  });

  it('returns undefined for empty output', () => {
    expect(parseLsofCwdOutput('')).toBeUndefined();
  });

  it('returns undefined when the "n" line has no path after the prefix', () => {
    expect(parseLsofCwdOutput('p4242\nfcwd\nn\n')).toBeUndefined();
  });
});

describe('parseProcCmdline', () => {
  it('joins NUL-separated arguments with a single space', () => {
    // Real shape: /proc/<pid>/cmdline, NUL-separated and NUL-terminated. Built with an array
    // join, not a literal '\02990' in the source: '\0' immediately followed by a digit is a
    // legacy octal escape in a JS string literal (`\02` becomes one control character, not NUL
    // followed by '2') — the array form sidesteps that trap instead of relying on `--item` always
    // being followed by a non-digit.
    const raw = ['node', '/code/script.mjs', '--item', '2990', ''].join('\0');
    expect(parseProcCmdline(raw)).toBe('node /code/script.mjs --item 2990');
  });

  it('preserves an argument that itself contains a space', () => {
    const raw = 'claude\0--dangerously-skip-permissions\0/agente-interno:dev --item 2990\0';
    expect(parseProcCmdline(raw)).toBe(
      'claude --dangerously-skip-permissions /agente-interno:dev --item 2990',
    );
  });

  it('returns undefined for empty input (no arguments to report)', () => {
    expect(parseProcCmdline('')).toBeUndefined();
  });

  it('returns undefined when the input is only the terminating NUL', () => {
    expect(parseProcCmdline('\0')).toBeUndefined();
  });
});

/**
 * Platform dispatch, portable across host OS the same way
 * tests/unit/adapters/process/proc-start.test.ts drives `captureObservedProcStart`: a PID that
 * cannot possibly be real makes every platform's own lookup genuinely fail, so the dispatch table
 * (and the unrecognized-platform fallback) is exercised without needing the host OS to match.
 */
describe('readCwd / readCommandLine — platform dispatch, portable across host OS', () => {
  const IMPOSSIBLE_PID = 999_999_999;

  it.each(['linux', 'darwin', 'win32'] as const)(
    '%s: a pid that cannot exist resolves to null, never throws',
    async (platform) => {
      await expect(readCwd(IMPOSSIBLE_PID, platform)).resolves.toBeNull();
      await expect(readCommandLine(IMPOSSIBLE_PID, platform)).resolves.toBeNull();
    },
  );

  it('an unrecognized platform is null without attempting any OS call', async () => {
    await expect(readCwd(IMPOSSIBLE_PID, 'plan9')).resolves.toBeNull();
    await expect(readCommandLine(IMPOSSIBLE_PID, 'plan9')).resolves.toBeNull();
  });

  it('win32 is null even for a pid that could plausibly be real (D-023, not an artifact of the impossible pid above)', async () => {
    // Unlike linux/darwin (whose null above comes from the OS genuinely failing to find
    // IMPOSSIBLE_PID), win32's dispatch functions return null unconditionally, by construction —
    // this uses an ordinary-looking pid to make sure that's the reason, not a coincidence of the
    // fake pid used elsewhere in this file.
    await expect(readCwd(4242, 'win32')).resolves.toBeNull();
    await expect(readCommandLine(4242, 'win32')).resolves.toBeNull();
  });
});
