/**
 * The one Node error-code idiom this adapter needs: telling "this path doesn't exist yet" (normal
 * — `~/.seeya/` or `config.json` never written on this machine) apart from every other failure
 * (permissions, disk I/O — not normal, worth surfacing instead of silently treated as "nothing
 * here").
 *
 * `adapters/discovery/fs-errors.ts` has the exact same four-line idiom. Not imported from there:
 * that decision was already made once, for `adapters/process/liveness.ts`'s copy of this same
 * idiom — see that file's comment — reaching into a sibling adapter's internals to save four
 * lines is a tighter coupling than the duplication it avoids.
 */

/**
 * Node/libuv errors are thrown as plain `Error` objects with a `.code` string bolted on
 * (`NodeJS.ErrnoException`) — `catch` can only bind `unknown`, so this narrows it once instead of
 * every call site doing it inline (AGENTS.md: `as`/casting is a sign the type is wrong, but the
 * outside world genuinely offers nothing stronger here).
 */
export function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return String(error.code);
}

/** Whether `error` is Node's "no such file or directory" — the one failure mode this adapter
 * treats as "there's nothing here yet", never as corruption. */
export function isEnoent(error: unknown): boolean {
  return nodeErrorCode(error) === 'ENOENT';
}
