/**
 * The one Node error-code idiom this adapter needs, shared by every file here that has to tell
 * "this path doesn't exist" (normal — sessions dir not created yet, transcript not written,
 * forks.json never registered) apart from every other failure (permissions, disk I/O — not
 * normal, worth surfacing instead of silently treating as "nothing here").
 *
 * `adapters/process/liveness.ts` has the same four-line idiom under the name `errorCode`. Not
 * imported from there on purpose: that module is `adapters/process`'s own internal file, not
 * exported through `adapters/process/index.ts`, and reaching into a sibling adapter's internals
 * to save four lines would be a tighter coupling than the duplication it avoids.
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
