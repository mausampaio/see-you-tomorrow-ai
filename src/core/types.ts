/**
 * Core domain types. See docs/ESPECIFICACAO.md § "Glossário" and § "Como as sessões são
 * descobertas", and docs/DECISOES.md D-016, D-021, D-023, D-024.
 */

/**
 * The discovered session — the central type of the whole project (S1-T1, grown by S1-T10/D-023).
 *
 * **Discriminated union on `hasPid`, required by D-024.** The review of S1-T0c measured that
 * `pid?: number` on a single type protects only by comment: `item.pid!` compiles without error,
 * and nothing in the type stops `terminateGracefully(item.pid!)`. Here there is no path to that:
 * `SessionWithPid` and `SessionWithoutSessionId` carry a guaranteed `pid` (`number`, never
 * `undefined`); `SessionWithoutPid` doesn't have the `pid` field at all. The process-termination
 * policy (D-002) accepts only the first shape — see `core/termination.ts#processTerminationData`,
 * which only types for `SessionWithPid`, and see that function's own docstring for why
 * `SessionWithoutSessionId` is refused too, on purpose, even though it also carries a `pid`.
 * Whoever holds a `DiscoveredSession` (the union) has to narrow with `if (session.hasPid)` before
 * being able to call that function; the compiler refuses the call without the narrowing, with no
 * `!` at the call site.
 *
 * **A second, independent discriminant: `hasSessionId` (S1-T10/D-023).** D-016's two sources
 * (registry, transcript scan) always give a `sessionId`; only `hasPid` varied. D-023's third
 * source — a `.key` file with no matching `.json`, cross-checked against the live OS process — is
 * the shape that was still missing: it gives a **guaranteed `pid`** (the OS confirms the process
 * is alive) but **never a `sessionId`** (nothing in a bare PID, a filename hash this app is
 * forbidden to read, or an OS command line carries the Claude Code session UUID). Three of the
 * four combinations of the two discriminants are real; the fourth (`hasPid: false, hasSessionId:
 * false` — no PID and no session id at all) is not a session this app can name anything by, and
 * has no source that produces it, so there is deliberately no fourth interface for it:
 *
 * | Shape | `pid` | `sessionId` | Source | Task |
 * |---|---|---|---|---|
 * | `SessionWithPid` | yes | yes | `~/.claude/sessions/<pid>.json` registry | S1-T3 |
 * | `SessionWithoutPid` | no | yes | `~/.claude/projects` transcript scan (`.jsonl` files) | S1-T8 |
 * | `SessionWithoutSessionId` | yes | no | `.key` file + live OS process | S1-T10 |
 *
 * (The transcript-scan row's path is spelled in prose, not as the glob it actually walks: a
 * two-star recursive glob followed by a `.jsonl` pattern, typed literally inside a block comment
 * like this one, contains the exact two characters (star, slash) that close the block early —
 * `tsc` then reports the *next*, unrelated syntax as broken, nowhere near this line. Spelled out
 * in prose on purpose so nobody reintroduces the glob here and loses an afternoon to a
 * `TS1109`/`TS1005` that points at the wrong place.)
 *
 * **Why not `sessionId: string | null` on a single shape instead of a third interface.** This is
 * the exact question D-024 already answered for `pid`, applied to the axis that was still open —
 * and it resolves the same way, for the same reason. A nullable field common to every shape lets
 * `session.sessionId!` compile, and lets a careless `session.sessionId ?? someFallback` manufacture
 * exactly the synthetic session id docs/PLANO-DE-ENTREGA.md S1-T10 forbids (a fake identity that
 * S1-T9's deduplication would then trust as if it were real). A field that is **absent from the
 * type**, not merely `null`, can't be defaulted away by accident: reading `.sessionId` off the
 * union without first narrowing on `hasSessionId` (or `hasPid`, which happens to be equivalent
 * here since only `SessionWithoutSessionId` lacks it) is a compile error, not a runtime surprise.
 * `core/eligibility.ts`'s fork check is the one place in `core/` that had to change for this:
 * `session.hasSessionId && criteria.knownForks.has(session.sessionId)` — a session with no
 * `sessionId` can never be `seeya`'s own fork (forks are tracked by `sessionId`), so the guard is
 * both the compiler's requirement and the semantically correct answer.
 *
 * **Why `hasPid` instead of inferring from the presence of `pid`.** An explicit discriminant
 * (`hasPid: true | false`) makes the `switch`/`if` obvious to the reader and to TypeScript, and
 * avoids depending on `'pid' in session` or on checking `pid !== undefined` scattered through
 * the code — the discriminant is the only place that decides the shape. `hasSessionId` follows
 * the same reasoning, for the same reason, on the other axis.
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
 */
export type DiscoveredSession = SessionWithPid | SessionWithoutPid | SessionWithoutSessionId;

/**
 * Fields every shape of `DiscoveredSession` has in common — everything **except** `sessionId`
 * (S1-T10: no longer common once `SessionWithoutSessionId` exists, see the union's own docstring)
 * and the PID-bearing fields (`pid`, `processIsAlive`; `procStart` never was common). Not
 * exported: whoever needs a common field gets it through the union itself (TypeScript allows
 * accessing a common field without narrowing the discriminant first).
 */
interface CommonSessionFields {
  /** Session's working directory. Identity (D-021) — the only one every shape has; see
   * `sessionId` on `SessionWithPid`/`SessionWithoutPid` for the other half, when it exists. */
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

/** Discovered session with a guaranteed PID **and** a guaranteed `sessionId` — the only shape
 * accepted for termination (D-002, D-024). Comes from the registry strategy (S1-T3): a
 * `<pid>.json` file always carries both. */
export interface SessionWithPid extends CommonSessionFields {
  readonly hasPid: true;
  readonly hasSessionId: true;
  /** Claude Code session UUID. Primary identity (D-021), together with `cwd`. */
  readonly sessionId: string;
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
 * Still carries a guaranteed `sessionId` — the transcript file name (S1-T8) or the record's `id`
 * both identify the session even without a PID.
 */
export interface SessionWithoutPid extends CommonSessionFields {
  readonly hasPid: false;
  readonly hasSessionId: true;
  /** Claude Code session UUID. Primary identity (D-021), together with `cwd`. */
  readonly sessionId: string;
}

/**
 * Discovered session with a guaranteed PID but **no `sessionId` at all** (D-023, S1-T10) — the
 * inverse of `SessionWithoutPid`. Comes from a `.key` file in `~/.claude/sessions/` with no
 * matching `.json` (the shape Claude Code leaves for a session launched interactively with a
 * prompt as its argument), cross-checked against the live OS process for `cwd` and command line.
 *
 * **`processIsAlive` is the literal type `true`, not `boolean`.** Unlike `SessionWithPid` (whose
 * registry entry can be stale — D-016's whole point about reporting `ended`, not discarding), this
 * shape's own discovery strategy (`adapters/discovery/process-key.ts`) never constructs one for a
 * dead PID: a `.key` whose process isn't alive right now is silently ignored before it ever
 * reaches this type (docs/PLANO-DE-ENTREGA.md S1-T10 aceite item 2; D-023: "não é sinal de sessão
 * morta"). The literal type says that in the type itself, not just in a comment — a session of
 * this shape reaching `core/classification.ts#classifyState` always clears the `!processIsAlive`
 * branch and lands on `alive` or `idle`, never `ended`.
 *
 * **Never a candidate for process termination — twice over.** `core/termination.ts
 * #processTerminationData` only accepts `SessionWithPid`, and this shape is a different,
 * unrelated interface: even though it also has a real `pid`, there is no widened parameter type
 * that would let it through by accident (see that function's own docstring for why widening it is
 * the wrong fix, not a missing feature). D-023 itself gives the domain reason, independent of the
 * type: without a `sessionId`, `seeya` cannot verify a handoff was written *for this session*
 * before terminating (D-002's own ordering requirement) — session identity for that check is
 * `sessionId`, not a PID this app inferred from a filename and a command line.
 *
 * **Known limitation: `pid` is not a stable identity for this shape across two scans.** Every
 * other PID-bearing shape ties a fresh liveness reading back to a previously *recorded* value via
 * `procStart` (`core/classification.ts#pidRepresentsSameProcess`) — this shape has no prior
 * record to tie back to (there is no `.json`), so it carries no `procStart` at all: the source
 * genuinely doesn't have one to give, and inventing one would violate D-025. The gap that leaves:
 * two scans of this strategy cannot yet tell "still the same process" from "PID died and the OS
 * recycled it onto something unrelated while the old `.key` file was still sitting there" — S1-T9,
 * which deduplicates this source by `pid` (D-023), inherits this gap and needs to know about it.
 * See docs/QUESTOES.md Q-010.
 */
export interface SessionWithoutSessionId extends CommonSessionFields {
  readonly hasPid: true;
  readonly hasSessionId: false;
  /** PID of the Claude Code process, confirmed alive at discovery time. See the class docstring
   * for why there is no `procStart` to pair it with. */
  readonly pid: number;
  readonly processIsAlive: true;
  /**
   * The process's command line, read from the OS (Linux `/proc/<pid>/cmdline`, macOS `lsof`/`ps`
   * — see `adapters/process/inspection.ts`). D-023: "a linha de comando é fonte de handoff, não
   * só de identificação" — `/<comando> --item 2990` says what the session is doing, first-order
   * information for a session with no transcript at all.
   *
   * **`string | null`, not a bare `string` — a deliberate choice, not the same reasoning as
   * `cwd`.** `cwd` and `commandLine` are two *independent* OS reads (on Linux, two different
   * `/proc/<pid>/*` files; on macOS, two different spawned tools), each with its own failure
   * surface — a process can die in the gap between confirming liveness, reading its `cwd`, and
   * reading its command line, and the two reads aren't guaranteed to succeed or fail together.
   * `cwd` still gates the whole session (`adapters/discovery/process-key.ts` rejects the `.key`
   * candidate outright when it comes back empty — no `cwd`, no identifiable/locatable session,
   * D-021's own test). `commandLine` doesn't: it's display/handoff data, not an identity field
   * (unlike `sessionId`/`pid`/`cwd`), so losing it degrades the session's usefulness without
   * making the session itself unidentifiable — the same D-021 asymmetry that already makes
   * `name`/`kind` optional-with-a-default on `SessionWithPid`'s own source schema, except here
   * there is no safe default to synthesize (an invented placeholder command line would be read as
   * real handoff content, which is exactly what D-025 forbids) — `null` is the honest answer
   * instead.
   */
  readonly commandLine: string | null;
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
