/**
 * Comparable form of a `cwd` string — the same string, normalized just enough that two spellings
 * of the same directory compare equal (docs/PLANO-DE-ENTREGA.md S3-T5). Used wherever a `cwd` is
 * matched against another `cwd`-shaped value that may have been written by a different tool, at a
 * different time, or typed by hand: `config.json`'s `ignore` list
 * (`application/eligibility-assembly.ts`) and `--session <cwd>` (`cli/session-reference.ts`).
 *
 * **Deliberately NOT `adapters/git/canonical-path.ts#canonicalPath`.** That function resolves
 * symlinks and the Windows short (8.3) form via `fs.realpath`, which requires the path to exist on
 * disk and costs a filesystem round trip. Neither holds here: an `ignore` entry or a `--session`
 * value someone typed by hand may not exist at all — a typo, or (the case that motivated this
 * task) a value a shell mangled on the way in, e.g. `C:\Users\<user>` arriving in `process.argv` as
 * `C:Usersmausa` once a Git Bash shell ate the backslashes. Resolving a path that doesn't exist
 * would just throw and fall back to "no match" anyway (`canonicalPath` already treats that as
 * `null`); the point here is to still recognize the ordinary, existing-path spelling differences
 * without paying for a disk round trip nothing in this comparison needs.
 *
 * What this DOES fix — the same class of bug S2-T1 hit for a different reason
 * (`canonicalPath`'s own docstring), scaled down to what a hand-typed comparison actually needs:
 *
 * - **Separator.** `\` and `/` compare the same — a `config.json` written on one OS is often read
 *   on another (docs/ARQUITETURA.md's own example escapes backslashes into JSON), and a
 *   `--session` value typed in a POSIX-like shell on Windows (Git Bash) commonly uses `/`.
 * - **Case, Windows only.** NTFS is case-insensitive, so comparing `C:\Code\X` against
 *   `c:\code\x` as different strings would be a false negative on every Windows machine. Folded
 *   only on `win32` — Linux is case-sensitive, and macOS's usual case-insensitive-but-preserving
 *   default isn't assumed here since it isn't guaranteed (a case-sensitive APFS volume is a
 *   supported, if uncommon, configuration).
 * - **Trailing separator.** `c:\code\x` and `c:\code\x\` name the same directory.
 *
 * **Platform is a parameter, never read here — same reason `Clock` is injected instead of calling
 * `new Date()` (D-019).** This keeps the function pure and lets every branch be exercised from any
 * CI runner (docs/PLANO-DE-ENTREGA.md S3-T5: normalization coverage "não pode depender de rodar no
 * Windows para valer" — the lesson S2-T1 left behind, where a symlink-only bug hid on Linux and a
 * short-path-only bug hid everywhere but one CI runner). The caller reads the real
 * `process.platform` once — see `application/eligibility-assembly.ts` and
 * `cli/session-reference.ts` — and this file, living in `core/`, never imports `node:*` itself
 * (guard rule): it takes the platform as a plain string, exactly like `Clock` is a port instead of
 * a global read.
 *
 * **Known limitation, same shape as D-019's own.** A literal backslash inside a POSIX filename
 * (rare, but legal on Linux/macOS) is read as a separator here — the same trade-off
 * `adapters/discovery/session-mapping.ts#deriveNameFromCwd` already accepts, for the same reason:
 * a `cwd` string can arrive shaped by a different OS than the one comparing it, so one fixed
 * convention beats a per-platform one that would silently stop working the moment the shapes
 * cross. This covers the ordinary case of a mistyped or reformatted path, not an adversarial
 * filename.
 */
export type PathPlatformHint = 'win32' | 'posix';

/**
 * Strips one or more trailing `/` (separators are already unified to `/` by the caller below),
 * except when doing so would erase the root itself — `"/"` has to stay `"/"`, not become `""`,
 * or root and "no path at all" would normalize to the same value.
 */
function stripTrailingSeparators(path: string): string {
  const stripped = path.replace(/\/+$/, '');
  return stripped === '' && path.length > 0 ? '/' : stripped;
}

/**
 * @example
 * normalizeCwdForComparison('C:\\code\\Project\\', 'win32') // 'c:/code/project'
 * normalizeCwdForComparison('/home/x/project/', 'posix')    // '/home/x/project'
 */
export function normalizeCwdForComparison(rawCwd: string, platform: PathPlatformHint): string {
  const unifiedSeparators = rawCwd.replace(/\\/g, '/');
  const withoutTrailingSeparator = stripTrailingSeparators(unifiedSeparators);
  return platform === 'win32' ? withoutTrailingSeparator.toLowerCase() : withoutTrailingSeparator;
}
