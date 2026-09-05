import { describe, expect, it } from 'vitest';
import {
  captureObservedProcStart,
  parseLinuxProcStat,
} from '../../../../src/adapters/process/proc-start.js';
import type { CommandRunner } from '../../../../src/adapters/process/spawn-stdout.js';

describe('parseLinuxProcStat', () => {
  it('parses a normal /proc/<pid>/stat line (comm has no special characters)', () => {
    // Real line, captured from /proc/self/stat in a node:22-bookworm container (`cat` process).
    const line =
      '8 (cat) R 1 1 1 0 -1 4194304 79 0 2 0 0 0 0 0 20 0 1 0 13055756 2695168 256 ' +
      '18446744073709551615 111387769901056 111387769920937 140722934050528 0 0 0 0 0 0 0 0 0 ' +
      '17 3 0 0 0 0 0 111387769936944 111387769938560 111388053409792 140722934054701 ' +
      '140722934054721 140722934054721 140722934054891 0';
    expect(parseLinuxProcStat(line)).toBe('13055756');
  });

  /**
   * The pitfall this parser exists for. Reproduced independently (not just trusted from the
   * spike): a binary renamed to `weird (name) here` inside a node:22-bookworm container produces
   * exactly this `comm` shape — truncated to 15 bytes, closing paren kept, with an *internal*
   * `(`/`)` pair. Splitting on the first `)` would read field 22 as "1" (garbage from inside
   * `comm`); `lastIndexOf(')')` reads the real starttime.
   */
  it('a comm field containing its own parentheses does not shift field 22 (docs/spikes/F)', () => {
    const line =
      '10 (weird (name) he) S 1 1 1 0 -1 4194304 97 0 0 0 0 0 0 0 20 0 1 0 13059091 2551808 320 ' +
      '18446744073709551615 95691768799232 95691768817161 140724559975136 0 0 0 0 6 0 1 0 0 17 6 ' +
      '0 0 0 0 0 95691768831248 95691768832512 95692105560064 140724559978260 140724559978285 ' +
      '140724559978285 140724559978465 0';
    expect(parseLinuxProcStat(line)).toBe('13059091');
  });

  it('a comm field containing a space, but no internal parens, still parses correctly', () => {
    const line = '9 (my process) S 1 1 1 0 -1 4194304 100 0 0 0 0 0 0 0 20 0 1 0 42';
    expect(parseLinuxProcStat(line)).toBe('42');
  });

  it('a line with no closing paren at all does not parse (malformed input, not a guess)', () => {
    expect(parseLinuxProcStat('garbage without the expected shape')).toBeUndefined();
  });
});

/**
 * `captureObservedProcStart`'s failure-disambiguation logic (afterFailure in proc-start.ts) is
 * exercised here with a PID that cannot possibly be real (way past any platform's PID_MAX) —
 * every platform's lookup genuinely fails against it, which portably drives every capture
 * strategy into its failure path without needing describe.skipIf. What's being tested is only
 * that the outcome is correctly labeled `processGone` vs `unavailable` based on the injected
 * `recheck` — never the specific OS error text, and (S4-T0f, Q-047) never by way of a real
 * subprocess.
 *
 * **`unavailableRun` stands in for Windows' `powershell.exe` only.** Before this test injected
 * `run`, the `win32` case measured 500-880ms per call on a warm machine — a real `powershell.exe`
 * launch, twice per file — well past what `docs/TESTES.md` promises for the unit faixa ("sem
 * I/O") and exactly what turned one CI run red with vitest's unbudgeted 5000ms default
 * (docs/PLANO-DE-ENTREGA.md S4-T0f). `captureWindows` calls `run` instead of `runForStdout`
 * directly for precisely this reason; production leaves `run` at its default (the real
 * `runForStdout`) and only this test substitutes a fake that resolves instantly with no usable
 * output, driving the exact same failure branch a real, absent PID would. `linux` and `darwin`
 * don't take `run` at all (`unavailableRun` is passed anyway, for a uniform `it.each` call, and is
 * simply ignored on those two branches) — `linux` still reads `/proc/<pid>/stat` for real (a
 * single failed `fs.readFile`, not a spawn) and `darwin` still spawns real `ps` (27-29ms measured,
 * nowhere near `powershell.exe`'s cost, and this is what keeps
 * `spawn-stdout.ts#runForStdout`'s own failure branch covered — see Q-047).
 */
describe('captureObservedProcStart — failure disambiguation, no real subprocess', () => {
  const IMPOSSIBLE_PID = 999_999_999;
  const unavailableRun: CommandRunner = () => Promise.resolve(undefined);
  const neverCalledRun: CommandRunner = () =>
    Promise.reject(new Error('unit test: run() must not be called for an unrecognized platform'));

  it.each(['linux', 'darwin', 'win32'] as const)(
    '%s: recheck says the PID is gone -> "processGone", not "unavailable"',
    async (platform) => {
      const recheck = () => Promise.resolve(false);
      const result = await captureObservedProcStart(
        IMPOSSIBLE_PID,
        recheck,
        platform,
        unavailableRun,
      );
      expect(result).toEqual({ kind: 'processGone' });
    },
  );

  it.each(['linux', 'darwin', 'win32'] as const)(
    '%s: recheck says the PID still exists -> "unavailable" (D-025), never "processGone"',
    async (platform) => {
      const recheck = () => Promise.resolve(true);
      const result = await captureObservedProcStart(
        IMPOSSIBLE_PID,
        recheck,
        platform,
        unavailableRun,
      );
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.reason.length).toBeGreaterThan(0);
      }
    },
  );

  it('an unrecognized platform is "unavailable" without even calling recheck or run', async () => {
    const recheck = () => Promise.reject(new Error('should not be called'));
    const result = await captureObservedProcStart(IMPOSSIBLE_PID, recheck, 'plan9', neverCalledRun);
    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'no procStart capture strategy for platform "plan9"',
    });
  });
});
