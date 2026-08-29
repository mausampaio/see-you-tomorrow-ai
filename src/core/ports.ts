/**
 * Core ports — the interfaces every access to the world has to go through
 * (docs/ARQUITETURA.md § "Princípio"). `core/` declares the interface; `adapters/`
 * implements it; `cli/` is the only composition root that names the concrete implementation and
 * injects it (D-020).
 *
 * **Only the four ports declared so far.** docs/ARQUITETURA.md already sketches seven ports (the
 * whole architecture design), but the three missing here all share the same concrete problem: the
 * signature of each references a type that doesn't exist in this project yet. Declaring them now
 * would mean inventing those types too early, just to fill in a signature, or declaring the port
 * with `unknown` — worse than not declaring it. The three, and the type missing from each:
 *
 * - `HandoffGenerator` — returns `GeneratedUnderstanding`, also a handoff type. Implemented in
 *   S2-T2.
 * - `Notifier` — implemented in S4-T1. S1-T7's pure rule (notify once per `sessionId`,
 *   never repeating) doesn't need the whole port to be pure; whoever implements S1-T7 decides
 *   the minimal shape that rule needs.
 * - `Storage` — the signature in docs/ARQUITETURA.md uses `Handoff`, `Briefing`,
 *   `DayState`, none of which exist yet. S1-T5 declares here whatever it needs, at whatever
 *   size it has at that point (likely `readConfig`/`saveState` first, growing in S2 for the
 *   handoff/briefing methods).
 *
 * Open question about this scope cut: docs/QUESTOES.md Q-004.
 */
import type { DiscoveredSession, SessionFacts } from './types.js';

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
