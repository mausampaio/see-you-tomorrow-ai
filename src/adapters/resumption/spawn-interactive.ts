/**
 * The one place `adapters/resumption` calls `node:child_process.spawn` (AGENTS.md § "Processos":
 * array arguments, `shell: false`). Everything else in this directory builds arguments, env, or
 * the fallback's context file; this file is the only one that touches a real process.
 *
 * **`stdio: 'inherit'`, never `'pipe'` — the load-bearing fact of this whole adapter.**
 * docs/spikes/H-retomada-interativa.md measured that a piped `claude --resume` (no real terminal
 * attached) detects the absence of a TTY and silently degrades: it answers once, in plain text,
 * and exits — never opening an actual interactive session. Handing the child the real terminal
 * (the same one `seeya` itself is running in) is the only way measured to get a genuine,
 * continuable session. The direct consequence: this module never sees the child's stdout or
 * stderr — they go straight to the same screen the user is already looking at — so it can only
 * ever report an exit code, never a message.
 */
import { spawn } from 'node:child_process';

export interface SpawnInteractiveOptions {
  readonly claudeBinary: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Overridable for tests — a real assertion of "closed after the grace period" would otherwise
   * need to wait out the full production value on every run. Defaults to
   * `FAST_FAILURE_GRACE_MS`. */
  readonly fastFailureGraceMs?: number;
}

export interface InteractiveRunResult {
  readonly exitCode: number;
  /**
   * Whether the process closed before `FAST_FAILURE_GRACE_MS` elapsed. Spike H measured an
   * unresumable session (`--resume` on an id that doesn't exist) failing in under two seconds,
   * with no model call and no real interaction — a genuine interactive session runs far longer
   * than that no matter how it ends. Only meaningful together with a non-zero `exitCode`: a fast,
   * *successful* exit (someone typing `/exit` within a second of opening) is not a failure signal
   * either, and `resumer.ts` checks both together, never `failedFast` alone.
   *
   * A spawn that never starts at all (`error` event — missing binary, missing `cwd`) is reported
   * the same way, as `exitCode: -1, failedFast: true`: from this port's caller's point of view, a
   * `claude` that never started and a `claude` that started and immediately gave up both mean the
   * same thing — this attempt didn't produce a session.
   */
  readonly failedFast: boolean;
}

/** D-019 note: this measures elapsed wall time without reading "now" anywhere. Same technique
 * `adapters/generation/spawn-claude.ts` already uses for its hard timeout — `AbortSignal.timeout`
 * is a different global than `setTimeout`/`Date.now()`, so it doesn't trip the
 * `no-restricted-syntax` guard those two are banned by name outside `adapters/clock/`. Unlike that
 * timeout, this signal is never passed to `spawn`'s own `signal` option: it must never kill the
 * child, only mark whether it closed before the grace period — a real session left running is the
 * success case, not a timeout to enforce. */
export const FAST_FAILURE_GRACE_MS = 5_000;

/**
 * Spawns `claudeBinary` with `args`, stdio fully inherited from `seeya`'s own process, and
 * resolves once the child closes — normally, or via the `error` event when it never started at
 * all. Never rejects: both outcomes are ordinary results this port's callers branch on, not
 * exceptional conditions (contrast with `adapters/generation/spawn-claude.ts#spawnClaude`, which
 * rejects, because generation has an unambiguous timeout to distinguish from a real failure; this
 * port only ever has "closed fast" vs. "closed after real use", and `resumer.ts` is what decides
 * what each one means).
 */
export function runInteractive(options: SpawnInteractiveOptions): Promise<InteractiveRunResult> {
  const { claudeBinary, args, cwd, env, fastFailureGraceMs = FAST_FAILURE_GRACE_MS } = options;
  const gracePeriodExpired = AbortSignal.timeout(fastFailureGraceMs);
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(claudeBinary, [...args], {
      cwd,
      env,
      shell: false,
      stdio: 'inherit',
    });
    child.on('error', () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ exitCode: -1, failedFast: true });
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ exitCode: code ?? -1, failedFast: !gracePeriodExpired.aborted });
    });
  });
}
