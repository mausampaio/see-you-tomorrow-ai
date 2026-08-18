/**
 * Core domain types. See docs/ESPECIFICACAO.md § "Glossário" and § "Como as sessões são
 * descobertas", and docs/DECISOES.md D-016, D-021, D-023, D-024.
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
 * **Deliberate scope, for whoever touches this in S1-T9/S1-T10.** D-024 asks for two PID-based
 * shapes, and that's all this task (S1-T1) resolves. D-016 (transcript scan, S1-T8) is already
 * covered: a session seen only by the scan is `SessionWithoutPid`, with `sessionId` (the
 * `.jsonl` file name) filled normally. **D-023 (third strategy, S1-T10) is not covered yet**:
 * that source gives `pid` but no `sessionId` at all — the inverse of what D-016 covers. Today
 * `sessionId` is required in both shapes because no task so far needs the opposite case; the
 * union will gain a third shape (or `sessionId` becomes nullable on `SessionWithPid`) once S1-T10
 * is implemented — not before, so as not to get ahead of scope. See docs/QUESTOES.md Q-004.
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
 *   that has already passed `minutosParaOcioso`. A refinement of `alive` that only applies when
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
