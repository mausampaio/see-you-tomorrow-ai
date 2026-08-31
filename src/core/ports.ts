/**
 * Core ports — the interfaces every access to the world has to go through
 * (docs/ARQUITETURA.md § "Princípio"). `core/` declares the interface; `adapters/`
 * implements it; `cli/` is the only composition root that names the concrete implementation and
 * injects it (D-020).
 *
 * **Ports are declared as their types come to exist, not all seven from
 * docs/ARQUITETURA.md's sketch up front.** A port whose signature references a type that doesn't
 * exist yet in this project would mean inventing that type too early just to fill in a signature,
 * or declaring the port with `unknown` — worse than not declaring it. `HandoffGenerator` (S2-T2),
 * `Storage` (S1-T5, grown further in S1-T7 and S2-T2) and `Notifier` (S4-T1, at the end of this
 * file) are all filled in below now that `GeneratedUnderstanding`/`EarlyWarningState`/`Notice`
 * exist.
 */
import type {
  Config,
  Day,
  DiscoveredSession,
  EarlyWarningState,
  GeneratedUnderstanding,
  Handoff,
  SessionFacts,
} from './types.js';

/**
 * The project's single source of "now" (D-019). Implemented in `adapters/clock/`. No other
 * module calls `new Date()` with no argument, `Date.now()`, or a long-running
 * `setTimeout`/`setInterval` — this port is what returns the instant, and whoever needs it
 * receives it already resolved.
 */
export interface Clock {
  now(): Date;
}

/**
 * Process liveness and termination (D-002). Implemented in `adapters/process/` (S1-T2).
 * `isAlive` receives `procStart` to break ties on a recycled PID (docs/ESPECIFICACAO.md § "Como
 * as sessões são descobertas") — the pure decision of when two `procStart` values count as the
 * same process lives in `core/classification.ts#pidRepresentsSameProcess`; this port only
 * declares the async contract that the adapter fulfills by querying the real OS.
 *
 * **Grew `readCwd`/`readCommandLine` in S1-T10 (D-023), reverted in S1-T11 (D-029).** Those two
 * methods read a live PID's working directory and command line for the `.key`-without-`.json`
 * discovery strategy that D-023 added. D-029 revoked that strategy — the cause it attributed to
 * the phenomenon didn't hold up under measurement — so the two methods have no caller left and
 * came out with it. See docs/DECISOES.md D-029 and docs/QUESTOES.md Q-011 (the privacy question
 * `readCommandLine` raised, now moot because nothing captures a command line at all).
 */
export interface ProcessControl {
  isAlive(pid: number, procStart?: string): Promise<boolean>;
  terminateGracefully(pid: number, deadlineMs: number): Promise<boolean>;
}

/**
 * One rejected external record surviving the merge in `SessionProvider.list()` (S1-T9):
 * structurally identical to `adapters/discovery/registry.ts#RejectedSessionRecord` and
 * `adapters/discovery/transcript-scan.ts#RejectedTranscriptRecord` (which is why no cast is
 * needed to hand either one to `DiscoveryResult.rejected`), declared here — not imported from
 * those adapter modules — because `core/` cannot import `adapters/` (D-020's layer matrix) and
 * this is the shape the *port* promises, independent of how many strategies produce it today.
 */
export interface RejectedDiscoveryRecord {
  readonly file: string;
  readonly raw: unknown;
  readonly reason: string;
}

/**
 * `SessionProvider.list()`'s return shape (S1-T9), carrying D-022's both-sides contract
 * ("aceitos e rejeitados com motivo") through the merge instead of losing it at the port
 * boundary. Both merged-in strategies (S1-T3's registry, S1-T8's transcript scan) already return
 * `{ sessions, rejected }` on their own; dropping `rejected` here would be exactly the kind of
 * silent omission D-022 exists to prevent, at the one point (`seeya sessions`, S1-T6) where a
 * caller could finally show it to the user — "3 sessions, 1 entry ignored" needs the rejections to
 * survive the merge to be sayable at all.
 */
export interface DiscoveryResult {
  readonly sessions: DiscoveredSession[];
  readonly rejected: RejectedDiscoveryRecord[];
}

/**
 * Session discovery (D-016). Implemented in `adapters/discovery/`, merging the strategies of
 * S1-T3 (registry) and S1-T8 (transcript scan) into a single deduplicated list of
 * `DiscoveredSession` — `list()` returns the already-merged union, never the raw concatenation of
 * the sources: callers shouldn't need to know how many strategies exist underneath, nor
 * deduplicate on their own. A third strategy (D-023, process + `.key`) existed between S1-T10 and
 * D-029; see that decision for why it was removed.
 *
 * **`list()` returns `DiscoveryResult`, not bare `DiscoveredSession[]` (S1-T9).** The sketch in
 * docs/ARQUITETURA.md § "Portas" still shows `list(): Promise<DiscoveredSession[]>` — that sketch
 * predates S1-T9 and wasn't updated because ARQUITETURA.md's boundary text needs PO approval to
 * change (AGENTS.md § "Ordem de autoridade"). See docs/QUESTOES.md Q-012 for the question this
 * opened, and D-022 for why dropping `rejected` at this boundary isn't an option.
 */
export interface SessionProvider {
  list(): Promise<DiscoveryResult>;
}

/**
 * Persistence at `~/.seeya/` (D-027). Implemented by `adapters/storage/` (S1-T5). The root is
 * always injected into the adapter's constructor, never read from `os.homedir()` inside it — same
 * rule `adapters/discovery/` already follows for `~/.claude` — so no test touches the real
 * `~/.seeya/`.
 *
 * **Only `readConfig` for now.** docs/ARQUITETURA.md's sketch of this port also lists
 * `saveHandoff(day: Day, handoff: Handoff)`, `readBriefing(day: Day)` and
 * `saveState(state: DayState)` — but `Day`, `Handoff`, `Briefing` and `DayState` don't exist as
 * types yet (they arrive with S2-T2/S2-T3/S2-T4 and S4-T2). Declaring those methods now would
 * mean typing them `unknown` or inventing four types this task doesn't need just to fill a
 * signature — the same reasoning this file's top comment already applies to `TranscriptReader`,
 * `HandoffGenerator` and `Notifier`. Whoever implements those later tasks grows this interface
 * additively once the types it needs exist for real; docs/QUESTOES.md Q-013 has the note on this
 * scope cut.
 */
export interface Storage {
  /**
   * Reads `~/.seeya/config.json`, resolved against defaults. A file that doesn't exist yet
   * (nothing written on this machine so far) is not an error (D-025): every field comes back at
   * its default. A file that exists but is malformed — invalid JSON, a field of the wrong shape,
   * or a `schemaVersion` this build doesn't know how to read — rejects instead of silently
   * falling back to defaults: only *absence* reads as "use the defaults", never *corruption*.
   */
  readConfig(): Promise<Config>;

  /**
   * Reads the "already warned" bookkeeping S1-T7's early-warning detection needs to keep a
   * warning from firing more than once (docs/DECISOES.md D-018, D-029;
   * `core/early-warnings.ts#detectEarlyWarnings`). A file that doesn't exist yet (nothing warned
   * about on this machine so far) is not an error (D-025): both sets in `EarlyWarningState` come
   * back empty. A file that exists but is malformed rejects — same policy as `readConfig`,
   * corruption is never silently read as "nothing warned yet".
   *
   * **Grown additively in S1-T7**, same as this port's docstring above already anticipated for
   * `saveHandoff`/`readBriefing`/`saveState` — this method and `saveEarlyWarningState` below
   * exist because `EarlyWarningState` (`core/types.ts`) now exists to type them.
   */
  readEarlyWarningState(): Promise<EarlyWarningState>;

  /**
   * Persists the state `detectEarlyWarnings` returned as `nextState`. This port doesn't diff for
   * the caller — `adapters/discovery/early-warnings.ts` only calls this when at least one new
   * warning fired, to avoid a write on every idle discovery pass.
   */
  saveEarlyWarningState(state: EarlyWarningState): Promise<void>;

  /**
   * Persists `handoff` at `~/.seeya/days/<day>/sessions/<sessionId>.json`
   * (docs/ESPECIFICACAO.md § "Formato do handoff"), atomically. D-002's ordering requirement —
   * "handoff gravado e verificado em disco → só então terminar o processo" — is why
   * `application/endDay` (S2-T3) always calls `readHandoff` right after this one to confirm the
   * write actually landed before ever touching `ProcessControl.terminateGracefully`; this method's
   * own job stops at "the write completed without throwing".
   *
   * **Grown additively in S2-T3**, same pattern this port's docstring already used for
   * `readEarlyWarningState`/`saveEarlyWarningState` in S1-T7: `Handoff`/`Day` (`core/types.ts`)
   * now exist to type it.
   */
  saveHandoff(day: Day, handoff: Handoff): Promise<void>;

  /**
   * Reads one session's handoff for `day`, or `null` when it doesn't exist yet — no capture made
   * today for this session is normal, not an error (D-025). This is the read side D-026's
   * anti-duplication needs: has this session already been captured today, and with what evidence
   * (`core/evidence.ts#buildEvidenceSignature`, applied to the returned `Handoff.facts`). A file
   * that exists but is malformed rejects — same policy as `readConfig`/`readEarlyWarningState`,
   * corruption is never silently read as "nothing captured yet".
   *
   * **Not in docs/ARQUITETURA.md § "Portas"'s sketch of this port**, which only lists
   * `readBriefing(day)` — the whole day's consolidated `summary.md` (S2-T4), a human-readable
   * markdown document with nowhere to parse a single session's exact `facts` back out of. Same
   * shape of divergence already recorded for `DiscoveryResult`/`TranscriptReadResult`/
   * `GitReadResult` above: the sketch predates a constraint the implementing task found. Flagged in
   * docs/QUESTOES.md (S2-T3) instead of edited into `ARQUITETURA.md` directly (AGENTS.md § "Ordem
   * de autoridade").
   */
  readHandoff(day: Day, sessionId: string): Promise<Handoff | null>;

  /**
   * Reads every handoff written for `day` (`~/.seeya/days/<day>/sessions/*.json`), validating
   * each file independently — D-022 names "os handoffs lidos de `~/.seeya/`" explicitly as a
   * collection that must be checked item by item, never `z.array`'s tudo-ou-nada. One corrupted or
   * hand-edited file never takes the rest of the day down: it's reported in `rejected`
   * (`RejectedDiscoveryRecord`, same `file`/`raw`/`reason` shape `DiscoveryResult` already uses)
   * and excluded, while every other handoff still comes back in `handoffs`.
   *
   * A missing or empty `sessions/` directory (nothing captured yet today) resolves to
   * `{ handoffs: [], rejected: [] }`, not an error (D-025) — same "absence is normal" policy as
   * `readConfig`/`readEarlyWarningState`/`readHandoff` above.
   *
   * Added in S2-T4 for `generateBriefingMarkdown` (`core/briefing.ts`): the day's consolidated
   * `summary.md` is built from every handoff captured so far today, not only the ones a single
   * `endDay` run just wrote, so re-running `seeya end-day --session <id>` (S2-T5) later the same
   * day still produces a briefing reflecting everyone captured earlier.
   */
  listHandoffs(day: Day): Promise<{
    readonly handoffs: Handoff[];
    readonly rejected: RejectedDiscoveryRecord[];
  }>;

  /**
   * Persists `markdown` at `~/.seeya/days/<day>/summary.md` (docs/ESPECIFICACAO.md § "Formato do
   * handoff": "ao lado da pasta `sessions/`"), atomically — same `writeFileAtomic` every other
   * write under `~/.seeya/` uses, reused rather than duplicated.
   *
   * **Named `saveBriefing`, not in AGENTS.md § "Idioma"'s glossary table.** That table fixes
   * `readBriefing` (for S3-T1, still unimplemented) but never named the write side — an oversight
   * this task fills by the same `save<Noun>`/`read<Noun>` pattern `saveHandoff`/`readHandoff` and
   * `saveEarlyWarningState`/`readEarlyWarningState` already established, rather than a new,
   * unrelated verb. Flagged in docs/QUESTOES.md for confirmation, per AGENTS.md § "Glossário de
   * domínio": "termo novo entra aqui antes de entrar no código".
   */
  saveBriefing(day: Day, markdown: string): Promise<void>;

  /**
   * Reads `day`'s consolidated `Briefing` — every handoff captured for `day`, exactly as
   * `listHandoffs(day)` already returns them, with `day` attached; no second read path and no new
   * on-disk format. `null` when there is truly nothing for that day at all (no `sessions/`
   * directory, nothing ever captured) — D-025: absence of any capture is a different,
   * less-specific state than "a day with zero pending work", and this method doesn't blur the
   * two. A day where every handoff on file failed validation (`handoffs: []`, `rejected`
   * non-empty) is NOT the same as "nothing happened" and still comes back as a `Briefing`, not
   * `null` — silently hiding a day of unreadable files would be exactly the omission D-022 exists
   * to prevent.
   */
  readBriefing(day: Day): Promise<Briefing | null>;

  /**
   * Reads which `sessionId`s have already been resumed for `day` — `seeya start-day`'s step 5
   * (docs/ESPECIFICACAO.md § `seeya start-day`: "Marca o briefing como retomado"), decided in
   * S3-T3 to be per-SESSION rather than per-day (docs/QUESTOES.md, and see
   * `core/pending-briefing.ts`'s docstring for the full reasoning: marking a whole day resumed
   * after only one of its several sessions actually got resumed would make the others silently
   * vanish from "pending", which is D-025's mistake aimed at a person's whole day of work instead
   * of one field). A day with nothing resumed yet — including a day that was never captured at
   * all — comes back as an empty set (D-025: absence, not an error).
   *
   * Named to match the `read<Noun>`/`save<Noun>` pair this port already uses elsewhere
   * (`readEarlyWarningState`/`saveEarlyWarningState`, `readHandoff`/`saveHandoff`) rather than an
   * "append" verb: the append/diff logic (which id is new, when to persist) belongs to
   * `application/start-day.ts#resumeSessions`, the same split `core/early-warnings.ts` already
   * draws between "decide what changed" (pure) and "persist it" (this port).
   */
  readResumedSessionIds(day: Day): Promise<ReadonlySet<string>>;

  /**
   * Persists the full set of resumed `sessionId`s for `day` — not an increment. Same shape as
   * `saveEarlyWarningState`: the caller (`application/start-day.ts#resumeSessions`) reads the
   * current set, adds the one `sessionId` that JUST finished resuming, and calls this with the
   * whole updated set — one write per session, right after that session's `SessionResumer.resume()`
   * call actually returned, never before (D-002's "fact, then mark" ordering, applied here to
   * bookkeeping instead of process termination) and never batched at the end, so a crash midway
   * through `--all` still leaves every session resumed BEFORE the crash correctly marked.
   *
   * A `SessionResumer.resume()` call that fell back to a fresh session (D-004) still counts as
   * resumed here — the person got the plan and a session to work in either way, just not a
   * continuation of the original conversation. Only a `resume()` that THROWS (the fallback itself
   * also failing fast) is never marked, because nothing happened for that session at all.
   *
   * Persisted at `~/.seeya/days/<day>/resumed.json` — `{ schemaVersion, sessionIds: string[] }` —
   * a new on-disk identifier not yet in AGENTS.md § "Idioma"'s "Identificadores que vão para
   * disco" table, flagged in docs/QUESTOES.md for the PO to fold in, same non-blocking pattern
   * S1-T7 already used for `early-warnings.json`. Chosen over folding this into the handoff itself
   * (`Handoff` is written once, at capture time, by a different command entirely — `seeya
   * end-day` — and re-opening/rewriting every one of a day's handoff files just to flip one field
   * would touch documents `start-day` has no other reason to write) and over one file per session
   * (a single small set, read and rewritten whole, is simpler than N small files for what is at
   * most a handful of sessions per day — D-027: the key is cheap to pick now, so pick the simpler
   * shape).
   */
  saveResumedSessionIds(day: Day, sessionIds: ReadonlySet<string>): Promise<void>;
}

/**
 * `TranscriptReader.readFacts()`'s return shape (S1-T4) — the same "both sides" shape
 * `DiscoveryResult` gives `SessionProvider.list()` (S1-T9) above. docs/ARQUITETURA.md § "Portas"
 * sketches `readFacts` returning a bare `SessionFacts`; that sketch predates this decision the
 * same way it predated `DiscoveryResult` (see the comment on that interface). D-022 names "as
 * entradas do `.jsonl` de transcript" explicitly as a collection that must be validated per item,
 * with both the accepted and the rejected side visible — a bare `SessionFacts` has nowhere to
 * carry the rejected side, so returning one would silently drop exactly the visibility D-022
 * exists to guarantee.
 */
export interface TranscriptReadResult {
  readonly facts: SessionFacts;
  /**
   * A recognized entry type (`user`/`assistant`) whose content failed its schema — most often a
   * truncated final line written mid-flush (docs/TESTES.md's mandatory fixture), but any other
   * structural mismatch lands here too. Reuses `RejectedDiscoveryRecord`'s `file`/`raw`/`reason`
   * shape: same D-022 contract, one external item that failed validation, with the raw value and
   * why. `file` carries `<transcriptPath>:<lineNumber>` so one line stays traceable inside a
   * single file.
   */
  readonly rejected: RejectedDiscoveryRecord[];
  /**
   * Count of lines whose `type` isn't one of `KNOWN_ENTRY_TYPES`
   * (`adapters/transcript/schemas.ts`). Not a rejection — that module's docstring is explicit
   * that a new entry type is normal version drift, "ignored, not an error" — but kept visible and
   * counted (S1-T4's acceptance criteria) so "the format changed under us" doesn't look identical
   * to "nothing happened".
   */
  readonly unknownEntryTypeCount: number;
}

/**
 * Reads a session's transcript and extracts `SessionFacts` (D-003's fact layer). Implemented in
 * `adapters/transcript/` (S1-T4): streaming, line by line — real transcripts pass 1 MB
 * (docs/TESTES.md § transcript/), and holding one whole in memory just to find its last few
 * prompts is exactly the design that fixture exists to catch.
 *
 * Rejects only on a real I/O failure reading the located file (permission denied, the file
 * vanishing mid-read) — same contract as
 * `adapters/discovery/transcript-cwd.ts#readCwdFromTranscript`. A session that simply has no
 * transcript (`hasTranscript: false`, D-013) is the normal "no evidence" case, not a rejection:
 * the implementation resolves that by never finding a file to open, not by throwing, and answers
 * with every `SessionFacts` field at its least-specific value (D-025) instead.
 */
export interface TranscriptReader {
  readFacts(session: DiscoveredSession): Promise<TranscriptReadResult>;
}

// Own import line on purpose, not folded into the block above: a second in-flight task (S2-T2)
// touches this same file's top import block, and D-022/D-025 already established the pattern of
// keeping an addition self-contained to reduce merge collisions (see this file's own history).
import type { GitFacts } from './types.js';

/**
 * `GitReader.readFacts()`'s return shape (S2-T1). A discriminated union, not `GitFacts | null` —
 * same reasoning `core/types.ts#DiscoveredSession` already applies to `hasPid` (D-024): `cwd` not
 * being a git repository at all is a real, ordinary case
 * (docs/ARQUITETURA.md § `git/`: "não quebra quando o `cwd` não é repositório: devolve 'sem git'
 * e segue"), and giving it its own shape — with no `facts` field to accidentally read as an empty
 * `GitFacts` — is what makes "no git here" impossible to confuse with "a repo with nothing going
 * on" (D-025).
 *
 * `rejectedWorktrees` only exists on the `hasGit: true` side, reusing `RejectedDiscoveryRecord`'s
 * `file`/`raw`/`reason` shape (D-022, same reuse `TranscriptReadResult.rejected` above already
 * does) for one worktree whose own state couldn't be read — most commonly, `git worktree list`
 * still remembers a worktree whose directory is gone from disk — without that one failure taking
 * down the enumeration of the others.
 */
export type GitReadResult =
  | { readonly hasGit: false }
  | {
      readonly hasGit: true;
      readonly facts: GitFacts;
      readonly rejectedWorktrees: readonly RejectedDiscoveryRecord[];
    };

/**
 * Reads git facts for a session's `cwd` — D-013's first and most reliable evidence source, and
 * per that decision's own text, often the *only* substantive source for a session with no usable
 * transcript. Implemented in `adapters/git/` (S2-T1).
 *
 * Never throws for the ordinary "no evidence" cases: `cwd` not being a git repository at all
 * resolves to `{ hasGit: false }`, never a thrown error that would abort the whole capture over
 * an input this port considers completely normal (docs/ARQUITETURA.md § `git/`).
 *
 * **This port's name and its method's name are new terms, not yet in AGENTS.md's glossary.**
 * Chosen to mirror `TranscriptReader`/`readFacts` above, since both ports answer the same kind of
 * question (D-013 evidence facts) with the same "both-sides" shape for their fallible part.
 * Flagged in docs/QUESTOES.md for confirmation, per AGENTS.md § "Glossário de domínio": "termo
 * novo entra aqui antes de entrar no código" — registering instead of deciding silently.
 */
export interface GitReader {
  readFacts(cwd: string): Promise<GitReadResult>;
}

/**
 * Generates the "understanding" layer of a handoff (D-003's layer 2) by calling headless `claude`
 * (D-001, D-011). Implemented in `adapters/generation/` (S2-T2) as two classes behind this one
 * port — `LeanHandoffGenerator` (default: fresh disposable session built from `facts`) and
 * `DeepHandoffGenerator` (`--resume`s `session.sessionId` with `--fork-session`, registers the
 * fork per D-012) — chosen by `deepCapture` config, never by an `if` inside a shared
 * implementation (D-011: "duas implementações atrás da mesma porta; a escolha é config"). `cli/`,
 * the only composition root (D-020), is what picks which implementation a given project's policy
 * gets.
 *
 * **Takes the whole `DiscoveredSession`, not just `SessionFacts` — a departure from
 * docs/ARQUITETURA.md § "Portas"'s sketch (`generate(facts: SessionFacts)`).** The deep variant
 * needs `session.sessionId` to resume; `SessionFacts` (S1-T4, transcript-only extraction) carries
 * no session identity at all. Same shape of divergence already recorded for `SessionProvider.list()`
 * (`DiscoveryResult`, Q-012) and `TranscriptReader.readFacts()` (`TranscriptReadResult`, Q-014):
 * the sketch predates a constraint the implementing task found, and in both those cases the
 * resolution was "the port is right, the sketch was outdated". Not edited into
 * `docs/ARQUITETURA.md` directly — that requires PO approval (AGENTS.md § "Ordem de
 * autoridade") — flagged instead in docs/QUESTOES.md Q-019, and the minimal signature change
 * applied in the meantime per AGENTS.md's "abra a questão e siga com a solução mínima".
 *
 * **Rejects with a typed error on any failure** (spawn error, hard timeout, non-zero exit,
 * invalid JSON, output failing its own schema, or the model itself reporting `is_error`) — see
 * `adapters/generation/errors.ts#GenerationError`. Per docs/ARQUITETURA.md § `generation/`: "Erro
 * tipado. Quem decide o fallback é application/, não o adapter" — this port never manufactures a
 * `source: "deterministic"` result itself. `application/endDay` (S2-T3) is what catches the
 * rejection and builds the deterministic handoff (D-003); this port only ever resolves with a
 * real model result.
 */
export interface HandoffGenerator {
  generate(session: DiscoveredSession, facts: SessionFacts): Promise<GeneratedUnderstanding>;
}

// Own block at the end of the file on purpose (S2-T6): a second in-flight task (S2-T4) touches
// this same file's earlier interfaces, and D-022/D-025 already established the pattern (see the
// `GitFacts` import comment above) of keeping an addition self-contained, appended after
// everything that exists already, to reduce merge collisions instead of inserting mid-file.

/**
 * One fork's cleanup outcome (D-012, S2-T6) — only ever produced for a `sessionId` this port's
 * implementation already decided is stale (`core/fork-cleanup.ts#planForkCleanup`); a fork that's
 * still within `forkCleanupDays` never appears here at all.
 *
 * A discriminated union, not one shape with an optional `reason` (D-024): `reason` only exists to
 * explain a `failed` outcome, and a type that let `deleted`/`alreadyAbsent` carry one too would
 * make "was there a reason or not" representable when it never should be.
 *
 * - `deleted` — the fork's transcript file existed under `~/.claude/projects/` and was removed.
 * - `alreadyAbsent` — no such file was found. Not an error (D-025): the user may have deleted it
 *   by hand, and D-012's exception exists to guard against rediscovery, which nothing left on
 *   disk can trigger anyway. Same outcome whether the file never existed or vanished mid-attempt.
 * - `failed` — deletion was attempted and a real error stopped it (permission denied, a locked
 *   file). Named with the raw error so it stays diagnosable (AGENTS.md § "Mensagens de erro").
 */
export type ForkCleanupOutcome =
  | { readonly sessionId: string; readonly outcome: 'deleted' }
  | { readonly sessionId: string; readonly outcome: 'alreadyAbsent' }
  | { readonly sessionId: string; readonly outcome: 'failed'; readonly reason: string };

/**
 * `ForkCleanup.cleanup()`'s return shape — D-022's "both sides" applied to a deletion pass instead
 * of a validation pass: `outcomes` is what happened to every stale fork attempted (one failure
 * never stops the others, AGENTS.md D-022), and `rejected` is `forks.json`'s own D-022 contract
 * (a malformed entry in the registry itself, reported and dropped, never silently lost) — reusing
 * `RejectedDiscoveryRecord`'s shape rather than inventing a fourth one for the same
 * `file`/`raw`/`reason` triple this file already declares three times over.
 */
export interface ForkCleanupResult {
  readonly outcomes: readonly ForkCleanupOutcome[];
  readonly rejected: readonly RejectedDiscoveryRecord[];
}

/**
 * Deletes forks `seeya` itself created and registered (D-012) once they're older than
 * `forkCleanupDays`. Implemented in `adapters/discovery/` (S2-T6) — the same adapter that already
 * owns `forks.json`'s reader (`fork-registry.ts`, S1-T3) and the transcript-file lookup
 * (`transcript-lookup.ts`, S1-T4) this port's implementation reuses to find each fork's file.
 *
 * **The one port whose implementation is allowed to delete a file outside `~/.seeya/`.** Every
 * other adapter's writes stay inside the injected `seeyaHome` root (AGENTS.md § "Sistema de
 * arquivos"); this is D-012's single, narrow exception, and only for a `sessionId` this port's own
 * implementation already found listed in `forks.json` — never a path the caller supplies.
 *
 * Never throws on a single fork's deletion failing — that outcome is `failed`, inside the
 * returned `ForkCleanupResult`, not a rejected promise (D-022's "uma falha não aborta as outras"
 * applied to this port specifically).
 */
export interface ForkCleanup {
  cleanup(forkCleanupDays: number): Promise<ForkCleanupResult>;
}

/**
 * The day's consolidated document (docs/ESPECIFICACAO.md § "Glossário": "Documento consolidado do
 * dia, com todos os handoffs, lido no dia seguinte") — `Storage.readBriefing()`'s return shape
 * (S3-T1). Distinct from `~/.seeya/days/<day>/summary.md`'s markdown rendering
 * (`core/briefing.ts#generateBriefingMarkdown`, S2-T4): that's one human-readable *display* of
 * this same data, built for `seeya end-day`'s own output. `seeya start-day` (S3-T1) needs the
 * *structured* form instead — `pendingItems`/`tomorrowPlan`/`understanding` per session live on
 * each `Handoff`, and there is nowhere in prose to parse them back out of (same shape of
 * divergence from `docs/ARQUITETURA.md` § "Portas"'s sketch already recorded for
 * `DiscoveryResult`/`TranscriptReadResult`/`GitReadResult`/`readHandoff`, Q-012/Q-014/Q-019/
 * Q-021 item 4). Built directly on top of `Storage.listHandoffs(day)`, which already does the
 * real work — this is that same `{ handoffs, rejected }` shape with `day` attached, not a second
 * read path or a second on-disk format.
 *
 * Declared after `Storage` on purpose: `Storage.readBriefing` above references it, and nothing in
 * TypeScript requires a type to appear before an interface member that uses it — moving this
 * wouldn't change what either declares. (Was briefly a second `export interface Storage {}` block
 * here too, merged back into the single interface above — see docs/FLUXO-DE-AGENTES.md's note on
 * why "aditivo no fim do arquivo" produced that split for a method added to an EXISTING interface,
 * and docs/PLANO-DE-ENTREGA.md S3-T3 for the consolidation.)
 */
export interface Briefing {
  readonly day: Day;
  readonly handoffs: readonly Handoff[];
  readonly rejected: readonly RejectedDiscoveryRecord[];
}

// Own import line on purpose (S3-T2), same pattern the `GitFacts` import above already
// established: keeps this addition self-contained instead of folding into the top import block.
import type { ResumeOutcome } from './types.js';

/**
 * Resumes one session interactively, or falls back to a fresh one (D-004). Implemented in
 * `adapters/resumption/` (S3-T2) — spawns `claude` with the child's stdio **inherited** from
 * `seeya`'s own process, never piped. docs/spikes/H-retomada-interativa.md measured that without a
 * real terminal attached, "interactive" `claude` silently degrades into a single non-interactive
 * reply and exits — never a resumable session at all — so a genuine continuation is only possible
 * by handing the child the user's actual terminal.
 *
 * That's also why `resume()` only resolves once the user's own interactive session ends (`/exit`,
 * Ctrl+D, closing the window): there is no event that fires any sooner, and this port never gets
 * the child's stdout/stderr to inspect — they went straight to the same real screen the user is
 * already looking at, not to a pipe `seeya` could read.
 *
 * `prompt` is `seeya`'s already-assembled first message for this session — S3-T1's job (reading
 * the pending briefing, building the per-session text). This port doesn't know or care what a
 * `Handoff`/`Briefing` looks like; it only ever receives a plain string, which keeps this
 * adapter's one technical concern (how to get variable-length text into an interactive `claude`
 * process, D-015) separate from what that text says.
 */
export interface SessionResumer {
  resume(sessionId: string, cwd: string, prompt: string): Promise<ResumeOutcome>;
}

// Own block at the end of the file on purpose (S4-T1), same pattern `ForkCleanup`/`Briefing`/
// `SessionResumer` above already established (see their own comments): a new interface, appended
// rather than inserted mid-file, to reduce merge collisions — S4-T2 (`core/schedule.ts`) is a
// second in-flight task, and its own edits to this file are limited to this file's top comment.

/**
 * A minimal notice to show outside the terminal (docs/ESPECIFICACAO.md § "Notificações"). Title
 * and body only — no actions. Spike B (docs/spikes/B-notificacoes.md) measured that action
 * buttons are inconsistent across the three OSes and expensive on two of them (a registered COM
 * server, or an external binary that "pode não estar instalado"); docs/ESPECIFICACAO.md's answer
 * is that no use case ever depends on a click — every notice already names the equivalent command
 * in `body` ("seeya snooze +30m"), and a click, where it turns out to be cheap and reliable, is
 * added later as a pure convenience, never the only path (docs/PLANO-DE-ENTREGA.md S4-T1).
 */
export interface Notice {
  readonly title: string;
  readonly body: string;
}

/**
 * Shows `notice` outside the terminal. Implemented in `adapters/notification/` (S4-T1) as a
 * fallback chain over native-OS backends, degrading to stderr as the guaranteed last resort
 * (docs/spikes/B-notificacoes.md § "Cadeia de fallback proposta", docs/TESTES.md § "Cadeia de
 * fallback do notificador": "primeiro disponível vence; nenhum disponível cai para stderr sem
 * lançar").
 *
 * **Never rejects.** A notification is a courtesy, never the product — the same discipline D-003
 * already applies to a failed generation, applied here to the notice about the day's own result
 * (docs/ESPECIFICACAO.md § `seeya end-day`: notifying is step 5, after the handoff is already
 * written and verified, and after termination already ran or didn't). A caller (`cli/`) never
 * needs a `try`/`catch` around `notify()` — every concrete backend's own failure is caught inside
 * the adapter's fallback chain before it ever reaches this port's caller.
 */
export interface Notifier {
  notify(notice: Notice): Promise<void>;
}
