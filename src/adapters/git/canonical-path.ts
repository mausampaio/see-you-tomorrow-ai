/**
 * Canonical, comparable form of a path — resolves symlinks (POSIX) and expands the short 8.3 form
 * (Windows) via `fs.realpath`, which `path.resolve` alone does **neither** of. This is what
 * `git-adapter.ts#listOtherWorktrees` needs to reliably tell "this is `cwd`'s own worktree entry"
 * apart from "this is a different one" — `path.resolve` alone let the two diverge in exactly the
 * two situations a three-OS CI matrix exercises and a single developer machine usually doesn't:
 *
 * - **macOS:** `os.tmpdir()` returns `/var/folders/...`, itself a symlink to
 *   `/private/var/folders/...`. `git worktree list` reports the resolved path, so an
 *   un-resolved `cwd` never matches it (`worktrees` came back with `cwd`'s own entry duplicated
 *   in it, CI-reproduced: `expected [...] to have a length of 1 but got 2`).
 * - **Windows:** a short 8.3-form path (`C:\Users\<username>~1\...`, seen from a GitHub Actions
 *   runner) and its long form name the same directory, but `path.resolve` treats them as two
 *   different strings — same symptom, different mechanism.
 * - **Linux:** neither `/tmp` nor a typical CI runner's temp dir involves a symlink or a short
 *   name, which is exactly why this had shipped without either environment catching it.
 *
 * **This is a production defect, not a test-only one.** Any real session `cwd` that reaches this
 * adapter through a symlinked path, or through Windows' short-path form, would see its own
 * worktree duplicated in the handoff — the fix belongs here, not in loosening a test assertion.
 *
 * Case-folded on Windows on top of the realpath resolution, where the same worktree can still be
 * spelled with different casing across the two sources being compared (`git worktree list`'s own
 * output vs. the caller's `cwd`).
 */
import { realpath } from 'node:fs/promises';

/**
 * Never throws. A path that can't be resolved at all — most commonly a worktree `git worktree
 * list` still remembers whose directory is already gone from disk (D-022's rejection case) —
 * resolves to `null` rather than propagating the `realpath` failure: this function only answers
 * "what does this path canonicalize to", and "it doesn't" is a legitimate answer for it to give,
 * with the D-022 judgment about what that *means* left to the caller (`git-adapter.ts`'s worktree
 * pipeline, which already has its own rejection path for an unreachable worktree).
 */
export async function canonicalPath(rawPath: string): Promise<string | null> {
  try {
    const resolved = await realpath(rawPath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  } catch {
    return null;
  }
}

/**
 * `null` never compares equal to anything, including another `null`: two paths that both failed
 * to resolve are not thereby proven to be the *same* path (D-025 — absence of proof isn't proof
 * of sameness). Treating two `null`s as equal would silently drop a distinct, already-broken
 * worktree from `listOtherWorktrees`'s output instead of letting it flow through to become a
 * visible, countable rejection (D-022).
 */
export function sameCanonicalPath(a: string | null, b: string | null): boolean {
  return a !== null && a === b;
}
