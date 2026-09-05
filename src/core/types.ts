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
 * `facts.git`'s per-repository shape (`docs/ESPECIFICACAO.md` § "Formato do handoff") once a
 * candidate root is already confirmed to be inside a git working tree — see `GitReadResult` in
 * `core/ports.ts` for the "not a repo at all" case this type deliberately doesn't represent
 * (D-024/D-025: that's a different, less-specific state, not a `GitFacts` with everything empty).
 *
 * **D-032: one session may carry several of these now** (`RepositoryGitFacts[]` below, via
 * `HandoffFacts.git`) — this type itself is unchanged, still exactly one repository's facts; it's
 * `RepositoryGitFacts` that adds the `root` a caller needs once there can be more than one.
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
 * One repository's `GitFacts`, tagged with the repository's own root directory (D-032, S4-T0).
 * Before this task, `HandoffFacts.git` carried a single `GitFacts | null`, implicitly "whatever
 * `cwd` itself points at" — that broke the moment a maintainer's own capture came back with
 * `sources: ["transcript","registry"]` and zero git facts, because the session launched from
 * `C:\code`, the *parent* of the repository (`C:\code\see-you-tomorrow-ai`) all the real work
 * happened in. Evidence now follows `touchedFiles` (D-032's own text: "sobe de cada arquivo até
 * achar um `.git`, desduplica pela raiz"), so a list needs each entry to say WHICH repository it
 * describes — `root` is that label, produced by `adapters/git/repo-roots.ts#findRepoRoot` and
 * de-duplicated via `core/cwd-normalization.ts` (S3-T5, reused rather than reimplemented — see
 * `adapters/git/git-adapter.ts#readEvidenceAcrossRepos`).
 *
 * Not folded into `GitFacts` itself: every existing reader of a bare `GitFacts` (`WorktreeFacts`'s
 * sibling shape, `core/evidence.ts`'s old single-repo token) has no use for a `root` field, and
 * D-024's own reasoning — give a shape only the fields the cases that need it actually use — argues
 * against bolting one on everywhere just for this one new list.
 */
export interface RepositoryGitFacts extends GitFacts {
  /**
   * Absolute path to this repository's root, exactly as `findRepoRoot` resolved it — not
   * necessarily byte-identical to how the user's shell or Claude Code itself originally spelled the
   * directory. Normalized only enough to DEDUPLICATE two spellings of the same root
   * (`core/cwd-normalization.ts`), never to compare against anything else: this is a display/
   * identity value, not a second comparison key a caller should build its own logic on.
   */
  readonly root: string;
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
 * **D-032: `git` is a LIST, one entry per repository discovered among `touchedFiles` and the
 * session's own launch `cwd`** — replaces the single `GitFacts | null` this field carried before a
 * real capture of the maintainer's own session came back `sources: ["transcript","registry"]` with
 * zero git facts, because the session launched from `C:\code`, the *parent* of the repository all
 * the actual work happened in (`C:\code\see-you-tomorrow-ai`), and evidence-gathering only ever
 * asked git about the launch `cwd` itself. `git: []` means no repository was found among every path
 * this session touched — a real, ordinary absence of evidence (D-025), never a `GitFacts` with
 * every field at its emptiest standing in for "no repo here" the way the old `null` sentinel did.
 */
export interface HandoffFacts extends SessionFacts {
  readonly git: readonly RepositoryGitFacts[];
  /**
   * How many distinct `touchedFiles` entries could not be traced up to ANY git repository at all
   * (D-032's own measurement on the session that motivated it: 12 of 47) — declared instead of
   * silently dropped (D-025's "conte e declare" applied to files instead of a whole missing
   * source). Deliberately excludes the launch `cwd` itself when IT isn't a repository: `sources`
   * already carries that fact (no `RepositoryGitFacts` entry rooted there), and folding it in here
   * would report the exact same absence twice under two different names.
   *
   * `null` only for a handoff migrated up from schemaVersion 1
   * (`adapters/storage/handoff-schema.ts`'s migration, D-032's own mandatory-migration text): that
   * shape never tracked this at all, so `0` would claim a measurement this project never took, not
   * really "zero files" (D-025's "ausência não vira afirmação", applied to a migrated record
   * instead of a freshly gathered one). Every handoff captured under D-032 always writes a real
   * number, `0` included.
   */
  readonly filesOutsideRepository: number | null;
  /**
   * How many repository roots were discovered among `touchedFiles`/`cwd` but skipped for staying
   * inside `adapters/git/git-adapter.ts`'s `MAX_GIT_ROOTS_TO_VISIT` — an I/O ceiling (each visit
   * costs several `git` subprocess calls), never a judgment about which repository matters more
   * (D-032's own text: "rotulado no código como E/S e não julgamento de produto" — the same
   * distinction docs/QUESTOES.md Q-025 already drew for `MAX_BRIEFING_SCAN_DAYS`). Same
   * migrated-record `null` as `filesOutsideRepository` above; a live capture always writes a real
   * number, `0` meaning "every discovered root was visited".
   */
  readonly reposNotVisited: number | null;
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

// Own block at the end of the file on purpose (S4-T2), same reasoning as every addition above
// this one: a second in-flight task (S4-T1, `adapters/notification`) doesn't touch `core/types.ts`
// at all, so there is no concurrent editor to collide with here today, but keeping the habit costs
// nothing and keeps the file's own history consistent.

/**
 * Per-local-day scheduling bookkeeping (D-006, `core/schedule.ts`) — what the daemon (S4-T3) has
 * to remember across poll cycles, and what `seeya snooze`/`seeya skip-today` (S4-T4) mutate, so
 * that a pure decision function never repeats a lead-time notification or an end-of-day closure
 * it already produced, and so "adiar" accumulates instead of resetting (D-006: "não há limite de
 * adiamentos"). AGENTS.md § "Idioma" reserves the disk shape (`estado.json`, cited by D-006's own
 * text) and the `Storage.saveState` method name for whoever wires real persistence — that's
 * S4-T3/S4-T4, not this task (docs/QUESTOES.md Q-037): this is the *domain* type only, the same
 * way `core/ports.ts`'s own top comment already explains for every port this project declared
 * before its adapter existed.
 *
 * **Carries its own `day`, unlike `EarlyWarningState` above.** That state is "once per artifact,
 * forever" (S1-T7) and never resets; this one is explicitly "por dia" (D-006), and
 * `core/schedule.ts`'s functions all compare `day` against `core/day.ts#localDayString(now)`
 * before trusting the rest of the fields — a state object left over from yesterday (whatever
 * `Storage` implementation ends up handing back one) is treated as `emptyDayState(today)` instead
 * of carrying a stale skip/snooze/already-fired flag past local midnight. This is a mandatory
 * `docs/TESTES.md` case ("virada de meia-noite zerando o estado do dia") and has to hold
 * regardless of how S4-T3/S4-T4 end up keying the file on disk — see `core/schedule.ts`'s own
 * docstring for why that reset can't wait for the storage layer to exist.
 */
export interface DayState {
  readonly day: Day;
  /** "pular hoje" (D-006) — set by `seeya skip-today`, overrides everything else for the rest of
   * this local day (`core/schedule.ts#decideSchedule` checks it first). */
  readonly skipped: boolean;
  /** Sum of every `seeya snooze` increment applied today, in minutes — cumulative, never reset
   * except by the day turning over (D-006: "não há limite de adiamentos"). Added to the nominal
   * `endOfDayTime` instant, never re-interpreted as a new wall-clock time of its own. */
  readonly snoozeMinutesTotal: number;
  /** Which of `Config.leadTimesInMinutes`' values already produced a notification today — the
   * memory a stateless daemon poll (every 30s, docs/ESPECIFICACAO.md) needs so the same lead-time
   * warning doesn't fire on every tick it's crossed on. */
  readonly firedLeadTimesInMinutes: readonly number[];
  /** Whether today's end-of-day closure has already been produced. Sticky for the rest of the
   * local day once `true` — a day that already closed doesn't reopen because of a later snooze
   * (there is nothing left to delay). */
  readonly endOfDayFired: boolean;
  /**
   * How many capture attempts (`application/endDay`, called by `scheduler/`) have already counted
   * against each `sessionId` today — added in S4-T3, docs/QUESTOES.md Q-040 item 3. Keyed by
   * `sessionId`, resets with the rest of `DayState` at local midnight (`core/schedule.ts`'s
   * `resetIfNewDay`/`emptyDayState`, which this field rides along with for free — nothing here
   * needed to change to get that reset, since both just spread `...current`/return a fresh
   * `emptyDayState(today)`).
   *
   * **Only incremented for an outcome that ISN'T a fresh, model-sourced success**
   * (`scheduler/capture-retry.ts#recordCaptureAttempts`): a full capture failure, or a captured
   * handoff whose `source` is `deterministic`/`noTranscript` (Q-040: neither is a verdict from the
   * model about the session, so `core/eligibility.ts`'s anti-duplication doesn't block a retry on
   * its own — see that file's condition 5). Why this has to be daemon-owned state, not derived from
   * handoffs already on disk: `Storage.saveHandoff` **overwrites**, one handoff per session per day
   * (Q-040) — there is no history of past attempts to recount from, only the latest one.
   *
   * **Why this counter exists at all.** `seeya end-day` run once by hand tolerates a failing
   * generation call just fine — the person sees the failure and moves on. The daemon's own
   * active-turn retry (docs/ESPECIFICACAO.md § "Comportamento do daemon": up to 5 minutes,
   * `scheduler/poll.ts`) calls `endDay` again every ~30s poll during that window, and a session
   * whose model call is genuinely broken (quota, network, a down endpoint) would otherwise be
   * re-attempted on every one of those polls — money spent on every retry, with the same failure
   * guaranteed each time. `scheduler/capture-retry.ts#sessionsExhaustedToday` reads this map to
   * exclude an exhausted `sessionId` from `EndDayOptions.sessionFilter` on the NEXT attempt, so the
   * waste is bounded instead of repeating for the rest of the active-turn window.
   */
  readonly captureAttemptsToday: Readonly<Record<string, number>>;
}

// Own block at the end of the file on purpose (S4-T0b), same reasoning as every addition above
// this one: a second in-flight task (S4-T00e, `core/eligibility.ts`/
// `application/eligibility-assembly.ts`) doesn't touch `core/types.ts` at all, so there is no
// concurrent editor to collide with here today, but keeping the habit costs nothing.

/**
 * D-031's listing line's transcript-derived half: whether `ai-title`/`last-prompt` were actually
 * read, and if so, what they carried (S4-T0c, from the Q-041 follow-up).
 *
 * **A discriminated union, not `aiTitle`/`lastPrompt` plus a bolted-on `readError: string | null`
 * (D-024).** Before S4-T0c, "the transcript never carried an `ai-title`" (ordinary — most sessions
 * never write one) and "the transcript could not be read at all" (a real I/O failure: permission
 * denied, the file vanishing mid-read) both landed on the exact same `{ aiTitle: null, lastPrompt:
 * null }` shape — `application/session-listing.ts#buildOneListing` caught the read failure and
 * quietly reused `TranscriptReader.readListingInfo`'s own "nothing found" degrade for it. Flattening
 * the two is exactly what D-025 forbids: only the second one is someone's problem to go fix, the
 * same distinction D-022 already draws between "aceitos e rejeitados" for a whole collection,
 * applied here to a single entry's two fields instead.
 *
 * `kind: 'read'`'s `aiTitle`/`lastPrompt` still come from the two free transcript entries D-031/
 * Spike I measured (`ai-title`, `last-prompt`) — internal, undocumented Claude Code entries neither
 * this project nor the user ever asked to be written. **`null` on either is "listing without a
 * title", never an invented one** (D-025): the ressalva D-031 itself states for exactly this case,
 * and it stays the ordinary, non-alarming outcome — most sessions never write an `ai-title` at all.
 */
export type SessionListingInfo =
  | { readonly kind: 'read'; readonly aiTitle: string | null; readonly lastPrompt: string | null }
  | {
      readonly kind: 'unreadable';
      /** AGENTS.md § "Mensagens de erro": the raw failure, not just "could not read". */
      readonly reason: string;
    };

/**
 * D-031's "listing" line for a session that fell OUTSIDE the day's capture scope — a session with
 * no live registry entry at all (`SessionWithoutPid`, `sessionState: "unknown"`), which D-031
 * reads as "closed gracefully: the person closed it themselves", never as work to capture. See
 * `core/capture-scope.ts#isCaptureCandidate` for the scope cut this type is the OTHER side of.
 *
 * Deliberately its own type, not a trimmed-down `Handoff` or an addition to `SessionFacts`: a
 * listed session was never captured, has no `understanding`/`pendingItems`/`tomorrowPlan`, and
 * mixing the two would make "was this session captured or only listed?" a question a reader has
 * to infer from which fields happen to be empty instead of one the type already answers by which
 * shape it is (D-024's own reasoning, applied here to a much smaller union of concerns).
 */
export interface SessionListing {
  readonly sessionId: string;
  readonly cwd: string;
  readonly name: string;
  /** See `SessionListingInfo` above (S4-T0c) for why this is a discriminated union rather than two
   * flat, possibly-inconsistent fields. */
  readonly info: SessionListingInfo;
}

/**
 * Whether an `endDay` execution covered every discovered session, or was narrowed to one by
 * `--session` (S4-T0c, born from the Q-041 follow-up — see `core/briefing.ts`'s own top comment for
 * why the artifact needs this at all).
 *
 * **A discriminated union, not an optional `sessionValue: string | undefined` on its own (D-024).**
 * The daemon (S4-T3) always runs the full day and never sets `--session`, so this type has to say
 * "full day" with the same explicitness it says "narrowed" — "the field is missing" must never be
 * how either meaning gets read (D-025's "ausência de dado não vira afirmação", applied here to the
 * artifact's own framing instead of to a single fact inside it).
 *
 * `sessionValue` is the RAW `--session` value as the user typed it
 * (`cli/end-day-command.ts#EndDayCommandOptions.session`: an id, a `sessionId` prefix, a display
 * `name`, or a `cwd`) — never the resolved `sessionId` `endDay` actually filtered by. Same reasoning
 * `formatNoMatchMessage` (`cli/end-day-command.ts`) already applies to its own message: `seeya` has
 * no way to know what was typed, only what arrived, and showing that value unmodified is what lets
 * a reader recognize, days later, which invocation produced this file.
 */
export type EndDayScope =
  { readonly kind: 'fullDay' } | { readonly kind: 'singleSession'; readonly sessionValue: string };

/**
 * `EndDayScope`, resolved with the discard counts `application/end-day.ts#applyCaptureScope`
 * already holds by the time D-031's scope cut runs — S4-T0d, a follow-up to S4-T0c/Q-041's own
 * CORREÇÃO (`docs/QUESTOES.md`): the artifact used to say a `--session` run's other sessions "may
 * not have been looked at", when `captureCandidates` and `sessionsInScope` were sitting side by
 * side in the same function the whole time — "how many were discarded" was always a subtraction of
 * two arrays already in hand, never a fact `endDay` lacked.
 *
 * **Never the shape of `EndDayOptions.scope`'s own caller-supplied input.** `EndDayScope` above
 * stays exactly what a `--session` value looks like the moment it arrives, BEFORE `endDay` has run
 * its own discovery — the counts below don't exist yet at that point, and giving the input type a
 * placeholder (`0`? `undefined`?) to fill until then would make an unresolved scope carry data that
 * reads as real (D-025's mistake, applied to the scope's own shape instead of to a fact inside it).
 * Only `EndDayResult.scope` and what renders it (`core/briefing.ts`, `cli/format-end-day.ts`) ever
 * see this type.
 */
export type ResolvedEndDayScope =
  | { readonly kind: 'fullDay' }
  | {
      readonly kind: 'singleSession';
      readonly sessionValue: string;
      /**
       * D-031's capture-candidate population (`core/capture-scope.ts#isCaptureCandidate`) BEFORE
       * `--session` narrowed it further — the denominator the scope note's arithmetic needs.
       * Deliberately **not** `EndDayResult.discoveredCount`: that also counts D-031's closed-session
       * population, sent to the listing instead of capture — a session `--session` never had a
       * chance to discard because it was never a capture candidate to begin with. Mixing the two
       * populations is exactly the mistake S4-T0d's own brief warned against, and the test that
       * would catch it needs all three populations present at once — two is not enough to tell a
       * correct denominator from a wrong one that happens to still look plausible.
       */
      readonly captureCandidateCount: number;
      /**
       * How many of `captureCandidateCount` matched `--session` and were actually attempted.
       * Mirrors `EndDayResult.sessionsInScope` for a narrowed run — both numbers come out of the
       * same `applyCaptureScope` call, never computed twice — kept here too so `core/briefing.ts`'s
       * pure `renderScopeNote` has everything the note's subtraction needs from `scope` alone.
       */
      readonly consideredCount: number;
    };
