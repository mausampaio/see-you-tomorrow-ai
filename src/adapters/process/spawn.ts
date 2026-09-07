/**
 * The one place `src/` may import `spawn` from `node:child_process` outright (D-038, closing
 * Q-059 item 3). Every other call site imports `spawnHidden` from here instead.
 *
 * **Why this exists.** The technique this wraps (`windowsHide: true`) was already in the
 * repository — `console-signal.ts`'s two `spawn` calls already carried it — but nowhere made it
 * apply to everyone. The other four `spawn` calls that existed at the time (capture, git
 * evidence, liveness polling, notification) shipped without it, and the daemon's first real run
 * on Windows (S4-T6, docs/PLANO-DE-ENTREGA.md) popped a real, visible console window per live
 * session on every 30s poll, plus a burst at end-of-day — each one stealing keyboard focus from
 * whoever was typing. The defect wasn't ignorance of the technique; it was that no single place
 * made forgetting it impossible. `eslint.config.js` now bans importing `spawn` from
 * `node:child_process` anywhere in `src/` except this file and the three call sites below that
 * declare, in their own module comment, why they're exempt — the same inversion-of-onus
 * `no-restricted-syntax`/`no-restricted-globals` already does for `new Date()`/`setTimeout`
 * outside `adapters/clock/` (D-019).
 *
 * **The three declared exceptions, not wrapped here:**
 * - `daemon-launch.ts#spawnDetachedDaemon` — `detached: true` + `stdio: 'ignore'` is a different
 *   mechanism for the same result: on Windows this is `DETACHED_PROCESS`, console NONE, not a
 *   console hidden. There is nothing for `windowsHide` to hide.
 * - `termination-posix.ts#waitForExit` — POSIX-only by construction (S1-T12); `windowsHide`
 *   would be a no-op on every platform this file's code ever runs on.
 * - `resumption/spawn-interactive.ts#runInteractive` — the D-038 exception itself: the `seeya
 *   start-day` interactive session's window IS the product. Hiding it would hide the very thing
 *   the command exists to open.
 *
 * **Signature, not behavior.** This is a thin pass-through to `node:child_process.spawn`: same
 * `command`/`args`/`options` shape (`shell: false` stays the caller's job — AGENTS.md § "Processos"
 * already requires it everywhere, this file doesn't need to repeat that invariant to enforce it),
 * plus `windowsHide: true` forced on top of whatever `options` the caller passed, always last so a
 * caller can never accidentally override it. The overloads below mirror Node's own three-argument
 * `spawn` overloads (tuple `stdio`, the no-`stdio` default, and the general fallback) so a caller
 * passing a `stdio` tuple keeps exactly the non-null stream types it already had — nobody has to
 * add a null check that wasn't there before this wrapper existed (the "don't force a poor
 * signature" instruction this task shipped with). The one thing this file intentionally does NOT
 * accept is the two-argument `spawn(command, options)` form: every call site in this project
 * already passes an explicit `args` array (AGENTS.md § "Processos": "spawn com array de
 * argumentos"), so there is no caller this omission would inconvenience, and dropping it removes
 * one way a future call site could accidentally launch `command` with a shell-parsed empty
 * argument list instead of a real, reviewed array.
 *
 * **Known limitation, same class as D-019's.** The eslint rule matches a named import
 * (`import { spawn } from 'node:child_process'`), not data flow — `import * as cp from
 * 'node:child_process'; cp.spawn(...)` escapes it. Nobody writes that by accident; it isn't
 * written anywhere in this project today. The guard covers the descuido (forgetting to route
 * through this file), not a deliberate contorno, which is what code review is for — same
 * boundary D-019 already draws for its own selectors.
 */
import {
  spawn as nodeSpawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnOptionsWithoutStdio,
  type SpawnOptionsWithStdioTuple,
  type StdioNull,
  type StdioPipe,
} from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export function spawnHidden(
  command: string,
  args: readonly string[],
  options?: SpawnOptionsWithoutStdio,
): ChildProcessWithoutNullStreams;
export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
): ChildProcessByStdio<Writable, Readable, Readable>;
export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioNull>,
): ChildProcessByStdio<Writable, Readable, null>;
export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioNull, StdioPipe>,
): ChildProcessByStdio<Writable, null, Readable>;
export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>,
): ChildProcessByStdio<null, Readable, Readable>;
export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioNull, StdioNull>,
): ChildProcessByStdio<Writable, null, null>;
export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioNull>,
): ChildProcessByStdio<null, Readable, null>;
export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioNull, StdioPipe>,
): ChildProcessByStdio<null, null, Readable>;
export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioNull, StdioNull>,
): ChildProcessByStdio<null, null, null>;
export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess;
export function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  // windowsHide always wins: spread options FIRST, override after, so nothing a caller passes
  // (accidentally or otherwise) can turn visibility back on. D-038's whole point is that this
  // key can never again be the one a call site forgot.
  return nodeSpawn(command, [...args], { ...options, windowsHide: true });
}
