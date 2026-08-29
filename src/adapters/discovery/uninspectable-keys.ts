/**
 * Lists `.key` files in `~/.claude/sessions/` that have no matching `<pid>.json` sibling — the
 * cheap detection D-029 keeps from the revoked third discovery strategy (D-023), now feeding a
 * warning (S1-T7, `core/early-warnings.ts`) instead of building a session out of it. Never reads
 * `.key` file **content** (mode 600) — only `readdir`, exactly like
 * `registry.ts#listSessionJsonFiles` already documents for the `.key` files it deliberately
 * leaves alone.
 *
 * Recovered from `process-key.ts#listCandidates` (commit `e45b348`, removed by S1-T11/D-029) as
 * docs/PLANO-DE-ENTREGA.md's S1-T7 entry asks, rather than rewritten — same directory-listing and
 * pid-extraction logic, with everything D-029 doesn't ask for anymore stripped out: no
 * `ProcessControl.isAlive` check, no `cwd`, no command line, no `SessionWithoutSessionId` to
 * build. D-029's own text is explicit that liveness isn't part of this anymore ("Listar
 * `~/.claude/sessions/` e ver `.key` sem `.json` custa uma listagem de diretório. Isso continua, e
 * alimenta o aviso.") — a `.key` file feeds the warning whether or not its PID is still alive.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isEnoent } from './fs-errors.js';

/** `<pid>.<hash>.key` (D-023) — the hash's own shape is opaque and unvalidated on purpose: this
 * module only ever needs the pid out of the name, to check for a `<pid>.json` sibling, never the
 * hash itself. */
const KEY_FILE_PATTERN = /^(\d+)\.[^.]+\.key$/;
const KEY_EXTENSION = '.key';
const JSON_EXTENSION = '.json';

/** One rejected `.key` file name, with the raw value and the reason (AGENTS.md § "Mensagens de
 * erro" — always both). Structurally identical to the sibling strategies' rejection shapes
 * (`registry.ts`'s `RejectedSessionRecord`, `transcript-scan.ts`'s `RejectedTranscriptRecord`),
 * kept as its own named type on purpose — same reasoning the historical `process-key.ts` gave for
 * doing this per strategy. */
export interface RejectedUninspectableKeyRecord {
  readonly file: string;
  readonly raw: unknown;
  readonly reason: string;
}

export interface UninspectableKeysResult {
  /** Bare file names (never full paths, never content) of `.key` files with no `<pid>.json`
   * sibling — this is the whole warning: seeya can see they exist and cannot inspect them. */
  readonly fileNames: readonly string[];
  readonly rejected: readonly RejectedUninspectableKeyRecord[];
}

/** Extracts the pid from a `.key` file name, or `undefined` when the name doesn't match the
 * `<pid>.<hash>.key` convention — including the case where the regex matches but
 * `noUncheckedIndexedAccess` still types the capture group as possibly `undefined` (structurally
 * unreachable once `match` is non-null, but the type has to be satisfied without `!`/`as`,
 * AGENTS.md § "Tipos"). Both cases mean the same thing to the caller: "not a valid `.key` name". */
function pidFromKeyFileName(name: string): string | undefined {
  const match = KEY_FILE_PATTERN.exec(name);
  return match?.[1];
}

/**
 * Lists `<claudeHome>/sessions`, and returns the `.key` file names that have no `<pid>.json`
 * sibling — a `.key` file whose sibling *does* exist is `registry.ts`'s territory, not this
 * module's, and is left alone the same way `registry.ts` leaves every `.key` alone. A `.key` name
 * that doesn't match the `<pid>.<hash>.key` convention can't be checked for a sibling at all
 * (there's no pid to look up), so it's a visible rejection (D-022) rather than silently skipped or
 * silently treated as a candidate. A missing `sessions/` directory (no session has ever
 * registered on this machine) is empty, not an error (D-025) — same as `registry.ts`'s own
 * directory listing.
 */
export async function listUninspectableSessionKeys(
  claudeHome: string,
): Promise<UninspectableKeysResult> {
  const sessionsDir = path.join(claudeHome, 'sessions');
  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch (error) {
    if (isEnoent(error)) {
      return { fileNames: [], rejected: [] };
    }
    return {
      fileNames: [],
      rejected: [
        {
          file: sessionsDir,
          raw: undefined,
          reason: `listing the sessions directory failed: ${String(error)}`,
        },
      ],
    };
  }

  const registeredPids = new Set(
    entries
      .filter((name) => name.endsWith(JSON_EXTENSION))
      .map((name) => name.slice(0, -JSON_EXTENSION.length)),
  );

  const fileNames: string[] = [];
  const rejected: RejectedUninspectableKeyRecord[] = [];
  for (const name of entries) {
    if (!name.endsWith(KEY_EXTENSION)) {
      continue;
    }
    const pid = pidFromKeyFileName(name);
    if (pid === undefined) {
      rejected.push({
        file: path.join(sessionsDir, name),
        raw: name,
        reason: `.key file name does not match the "<pid>.<hash>.key" convention: "${name}"`,
      });
      continue;
    }
    if (registeredPids.has(pid)) {
      continue; // Has a <pid>.json sibling: registry.ts's territory, not a warning.
    }
    fileNames.push(name);
  }
  return { fileNames, rejected };
}
