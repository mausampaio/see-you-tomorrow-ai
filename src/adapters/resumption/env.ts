/**
 * Builds the environment handed to an interactively-resumed `claude` process (D-017). Reuses
 * `adapters/generation/env.ts`'s `INHERITED_SESSION_VARS` — the exact list D-017 names — rather
 * than re-declaring it: adapter-to-adapter imports are allowed by the layer matrix
 * (docs/ARQUITETURA.md; only `application/`, `cli/` and `scheduler/` are restricted from
 * `adapters/`), and a second, independently-maintained copy of the same six names is exactly the
 * kind of drift AGENTS.md's "nada de duplicação" warns about.
 *
 * **Unlike `adapters/generation/env.ts#buildGenerationEnv`, this adds no persistence signal.**
 * D-017's table (`--no-session-persistence` for lean, `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`
 * for deep) is about the headless CAPTURE call, which wants either no persistence or a forced
 * fork. An interactively resumed (or freshly opened) session is the opposite case: normal
 * persistence is exactly what's wanted, so nothing here overrides `claude`'s own default.
 */
import { INHERITED_SESSION_VARS } from '../generation/env.js';

export function buildResumptionEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = { ...baseEnv };
  for (const name of INHERITED_SESSION_VARS) {
    delete sanitized[name];
  }
  return sanitized;
}
