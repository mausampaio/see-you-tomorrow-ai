/**
 * Builds the environment handed to the spawned `claude` process (D-017). `seeya` spawns `claude`
 * to generate handoffs, and the daemon is very likely started from inside a Claude Code session
 * itself (this project is developed that way) — without this, the child inherits
 * `CLAUDE_CODE_CHILD_SESSION` and loses its transcript (Spike D), silently. Observed live on this
 * machine while implementing this task: `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`,
 * `CLAUDE_PID` and `CLAUDECODE` were all set in the very shell used to spawn `claude` for the
 * manual measurements this task's docstrings cite.
 *
 * Pure and synchronous on purpose: no I/O, easy to unit-test (docs/TESTES.md § Unidade,
 * "Sanitização de ambiente (D-017)") without spawning anything real.
 */

/** D-017's exact list — session-identity variables a parent Claude Code process sets that a
 * spawned `claude` must never inherit. */
const INHERITED_SESSION_VARS = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_PID',
  'CLAUDECODE',
  'CLAUDE_AGENT_SDK_VERSION',
] as const;

/** Which capture strategy is spawning `claude` — decides which persistence signal D-017's table
 * adds on top of the stripped base environment. */
export type GenerationMode = 'lean' | 'deep';

/**
 * Starts from `baseEnv` (the real `process.env` in production, a synthetic one in tests),
 * removes every variable in `INHERITED_SESSION_VARS`, and adds the one persistence signal D-017
 * prescribes for `mode` — `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` for `deep` (the fork must
 * exist to `--resume` later); nothing for `lean`, whose disposable-session flag
 * (`--no-session-persistence`) is a CLI argument, not an environment variable — see
 * `args.ts`.
 */
export function buildGenerationEnv(
  baseEnv: NodeJS.ProcessEnv,
  mode: GenerationMode,
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = { ...baseEnv };
  for (const name of INHERITED_SESSION_VARS) {
    delete sanitized[name];
  }
  if (mode === 'deep') {
    sanitized['CLAUDE_CODE_FORCE_SESSION_PERSISTENCE'] = '1';
  }
  return sanitized;
}
