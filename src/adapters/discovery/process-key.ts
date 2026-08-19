/**
 * The third discovery strategy (D-023, S1-T10): a `.key` file in `~/.claude/sessions/` with no
 * matching `.json` — the shape Claude Code leaves behind for a session launched interactively
 * with a prompt as its argument (`claude --dangerously-skip-permissions "/cmd --item N"`), which
 * registers a session-store key but never a `<pid>.json` entry and never a transcript. This case
 * is structurally invisible to both S1-T3 (registry: no `.json` to read) and S1-T8 (transcript
 * scan: no `.jsonl` to walk) — D-023's whole reason for existing.
 *
 * **Two independent sources that confirm each other, per D-023:**
 * 1. The `.key` file **name** (`<pid>.<hash>.key`) gives the PID — a directory listing, never the
 *    file's content. The file is sensitive (mode 600) and this module never calls `readFile` on
 *    it, only `readdir` (the same discipline `registry.ts` already documents for the `.key` files
 *    it deliberately leaves alone).
 * 2. `ProcessControl` (the same port S1-T2 implements, grown in S1-T10 with `readCwd`/
 *    `readCommandLine`) confirms the PID is alive right now, and reads its `cwd` and command line
 *    straight from the OS — the two facts neither the registry nor a transcript could ever give
 *    for this shape of session.
 *
 * The result is `SessionWithoutSessionId` (`core/types.ts`): this source can prove a PID is alive
 * and where it's running, but never a `sessionId` — see that interface's own docstring for why
 * that's a third domain shape instead of a synthetic id bolted onto an existing one.
 *
 * **No `forks.json` exclusion here, unlike `registry.ts`/`transcript-scan.ts` (D-012).** Both
 * sibling strategies exclude `seeya`'s own forks by `sessionId` — this strategy has no
 * `sessionId` to cross-reference against `forks.json` in the first place. It also doesn't need
 * to: `seeya` spawns its own generation forks with `claude -p` (docs/DECISOES.md D-011/D-017),
 * and a `-p` session registers **neither** a `.json` **nor** a `.key` (Spike D, Q-002) — it isn't
 * the shape D-023 is about. `.key`-without-`.json` is specifically the *non*-`-p`, prompt-as-
 * argument case, which `seeya` never produces itself.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { SessionWithoutSessionId } from '../../core/types.js';
import type { ProcessControl } from '../../core/ports.js';
import { deriveNameFromCwd } from './session-mapping.js';
import { isEnoent } from './fs-errors.js';

/** `<pid>.<hash>.key` (D-023) — the hash's own shape is opaque and unvalidated on purpose: this
 * module only ever needs the pid out of the name, never the hash itself. */
const KEY_FILE_PATTERN = /^(\d+)\.[^.]+\.key$/;
const KEY_EXTENSION = '.key';
const JSON_EXTENSION = '.json';

export interface ProcessKeyOptions {
  /** Injectable root standing in for `~/.claude` (never read from `os.homedir()` here). */
  readonly claudeHome: string;
  readonly processControl: ProcessControl;
  /** The current instant, obtained from the `Clock` port by the caller — never read here (D-019).
   * Used as `lastActivity`: a PID this strategy reports was just confirmed alive, which is itself
   * the most recent activity evidence this source can produce (docs/ESPECIFICACAO.md's own
   * definition of "sessão viva" — a process running right now). */
  readonly now: Date;
}

/** One rejected `.key` file or PID, with the raw value and the reason (AGENTS.md § "Mensagens de
 * erro" — always both), so `seeya sessions` can eventually say "N sessions, M entries ignored"
 * instead of lying by omission. Structurally identical to the sibling strategies' rejection
 * shapes (`registry.ts`'s `RejectedSessionRecord`, `transcript-scan.ts`'s
 * `RejectedTranscriptRecord`), kept as its own named type per strategy on purpose (each module
 * documents its own field on its own terms). */
export interface RejectedProcessKeyRecord {
  readonly file: string;
  readonly raw: unknown;
  readonly reason: string;
}

export interface ProcessKeyDiscoveryResult {
  readonly sessions: SessionWithoutSessionId[];
  readonly rejected: RejectedProcessKeyRecord[];
}

/** A `.key` file that parsed to a candidate pid, paired with the file name it came from — kept
 * around only so a later rejection can point back at a real path. */
interface KeyCandidate {
  readonly fileName: string;
  readonly pid: number;
}

/** Extracts the pid from a `.key` file name, or `undefined` when the name doesn't match the
 * `<pid>.<hash>.key` convention — including the case where the regex matches but
 * `noUncheckedIndexedAccess` still types the capture group as possibly `undefined` (structurally
 * unreachable once `match` is non-null, but the type has to be satisfied without `!`/`as`,
 * AGENTS.md § "Tipos"). Both cases mean the same thing to the caller: "not a valid `.key` name". */
function pidFromKeyFileName(name: string): number | undefined {
  const match = KEY_FILE_PATTERN.exec(name);
  const pidText = match?.[1];
  return pidText === undefined ? undefined : Number(pidText);
}

/** Splits `sessionsDir`'s listing into this strategy's candidates (a `.key` file with no matching
 * `.json`) and everything else. A `.key` file whose `<pid>.json` sibling *does* exist is
 * `registry.ts`'s territory, not this strategy's — left alone, same as `registry.ts` leaves every
 * `.key` alone. A directory-level failure worse than "doesn't exist yet" is one rejection, same
 * shape `registry.ts#listSessionJsonFilesOrRejection` uses for the same directory. */
async function listCandidates(
  sessionsDir: string,
): Promise<{ candidates: KeyCandidate[]; rejected: RejectedProcessKeyRecord[] }> {
  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch (error) {
    if (isEnoent(error)) {
      return { candidates: [], rejected: [] };
    }
    return {
      candidates: [],
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

  const candidates: KeyCandidate[] = [];
  const rejected: RejectedProcessKeyRecord[] = [];
  for (const name of entries) {
    if (!name.endsWith(KEY_EXTENSION)) {
      continue;
    }
    const pid = pidFromKeyFileName(name);
    if (pid === undefined) {
      rejected.push({
        file: path.join(sessionsDir, name),
        raw: name,
        reason: `.key file name does not match the "<pid>.<hash>.key" convention (D-023): "${name}"`,
      });
      continue;
    }
    if (registeredPids.has(String(pid))) {
      // Has a <pid>.json sibling: S1-T3's territory, not this strategy's. Not a rejection.
      continue;
    }
    candidates.push({ fileName: name, pid });
  }
  return { candidates, rejected };
}

type BuildOutcome =
  | { readonly kind: 'accepted'; readonly session: SessionWithoutSessionId }
  | { readonly kind: 'rejected'; readonly rejection: RejectedProcessKeyRecord };

/** One PID confirmed alive: fetches `cwd` and command line from the OS and builds the domain
 * object, or reports why it couldn't. A dead PID never reaches this function — see
 * `discoverSessionsFromProcessKey`, which checks liveness first and excludes it silently. */
async function buildSessionForPid(
  pid: number,
  sourceFile: string,
  processControl: ProcessControl,
  now: Date,
): Promise<BuildOutcome> {
  const [cwd, commandLine] = await Promise.all([
    processControl.readCwd(pid),
    processControl.readCommandLine(pid),
  ]);

  if (cwd === null) {
    // Same shape of decision Q-009 already settled for the transcript-scan strategy: a missing
    // identity/location datum is a visible, countable rejection, never an invented cwd (D-025).
    return {
      kind: 'rejected',
      rejection: {
        file: sourceFile,
        raw: undefined,
        reason:
          `pid ${pid}: process is alive but its working directory could not be read (unsupported ` +
          'platform, permission denied, or the process exited right after liveness was ' +
          'confirmed) — no cwd, no session (D-025); see adapters/process/inspection.ts',
      },
    };
  }

  return {
    kind: 'accepted',
    session: {
      hasPid: true,
      hasSessionId: false,
      pid,
      processIsAlive: true,
      cwd,
      name: deriveNameFromCwd(cwd),
      commandLine,
      hasTranscript: false,
      lastTranscriptWrite: null,
      lastActivity: now,
    },
  };
}

export async function discoverSessionsFromProcessKey(
  options: ProcessKeyOptions,
): Promise<ProcessKeyDiscoveryResult> {
  const sessionsDir = path.join(options.claudeHome, 'sessions');
  const { candidates, rejected } = await listCandidates(sessionsDir);

  // Two (or more) .key files can name the same pid (e.g. a stale hash left behind alongside a
  // fresh one) — one session per unique pid, not one per file.
  const uniquePids = new Map<number, string>();
  for (const candidate of candidates) {
    if (!uniquePids.has(candidate.pid)) {
      uniquePids.set(candidate.pid, candidate.fileName);
    }
  }

  const outcomes = await Promise.all(
    [...uniquePids.entries()].map(async ([pid, fileName]) => {
      const sourceFile = path.join(sessionsDir, fileName);
      try {
        const isAlive = await options.processControl.isAlive(pid);
        if (!isAlive) {
          // D-023: a .key with no live process behind it is not a stale-session signal — it's
          // ignored, never reported as a session and never counted as a rejection either
          // (docs/PLANO-DE-ENTREGA.md S1-T10 aceite item 2).
          return { kind: 'excluded' as const };
        }
        return await buildSessionForPid(pid, sourceFile, options.processControl, options.now);
      } catch (error) {
        return {
          kind: 'rejected' as const,
          rejection: {
            file: sourceFile,
            raw: undefined,
            reason: `discovery failed: ${String(error)}`,
          },
        };
      }
    }),
  );

  const sessions: SessionWithoutSessionId[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === 'accepted') {
      sessions.push(outcome.session);
    } else if (outcome.kind === 'rejected') {
      rejected.push(outcome.rejection);
    }
  }

  return { sessions, rejected };
}
