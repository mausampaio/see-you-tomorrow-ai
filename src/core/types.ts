/**
 * Core domain types. See docs/ESPECIFICACAO.md § "Glossário" and § "Como as sessões são
 * descobertas", and docs/DECISOES.md D-016, D-021, D-024.
 */

/**
 * The discovered session — the central type of the whole project (S1-T1).
 *
 * **Discriminated union on `hasPid`, required by D-024.** The review of S1-T0c measured that
 * `pid?: number` on a single type protects only by comment: `item.pid!` compiles without error,
 * and nothing in the type stops `terminateGracefully(item.pid!)`. Here there is no path to that:
 * `SessionWithPid` carries a guaranteed `pid` (`number`, never `undefined`); `SessionWithoutPid`
 * doesn't have the `pid` field at all. The process-termination policy (D-002) accepts only the
 * first shape — see `core/termination.ts#processTerminationData`, which only types for
 * `SessionWithPid`. Whoever holds a `DiscoveredSession` (the union) has to narrow with
 * `if (session.hasPid)` before being able to call that function; the compiler refuses the call
 * without the narrowing, with no `!` at the call site.
 *
 * **Why `hasPid` instead of inferring from the presence of `pid`.** An explicit discriminant
 * (`hasPid: true | false`) makes the `switch`/`if` obvious to the reader and to TypeScript, and
 * avoids depending on `'pid' in session` or on checking `pid !== undefined` scattered through
 * the code — the discriminant is the only place that decides the shape.
 *
 * **Known limitation, in the same spirit as D-019's.** The type covers carelessness — passing a
 * `SessionWithoutPid`, or the un-narrowed union, straight to `processTerminationData` — not a
 * deliberate workaround: `{ hasPid: true } as SessionWithPid` compiles, and
 * `{ ...sessionWithoutPid, hasPid: true } as SessionWithPid` too. That is how `as` behaves on an
 * object literal in TypeScript, not a hole in this design — only the direct cast of an
 * already-typed value (`sessionWithoutPid as SessionWithPid`, without spreading) is refused,
 * because `SessionWithoutPid` and `SessionWithPid` don't overlap enough for the compiler to
 * accept the direct conversion. What D-024 promises, and what this type delivers, is that
 * `item.pid!` and narrowing-free access don't compile — not that no `as` in the whole project can
 * produce a lying value. Deliberate workarounds with `as` go through review, same as any other
 * `as` in the project.
 *
 * **This union briefly had a third shape and a second discriminant, `hasSessionId` — reverted by
 * D-029, S1-T11.** D-023 (S1-T10) added a discovery strategy for a `.key` file with no matching
 * `.json`, cross-checked against the live OS process for `cwd` and command line: a session with a
 * guaranteed `pid` but no `sessionId` at all (`SessionWithoutSessionId`), which needed
 * `hasSessionId` to stay type-safe alongside `hasPid`. D-029 revoked D-023 — the cause it
 * attributed to the phenomenon didn't hold up under measurement, and the cost (a third union
 * shape, per-OS process enumeration, command-line capture with its own privacy question, Q-011)
 * was disproportionate to what was actually observed. With the third shape gone, `hasSessionId`
 * would be `true` on every remaining shape — a discriminant that never discriminates, just a
 * field every caller has to keep writing for no compiler benefit — so it's gone too, and
 * `sessionId` moves back to `CommonSessionFields` below, where it lived before S1-T10: both
 * remaining shapes have always had it, and TypeScript already allows reading a field common to
 * every member of a union without narrowing first. If this reads oddly short next to the amount
 * of history above, that's why — see D-029 for the full account.
 */
export type DiscoveredSession = SessionWithPid | SessionWithoutPid;

/**
 * Fields the two shapes of `DiscoveredSession` have in common. Not exported: whoever needs a
 * common field gets it through the union itself (TypeScript allows accessing a common field
 * without narrowing the discriminant first).
 */
interface CommonSessionFields {
  /** Claude Code session UUID. Primary identity (D-021). */
  readonly sessionId: string;
  /** Session's working directory. Secondary identity (D-021) — together with `sessionId`. */
  readonly cwd: string;
  /**
   * Display name. Never empty: when the record doesn't carry `name` (D-021), the discovery
   * adapter already fills it with a name derived from `cwd` before building this type — this
   * field itself carries no optionality, resolving the default is the adapter's responsibility.
   */
  readonly name: string;
  /**
   * Whether the session has a transcript locatable on disk (D-013). `false` is a normal case —
   * a child session inheriting the marker, `CLAUDE_CODE_SKIP_PROMPT_HISTORY`, etc. — not an
   * error.
   */
  readonly hasTranscript: boolean;
  /**
   * Instant of the last known write to the transcript, or `null` when `hasTranscript` is
   * `false` (there was never anything to write). Used both by state classification (idleness,
   * `core/classification.ts`) and by eligibility (anti-duplication,
   * `core/eligibility.ts`) — both use specifically the transcript, not general activity,
   * because that's what the spec asks for in each case.
   */
  readonly lastTranscriptWrite: Date | null;
  /**
   * The most recent known activity of the session, **across every source available at discovery
   * time** (record, transcript — and git from S2-T1 on) — not just the transcript. `null` when
   * no source answered anything (neither `startedAt` from the record, nor transcript mtime). See
   * docs/ESPECIFICACAO.md § "Elegibilidade": "measured by the most recent source available, not
   * just the transcript" — this field is exactly that fusion, computed by whoever assembles the
   * `DiscoveredSession` (the discovery adapter), not by this type.
   */
  readonly lastActivity: Date | null;
}

/** Discovered session with a guaranteed PID — the only shape accepted for termination (D-002, D-024). */
export interface SessionWithPid extends CommonSessionFields {
  readonly hasPid: true;
  /** PID of the Claude Code process. May be recycled by the OS — see `procStart`. */
  readonly pid: number;
  /**
   * Process start timestamp, in the raw shape from the Claude Code record (string, not
   * `number`: the real values exceed `Number.MAX_SAFE_INTEGER` — same reason as
   * `adapters/discovery/schemas.ts`). Used to break ties on a recycled PID
   * (`core/classification.ts#pidRepresentsSameProcess`).
   */
  readonly procStart: string;
  /**
   * Already-resolved result of checking this PID's liveness (`ProcessControl` port, implemented
   * in S1-T2) — including the `procStart` tie-break. This type does no I/O: whoever discovers
   * the session has already called the port and brings the ready-made result.
   */
  readonly processIsAlive: boolean;
}

/**
 * Discovered session with no PID at all (D-016: coming only from the transcript scan, or from
 * the `background` variant of `agents --json`, which has no PID and uses `id` instead). Never a
 * candidate for process termination — there is no way to, no PID exists to send a signal to.
 */
export interface SessionWithoutPid extends CommonSessionFields {
  readonly hasPid: false;
}

/**
 * A session's display state (docs/ESPECIFICACAO.md § "Glossário"; D-016).
 *
 * - `alive` — process running right now. It's the default state for a live process: it also
 *   holds when there's no evidence at all of a transcript write (`lastTranscriptWrite: null`,
 *   D-013) — `null` isn't a sign of inactivity, it's absence of data, and `idle` is a claim that
 *   requires a real timestamp (D-025).
 * - `idle` — process running right now, **and** a real timestamp of the last transcript write
 *   that has already passed `idleMinutes`. A refinement of `alive` that only applies when
 *   there is positive evidence of silence, never from transcript absence (D-025).
 * - `ended` — process is no longer alive (it died, or the record entry is stale: a recycled PID
 *   with a divergent `procStart`). Reported, not discarded (D-016).
 * - `unknown` — session without a PID (`SessionWithoutPid`): there's no way to check liveness,
 *   so there's no way to say whether it's alive, idle or ended. D-016 spells this fourth state
 *   as "desconhecido" (agreeing with "o estado"); here the chosen form is `unknown`, matching the
 *   other three enum values in style (`sessionState: "alive"`, not an adjective agreeing with
 *   "session"). Just a spelling choice, same meaning; see docs/QUESTOES.md Q-004 about this
 *   fourth state not yet appearing in the handoff schema in docs/ESPECIFICACAO.md.
 */
export type SessionState = 'alive' | 'idle' | 'ended' | 'unknown';

/**
 * Per-project override, keyed by `cwd` in `Config.projectPolicy` (S1-T5). Keyed by `cwd`, not
 * `sessionId` — a project's policy has to survive across many sessions coming and going in that
 * same directory, while `sessionId` changes every time (D-002).
 *
 * Both fields default to `false` when the user's `config.json` mentions the project at all but
 * omits one of them — an opt-in policy that's silent about a flag means "don't opt in to that
 * one", matching D-002 (termination is opt-in) and D-011 (deep capture is opt-in).
 */
export interface ProjectPolicy {
  /** Whether `seeya` may terminate this project's live session after a successful handoff (D-002). */
  readonly canTerminate: boolean;
  /** Whether captures for this project use the deep (`--resume --fork-session`) generator instead of the lean default (D-011). */
  readonly deepCapture: boolean;
}

/**
 * User-facing settings, read from `~/.seeya/config.json` by `Storage.readConfig()` (S1-T5,
 * `core/ports.ts`). Every field has a project-wide default, so a machine with no config file at
 * all (first run, before `seeya init`/S5-T2 exists) still resolves a complete, usable `Config` —
 * a missing config file is read as "use the defaults", never as an error (D-025).
 *
 * **Key names are fixed by AGENTS.md § "Idioma" ("Identificadores que vão para disco")** — once a
 * key is written to a real `config.json` on someone's machine, renaming it is a breaking
 * migration. This type matches that table exactly; it does not introduce a key the table doesn't
 * already have.
 */
export interface Config {
  /**
   * Local end-of-day time, `"HH:MM"` 24h, or `null` to disable the scheduled trigger entirely
   * (manual-only). Never an epoch/instant — the conversion to a concrete instant happens per day,
   * in the local timezone, at the point of use (docs/ARQUITETURA.md § "Fusos e horários"), so
   * daylight saving is handled for free instead of baked into a stored instant.
   */
  readonly endOfDayTime: string | null;
  /** Minutes of advance warning before `endOfDayTime`, e.g. `[30, 15]` for a notice 30 minutes
   * before and another 15 minutes before. */
  readonly leadTimesInMinutes: readonly number[];
  /** Hours of inactivity still considered "recent enough" for eligibility (docs/ESPECIFICACAO.md § "Elegibilidade"; default 12, spelled out there in prose). */
  readonly relevanceHours: number;
  /** Minutes without a transcript write before a live session is classified `idle` instead of `alive` (D-025). */
  readonly idleMinutes: number;
  /** Model passed to `claude -p --model` for the capture's understanding layer (D-003). */
  readonly captureModel: string;
  /** `--max-budget-usd` ceiling per session capture (D-011). */
  readonly budgetPerSessionUsd: number;
  /** How many session captures (headless `claude -p` calls) run at once. */
  readonly captureConcurrency: number;
  /** `cwd`s excluded from discovery/eligibility entirely, exact string match — normalized by
   * whoever assembles the criteria outside `core/` (see `core/eligibility.ts`), not here. */
  readonly ignore: readonly string[];
  /** Per-project overrides, keyed by `cwd`. See `ProjectPolicy`. */
  readonly projectPolicy: Readonly<Record<string, ProjectPolicy>>;
  /**
   * Days a fork `seeya` itself created (D-012) is kept before deletion — "forks com mais de
   * `forkCleanupDays` (default 7) são apagados". Named and fixed in AGENTS.md § "Idioma"
   * ("Identificadores que vão para disco") by Q-013 before this field existed; added here now
   * that S2-T6 is its first real reader (docs/QUESTOES.md Q-013, item 2).
   */
  readonly forkCleanupDays: number;
}

/**
 * "Already warned" bookkeeping for S1-T7's early-warning detection (`core/early-warnings.ts`) —
 * the memory that keeps a warning from repeating on every discovery pass
 * (docs/PLANO-DE-ENTREGA.md S1-T7's acceptance: "a segunda passagem não repete"). Persisted by
 * `Storage.readEarlyWarningState()`/`saveEarlyWarningState()` (S1-T5's port, grown additively
 * here), same as `Config` above.
 *
 * Two independent sets because the two triggers don't share an identifier: a session missing its
 * transcript has a `sessionId` (D-018); a `.key` file with no matching `.json` doesn't (D-029) —
 * see `core/early-warnings.ts`'s docstring for why the second set is keyed by the bare file name,
 * not by PID.
 */
export interface EarlyWarningState {
  readonly notifiedMissingTranscriptSessionIds: ReadonlySet<string>;
  readonly notifiedUninspectableSessionKeys: ReadonlySet<string>;
}

/**
 * Facts extracted straight from a session's transcript (D-003's "layer 1", the deterministic
 * half of the handoff) — produced by `TranscriptReader.readFacts()` (`core/ports.ts`,
 * `adapters/transcript/`, S1-T4). This is **not** the merged `facts` object
 * docs/ESPECIFICACAO.md § "Formato do handoff" persists: that one also folds in git's facts
 * (S2-T1) when the handoff is assembled (S2-T3). This type only carries what the transcript, on
 * its own, can answer.
 *
 * D-025 governs every field here: a transcript not answering a question is `null` or an empty
 * list, never a value invented to look more informative than the evidence supports.
 */
export interface SessionFacts {
  /**
   * Timestamp of the transcript's most recent `user`/`assistant` entry — the only two entry
   * types `adapters/transcript/schemas.ts` confirms carry a `timestamp` field at all. `null`
   * when no such entry was readable (empty transcript, or every line rejected or of an unknown
   * type) — not a claim that the session never had activity, only that none was found here.
   */
  readonly lastActivity: Date | null;
  /**
   * The most recent prompts actually typed by the human user, oldest first, bounded to a fixed
   * window (`adapters/transcript/facts.ts`'s `MAX_LAST_PROMPTS`). Excludes sub-agent turns
   * (`isSidechain: true`) and synthetic tool-result turns — a `user`-role entry whose content is
   * entirely non-text — because neither is something the user wrote, and surfacing either as
   * "what you asked" would misrepresent it. Empty when none were found; never a placeholder
   * claiming the user asked nothing.
   */
  readonly lastPrompts: readonly string[];
  /**
   * The most recent things the assistant itself said, oldest first, bounded to a fixed window
   * (`adapters/transcript/facts.ts`'s `MAX_ASSISTANT_MESSAGES`, each entry capped at
   * `MAX_ASSISTANT_MESSAGE_CHARS`). Added by S4-T00c (docs/QUESTOES.md Q-036) to fix the gap the
   * D-011 reevaluation (docs/DECISOES.md) found: before this field existed, a turn like "4 done, 6
   * pending" was visible nowhere in `SessionFacts` at all, because the transcript reader only ever
   * pulled timestamp and tool-use file paths out of an `assistant` entry — the model's own account
   * of the work was discarded structurally, not filtered out on purpose. Excludes sub-agent turns
   * (`isSidechain: true`), same reasoning as `lastPrompts`: that's internal tool-use narration, not
   * something said to the human. Empty when none were found; never a placeholder claiming the
   * assistant said nothing (D-025).
   *
   * **Feeds `buildLeanPrompt` only — deliberately NOT added to `handoffFactsSchema`/
   * `serializeHandoff` (`adapters/storage/handoff-schema.ts`), so it never becomes a new persisted
   * key in `Handoff` on disk.** That's a maintainer decision, not an oversight — see
   * docs/QUESTOES.md Q-036 for the open question of whether it should also be persisted later.
   */
  readonly assistantMessages: readonly string[];
  /**
   * File paths passed to a write-capable tool (`Edit`, `Write`, `NotebookEdit`) anywhere in the
   * transcript, including inside sub-agent turns — a sub-agent's edit is still the session's own
   * work (D-013). Deduplicated, first-seen order. Empty when none were found.
   */
  readonly touchedFiles: readonly string[];
}

/**
 * One commit, as `docs/ESPECIFICACAO.md` § "Formato do handoff" fixes `facts.git.commitsToday[]`:
 * `sha` (abbreviated — `git log`'s default width, matching that section's `"1b7fd99"` example)
 * and `title` (the subject line). Produced by `adapters/git/` (S2-T1).
 */
export interface GitCommit {
  readonly sha: string;
  readonly title: string;
}

/**
 * One worktree's state, as `docs/ESPECIFICACAO.md`'s handoff example fixes
 * `facts.git.worktrees[]`: `path`, `branch`, `dirty`, and a commit count. Named
 * `commitsTodayCount` here — not `commitsToday`, which the main `cwd`'s `GitFacts` uses below for
 * an array of `GitCommit` — on purpose: the spec's own first draft used the same field name for a
 * bare number inside `worktrees[]` and an array of `{ sha, title }` at the top level, one name
 * with two on-disk shapes in the same document. Q-017 flagged the asymmetry; the review's answer
 * (docs/QUESTOES.md) was to keep the shapes (the other worktrees are a secondary signal, "something
 * happened over there", not the handoff's main subject) but give the count its own name so a
 * handoff reader (S2-T4) never has to branch on which `commitsToday` it got.
 *
 * `branch: null` is a detached `HEAD` — a real, ordinary git state (D-025), not represented by a
 * fake branch name.
 */
export interface WorktreeFacts {
  readonly path: string;
  readonly branch: string | null;
  readonly dirty: boolean;
  readonly commitsTodayCount: number;
}

/**
 * `facts.git`'s shape (`docs/ESPECIFICACAO.md` § "Formato do handoff") once `cwd` is already
 * confirmed to be inside a git working tree — see `GitReadResult` in `core/ports.ts` for the
 * "not a repo at all" case this type deliberately doesn't represent (D-024/D-025: that's a
 * different, less-specific state, not a `GitFacts` with everything empty).
 */
export interface GitFacts {
  /** `null` is the main `cwd`'s own detached `HEAD` — same reasoning as `WorktreeFacts.branch`. */
  readonly branch: string | null;
  readonly dirty: boolean;
  readonly modifiedFiles: readonly string[];
  readonly commitsToday: readonly GitCommit[];
  /** Every *other* worktree of this repository — never includes `cwd`'s own entry (S2-T1). */
  readonly worktrees: readonly WorktreeFacts[];
}

/**
 * A local calendar day, `"YYYY-MM-DD"` — the granularity `~/.seeya/days/<Day>/` is keyed by
 * (docs/ESPECIFICACAO.md § "Formato do handoff"). Produced by `core/day.ts#localDayString` from an
 * already-resolved `Date` (D-019) — never computed from `Date.now()` directly. A plain string
 * alias, not a branded type: nothing in this project brands primitives (`sessionId`, `cwd` are
 * both bare `string` too), so introducing one here just for `Day` would be an inconsistent,
 * unrequested pattern change rather than a real safety gain.
 */
export type Day = string;

/**
 * One of D-013's three evidence sources, exactly as the handoff's own `sources[]` names it
 * (docs/ESPECIFICACAO.md § "Formato do handoff"; AGENTS.md § "Idioma" fixes the three literal
 * values: `git` / `transcript` / `registry`).
 */
export type EvidenceSource = 'git' | 'transcript' | 'registry';

/**
 * The handoff's own `source` field (docs/ESPECIFICACAO.md § "Formato do handoff") — which of
 * three ways the `understanding` layer (D-003) came to be. This describes **provenance of the
 * understanding layer**, not the quality or completeness of the evidence that fed it — that
 * question is `sources[]`'s job (docs/QUESTOES.md Q-021, item 1, revised on review):
 *
 * - `model` — a `HandoffGenerator` call produced real understanding. Applies whenever the model
 *   actually answered, whether or not the session had a transcript: a session with no transcript
 *   still routes through the lean generator when other evidence justifies calling it at all
 *   (D-013), and a successful result from that call is exactly as much "the model produced this"
 *   as one backed by a transcript.
 * - `deterministic` — generation was attempted and failed (network, quota, timeout, missing
 *   binary — `GenerationError`); the handoff is written anyway with only the facts (D-003's
 *   failure decision), `generationError` naming why. Applies regardless of `hasTranscript` too —
 *   a failed call fails for the same reasons whether or not a transcript existed.
 * - `noTranscript` — the model was never called at all, because there was no transcript to
 *   justify the cost. Distinct from a `deterministic` failure: here nothing was attempted, not
 *   attempted-and-failed. `application/`'s generation policy (S2-T3) does not produce this value
 *   today — it always attempts the lean generator when eligible, regardless of `hasTranscript` —
 *   but the value is kept because it names a real state the spec's `source` field anticipates,
 *   for a "skip the model entirely when there's no transcript" policy this codebase may add
 *   later (docs/QUESTOES.md Q-021, item 1).
 */
export type HandoffSource = 'model' | 'deterministic' | 'noTranscript';

/** The handoff's own `captureMode` field (D-011): which `HandoffGenerator` implementation ran. */
export type CaptureMode = 'lean' | 'deep';

/**
 * `facts` inside a persisted `Handoff` (docs/ESPECIFICACAO.md § "Formato do handoff") — the merge
 * `application/endDay` (S2-T3) performs between `SessionFacts` (transcript, S1-T4) and `GitFacts`
 * (S2-T1). Nothing upstream combines the two on its own: `HandoffGenerator.generate()` only ever
 * receives bare `SessionFacts` (`core/ports.ts`), because the model's prompt and the handoff's own
 * `facts` field serve different purposes and don't need to carry the same shape.
 *
 * `git: null` when `cwd` isn't a git repository at all (`GitReadResult.hasGit === false`) — a
 * real, ordinary state (D-025), never a `GitFacts` with every field at its emptiest standing in
 * for "no repo here".
 */
export interface HandoffFacts extends SessionFacts {
  readonly git: GitFacts | null;
}

/**
 * A captured session's handoff document (docs/ESPECIFICACAO.md § "Formato do handoff"), persisted
 * at `~/.seeya/days/<Day>/sessions/<sessionId>.json` by `Storage.saveHandoff()`. Assembled by
 * `application/endDay` (S2-T3) from a `DiscoveredSession`, the `HandoffFacts` gathered for it, and
 * either a `GeneratedUnderstanding` or D-003's deterministic fallback — no single adapter produces
 * this whole shape on its own.
 *
 * Field names match the spec's own disk keys exactly (AGENTS.md § "Idioma", "Identificadores que
 * vão para disco") — this type does not invent a key that table doesn't already have.
 *
 * **No `schemaVersion` field here**, same as `Config`/`EarlyWarningState` above: schemaVersion is
 * a wire-format concern `adapters/storage/handoff-schema.ts` owns entirely (stamped on write,
 * checked on read via `resolveSchemaVersion`), not something `application/endDay` — which builds
 * this value in memory and never touches the disk format directly — needs to know about.
 */
export interface Handoff {
  readonly sessionId: string;
  readonly cwd: string;
  readonly name: string;
  /** Instant this specific session's capture completed (D-019: from the `Clock` port, never a
   * bare `new Date()` read inside `application/` or `core/`). */
  readonly capturedAt: Date;
  readonly sessionState: SessionState;
  /**
   * docs/ESPECIFICACAO.md's daemon-level "guarda de turno ativo", applied here without the 5-minute retry
   * loop that belongs to `scheduler/` (S4-T3, the only layer that owns adjusting *when* a capture
   * runs): `application/endDay` captures the session anyway and only records that it happened
   * mid-turn, never skips it.
   */
  readonly capturedDuringActiveTurn: boolean;
  readonly source: HandoffSource;
  readonly captureMode: CaptureMode;
  /** Which of D-013's three sources answered for this specific handoff — never decoration
   * (docs/ESPECIFICACAO.md's own framing): it's what lets a reader, months later, know what this
   * handoff could see. */
  readonly sources: readonly EvidenceSource[];
  readonly facts: HandoffFacts;
  readonly understanding: string;
  readonly pendingItems: readonly string[];
  readonly tomorrowPlan: readonly string[];
  /** `null` on success (`source: "model"`) or when the model was never called (`source:
   * "noTranscript"`, not produced today — see that value's own docstring). The failed
   * `GenerationError`'s message when generation was attempted and failed (`source:
   * "deterministic"`) — D-025: absence of an error string here IS the claim that nothing failed. */
  readonly generationError: string | null;
}

/**
 * D-003's "layer 2" (the model's understanding) — `HandoffGenerator.generate()`'s success value
 * (`core/ports.ts`, S2-T2). Field names match the handoff's own disk keys exactly (AGENTS.md §
 * "Idioma", "Identificadores que vão para disco": `understanding`, `pendingItems`,
 * `tomorrowPlan`), so whoever assembles the final `Handoff` document (S2-T3) copies these
 * straight across instead of renaming through a second set of names.
 *
 * **No `source` or `generationError` field here, on purpose.** docs/ARQUITETURA.md § `generation/`
 * is explicit: "Erro tipado. Quem decide o fallback é application/, não o adapter" — this type
 * only ever represents a successful generation. A failure is a rejection with a typed error
 * (`adapters/generation/errors.ts#GenerationError`), never a `GeneratedUnderstanding` shaped to
 * look like "the model said nothing" (D-025's spirit applied here: a failed call isn't a
 * degenerate success, it's a different outcome, and the type shouldn't blur the two by making
 * every field optional). `application/endDay` (S2-T3) is what catches that rejection and builds
 * the `source: "deterministic"` handoff (D-003) — this type has no say in that decision.
 */
export interface GeneratedUnderstanding {
  /** Free-text account of what the session was doing, written by the model from the facts (and,
   * in deep capture, the resumed transcript) — never fabricated from an empty transcript (D-025). */
  readonly understanding: string;
  /** What's left unfinished, oldest/most-important first — empty when the model found nothing
   * pending, never a placeholder claiming there was nothing to do. */
  readonly pendingItems: readonly string[];
  /** Suggested plan for the next session, same "empty means empty" rule as `pendingItems`. */
  readonly tomorrowPlan: readonly string[];
}

// Own block at the end of the file on purpose (S3-T2), same reasoning as the `ForkCleanupOutcome`
// block above (S2-T6): a second in-flight task (S3-T1) touches this same file for the briefing-
// reading/prompt-assembly side of Sprint 3, so this addition stays self-contained at the end
// instead of inserting mid-file.

/**
 * Why a `--resume` attempt fell back to a fresh session instead of attaching to the original one
 * (S3-T2, D-004 — corrected by docs/spikes/H-retomada-interativa.md's measurement, see D-015). A
 * discriminated union (D-024): the two causes are told apart for the user, and nothing else is
 * representable.
 *
 * - `resumeFailed` — `claude --resume` itself exited non-zero, and did so fast (before
 *   `adapters/resumption/spawn-interactive.ts`'s grace period, which a real interactive session
 *   always clears). D-025 governs the shape here on purpose: this names only what's known (the
 *   attempt failed, with this exit code) — it never invents WHICH of D-004's named causes (an
 *   expired session, a project that moved) explained it, because a bare exit code can't say, and
 *   `seeya` never got the real terminal's stderr to look at (it went straight to the user's
 *   screen, not to a pipe this port could read).
 * - `promptTooLarge` — the prompt is longer than the positional-argument size threshold Spike H
 *   measured, so `--resume` was never attempted with it as an argument at all: better to know the
 *   ceiling in advance than to find it by failing (D-015's corrected text).
 */
export type ResumeFallbackReason =
  | { readonly kind: 'resumeFailed'; readonly exitCode: number }
  | {
      readonly kind: 'promptTooLarge';
      readonly promptLength: number;
      readonly limitChars: number;
    };

/**
 * One session's resumption outcome (S3-T2). `sessionId`/`cwd` name which session this is about —
 * `seeya start-day --all` (S3-T3) resumes several sessions one at a time and needs to report each
 * by name, never just "something fell back".
 */
export interface ResumeOutcome {
  readonly sessionId: string;
  readonly cwd: string;
  /** `false` when `--resume` attached to the original session — a real interactive continuation.
   * Otherwise names why a fresh session opened instead: D-004's single fallback mechanism,
   * reused for both triggers above, never a second one. */
  readonly fellBack: false | ResumeFallbackReason;
}
