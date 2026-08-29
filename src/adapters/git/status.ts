/**
 * `git status --porcelain=v1`, parsed into the list of changed paths `facts.git.modifiedFiles`
 * persists (docs/ESPECIFICACAO.md § "Formato do handoff"). `--porcelain=v1` (not the newer `v2`)
 * because its two-letter-status-then-space-then-path shape is exactly what's needed here and is
 * guaranteed stable across git versions ("designed to be used by scripts", per git's own docs).
 * Untracked files are included on purpose: the default `--porcelain` reports them as `??`, and an
 * untracked file the user hasn't committed yet is exactly the kind of pending work `dirty` exists
 * to surface.
 *
 * **Known limitation.** A path containing a literal newline or a `"` gets C-style-quoted by git
 * (`core.quotepath`'s formatting) rather than printed raw; this parser doesn't unescape that
 * quoting, so such a path would come through with its quotes and escapes still in it. Genuinely
 * rare in practice, and not part of docs/TESTES.md's mandatory `git/` fixture — flagged here so
 * the gap is visible, not silently unhandled (AGENTS.md § "Comentários": "diga onde o guarda-corpo
 * termina").
 */
import { runGit } from './run-git.js';

/** For a rename ("R  old -> new"), keeps the destination path — the file's current name. */
function pathFromStatusLine(line: string): string {
  const path = line.slice(3);
  const arrow = path.indexOf(' -> ');
  return arrow === -1 ? path : path.slice(arrow + ' -> '.length);
}

export function parseStatusPorcelain(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0)
    .map(pathFromStatusLine);
}

/**
 * Never throws: empty on any failure, including `git` never producing a real exit code at all
 * (`ran: false`) — "no modified files known", not "clean" (D-025's least-specific answer, since
 * this type has no third "unknown" state to fall back on). The per-worktree pipeline that needs to
 * tell a missing directory apart from a real, quiet worktree checks `runGit` directly instead of
 * going through this function — see `git-adapter.ts#readWorktreeFacts` (D-022).
 */
export async function readModifiedFiles(workingDir: string): Promise<string[]> {
  const result = await runGit(workingDir, ['status', '--porcelain=v1']);
  if (!result.ran) {
    return [];
  }
  return parseStatusPorcelain(result.stdout);
}
