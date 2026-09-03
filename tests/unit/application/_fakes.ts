import type {
  Briefing,
  Clock,
  DiscoveryResult,
  ForkCleanup,
  ForkCleanupResult,
  GitEvidenceAcrossRepos,
  GitReader,
  GitReadResult,
  HandoffGenerator,
  ProcessControl,
  RejectedDiscoveryRecord,
  SessionProvider,
  SessionResumer,
  Storage,
  TranscriptListingInfo,
  TranscriptReader,
  TranscriptReadResult,
} from '../../../src/core/ports.js';
import type {
  Config,
  DiscoveredSession,
  EarlyWarningState,
  GeneratedUnderstanding,
  Handoff,
  ResumeOutcome,
  SessionFacts,
} from '../../../src/core/types.js';

/**
 * Named doubles for `application/endDay`'s ports (docs/TESTES.md § Testes: "duplo de I/O é
 * classe/objeto nomeado implementando a porta, não stub inline"). Every fake is deliberately
 * minimal — only the methods `endDay`'s pipeline actually calls are wired to do something useful;
 * the rest reject loudly so a test that exercises an unexpected path fails with a clear message
 * instead of silently returning `undefined`.
 */

export class FakeClock implements Clock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return this.instant;
  }
}

export class FakeSessionProvider implements SessionProvider {
  constructor(private readonly result: DiscoveryResult) {}
  list(): Promise<DiscoveryResult> {
    return Promise.resolve(this.result);
  }
}

const EMPTY_TRANSCRIPT_READ_RESULT: TranscriptReadResult = {
  facts: { lastActivity: null, lastPrompts: [], assistantMessages: [], touchedFiles: [] },
  rejected: [],
  unknownEntryTypeCount: 0,
};

const EMPTY_LISTING_INFO: TranscriptListingInfo = { aiTitle: null, lastPrompt: null };

/** Keyed by `sessionId`. A session not in `bySessionId` gets the "no transcript" default — the
 * same graceful behavior the real `TranscriptFileReader` gives a session it can't locate.
 * `listingBySessionId`/`throwListingFor` (D-031) mirror `bySessionId`/`throwFor` for
 * `readListingInfo` — added as trailing, defaulted parameters so every existing call site (which
 * only ever passed the first two) keeps compiling and keeps its original `readFacts`-only
 * behavior unchanged. */
export class FakeTranscriptReader implements TranscriptReader {
  constructor(
    private readonly bySessionId: ReadonlyMap<string, TranscriptReadResult> = new Map(),
    private readonly throwFor: ReadonlySet<string> = new Set(),
    private readonly listingBySessionId: ReadonlyMap<string, TranscriptListingInfo> = new Map(),
    private readonly throwListingFor: ReadonlySet<string> = new Set(),
  ) {}

  readFacts(session: DiscoveredSession): Promise<TranscriptReadResult> {
    if (this.throwFor.has(session.sessionId)) {
      return Promise.reject(
        new Error(`FakeTranscriptReader: forced failure for ${session.sessionId}`),
      );
    }
    return Promise.resolve(this.bySessionId.get(session.sessionId) ?? EMPTY_TRANSCRIPT_READ_RESULT);
  }

  readListingInfo(session: DiscoveredSession): Promise<TranscriptListingInfo> {
    if (this.throwListingFor.has(session.sessionId)) {
      return Promise.reject(
        new Error(`FakeTranscriptReader: forced listing failure for ${session.sessionId}`),
      );
    }
    return Promise.resolve(this.listingBySessionId.get(session.sessionId) ?? EMPTY_LISTING_INFO);
  }
}

const NOT_A_REPO: GitReadResult = { hasGit: false };

/**
 * Keyed by `cwd`. A `cwd` not in `byCwd` gets `{ hasGit: false }` — the same "not a repository"
 * default the real `GitAdapter` gives a `cwd` outside a working tree.
 *
 * **D-032's `readEvidenceAcrossRepos` deliberately ignores `touchedFiles` and only ever asks about
 * `cwd`** — every existing test configuration here is keyed by `cwd` (`byCwd`/`throwFor` above,
 * predating D-032), and this keeps those configurations meaning the same thing ("git responds for
 * this session") without a real filesystem walk. `root` on the synthesized `RepositoryGitFacts` is
 * just `cwd` itself — good enough for tests that only care about `sources`/one repository's facts,
 * never a stand-in for `adapters/git/git-adapter.ts`'s real multi-root discovery, which is covered
 * by its own integration suite (`tests/integration/git/git-adapter.test.ts`) against a real
 * filesystem instead of a fake.
 */
export class FakeGitReader implements GitReader {
  constructor(
    private readonly byCwd: ReadonlyMap<string, GitReadResult> = new Map(),
    private readonly throwFor: ReadonlySet<string> = new Set(),
  ) {}

  readFacts(cwd: string): Promise<GitReadResult> {
    if (this.throwFor.has(cwd)) {
      return Promise.reject(new Error(`FakeGitReader: forced failure for ${cwd}`));
    }
    return Promise.resolve(this.byCwd.get(cwd) ?? NOT_A_REPO);
  }

  async readEvidenceAcrossRepos(cwd: string): Promise<GitEvidenceAcrossRepos> {
    const result = await this.readFacts(cwd);
    if (!result.hasGit) {
      return { repositories: [], filesOutsideRepository: 0, reposNotVisited: 0 };
    }
    return {
      repositories: [{ root: cwd, ...result.facts }],
      filesOutsideRepository: 0,
      reposNotVisited: 0,
    };
  }
}

/**
 * A `GitReader` whose `readEvidenceAcrossRepos` returns a fixed `GitEvidenceAcrossRepos` no matter
 * what `cwd`/`touchedFiles` it's called with — for testing `evidence-gathering.ts`'s OWN plumbing
 * (does `gatherEvidence` copy `repositories`/`filesOutsideRepository`/`reposNotVisited` onto
 * `HandoffFacts` correctly, including the multi-repository case) independently of the real
 * root-discovery algorithm, which `adapters/git/git-adapter.ts` owns and
 * `tests/integration/git/git-adapter.test.ts` covers against a real filesystem (D-032).
 */
export class StaticGitReader implements GitReader {
  constructor(private readonly result: GitEvidenceAcrossRepos) {}

  readFacts(): Promise<GitReadResult> {
    return Promise.reject(new Error('StaticGitReader.readFacts is not exercised by this double'));
  }

  readEvidenceAcrossRepos(): Promise<GitEvidenceAcrossRepos> {
    return Promise.resolve(this.result);
  }
}

/** Wraps a plain function so a test can express "this generator succeeds with X" or "this
 * generator always fails with Y" without a bespoke class per scenario. */
export class FakeHandoffGenerator implements HandoffGenerator {
  constructor(
    private readonly impl: (
      session: DiscoveredSession,
      facts: SessionFacts,
    ) => Promise<GeneratedUnderstanding>,
  ) {}

  generate(session: DiscoveredSession, facts: SessionFacts): Promise<GeneratedUnderstanding> {
    return this.impl(session, facts);
  }
}

export function succeedingGenerator(result: GeneratedUnderstanding): FakeHandoffGenerator {
  return new FakeHandoffGenerator(() => Promise.resolve(result));
}

export function failingGenerator(message: string): FakeHandoffGenerator {
  return new FakeHandoffGenerator(() => Promise.reject(new Error(message)));
}

/** In-memory `Storage`. `savedHandoffs` starts pre-populated with `existingHandoffs` (today's
 * previous captures, for D-026 tests) and grows as `saveHandoff` is called — `readHandoff` reads
 * from the SAME map, so a test can assert "what would a real re-read see" after a save. */
export class FakeStorage implements Storage {
  readonly savedHandoffs = new Map<string, Handoff>();
  /** Keyed by `day`. Grows every time `endDay`'s S2-T4 step calls `saveBriefing` — a test can
   * assert on the exact markdown, or just that a day got one at all. */
  readonly savedBriefings = new Map<string, string>();

  constructor(
    private readonly config: Config,
    existingHandoffs: ReadonlyMap<string, Handoff> = new Map(),
  ) {
    for (const [key, handoff] of existingHandoffs) {
      this.savedHandoffs.set(key, handoff);
    }
  }

  static key(day: string, sessionId: string): string {
    return `${day}:${sessionId}`;
  }

  readConfig(): Promise<Config> {
    return Promise.resolve(this.config);
  }

  readEarlyWarningState(): Promise<EarlyWarningState> {
    return Promise.reject(
      new Error('FakeStorage.readEarlyWarningState is not exercised by endDay'),
    );
  }

  saveEarlyWarningState(): Promise<void> {
    return Promise.reject(
      new Error('FakeStorage.saveEarlyWarningState is not exercised by endDay'),
    );
  }

  saveHandoff(day: string, handoff: Handoff): Promise<void> {
    this.savedHandoffs.set(FakeStorage.key(day, handoff.sessionId), handoff);
    return Promise.resolve();
  }

  readHandoff(day: string, sessionId: string): Promise<Handoff | null> {
    return Promise.resolve(this.savedHandoffs.get(FakeStorage.key(day, sessionId)) ?? null);
  }

  /** Every handoff currently in `savedHandoffs` for `day` — the in-memory equivalent of a real
   * `sessions/` directory listing, with no corruption to report (`rejected` always empty here; see
   * `StorageWithRejectedHandoffs` below for a double that exercises D-022's other side). */
  listHandoffs(day: string): Promise<{ handoffs: Handoff[]; rejected: RejectedDiscoveryRecord[] }> {
    const prefix = `${day}:`;
    const handoffs = [...this.savedHandoffs.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, handoff]) => handoff);
    return Promise.resolve({ handoffs, rejected: [] });
  }

  saveBriefing(day: string, markdown: string): Promise<void> {
    this.savedBriefings.set(day, markdown);
    return Promise.resolve();
  }

  /** Same "no second read path" rule the real `StorageAdapter#readBriefing` follows (S3-T1):
   * built on this fake's own `listHandoffs`, `null` only when there's nothing at all for `day`. */
  async readBriefing(day: string): Promise<Briefing | null> {
    const { handoffs, rejected } = await this.listHandoffs(day);
    if (handoffs.length === 0 && rejected.length === 0) {
      return null;
    }
    return { day, handoffs, rejected };
  }

  /** Keyed by `day`. A day never saved to comes back empty (D-025) — same convention the real
   * `StorageAdapter` follows for a missing `resumed.json` (S3-T3). */
  readonly resumedSessionIdsByDay = new Map<string, Set<string>>();

  readResumedSessionIds(day: string): Promise<ReadonlySet<string>> {
    return Promise.resolve(this.resumedSessionIdsByDay.get(day) ?? new Set());
  }

  saveResumedSessionIds(day: string, sessionIds: ReadonlySet<string>): Promise<void> {
    this.resumedSessionIdsByDay.set(day, new Set(sessionIds));
    return Promise.resolve();
  }
}

/** Named double for `SessionResumer` (S3-T3, docs/TESTES.md: "duplo de I/O é classe/objeto
 * nomeado implementando a porta"). Records every call, in order, so a test can assert both the
 * outcome AND the exact sequence `application/start-day.ts#resumeSessions` produced. */
export class FakeSessionResumer implements SessionResumer {
  readonly calls: { readonly sessionId: string; readonly cwd: string; readonly prompt: string }[] =
    [];

  constructor(
    private readonly impl: (
      sessionId: string,
      cwd: string,
      prompt: string,
    ) => Promise<ResumeOutcome>,
  ) {}

  resume(sessionId: string, cwd: string, prompt: string): Promise<ResumeOutcome> {
    this.calls.push({ sessionId, cwd, prompt });
    return this.impl(sessionId, cwd, prompt);
  }
}

/** A `SessionResumer` whose every call attaches cleanly (`fellBack: false`). */
export function cleanlyResumingResumer(): FakeSessionResumer {
  return new FakeSessionResumer((sessionId, cwd) =>
    Promise.resolve({ sessionId, cwd, fellBack: false }),
  );
}

/** A `SessionResumer` whose every call throws — the "fallback also failed fast" case
 * (docs/QUESTOES.md Q-027 item 5) `resumeSessions`'s stop-the-loop behavior is tested against. */
export function throwingResumer(message: string): FakeSessionResumer {
  return new FakeSessionResumer(() => Promise.reject(new Error(message)));
}

/** A `Storage` whose `listHandoffs` always reports one extra unreadable entry alongside whatever
 * `FakeStorage` would otherwise return — for the briefing wiring test that checks `endDay`
 * surfaces D-022's rejected side in the generated `summary.md`, not just the accepted one. */
export class StorageWithRejectedHandoffs extends FakeStorage {
  constructor(
    config: Config,
    private readonly rejection: RejectedDiscoveryRecord,
  ) {
    super(config);
  }

  override async listHandoffs(
    day: string,
  ): Promise<{ handoffs: Handoff[]; rejected: RejectedDiscoveryRecord[] }> {
    const { handoffs, rejected } = await super.listHandoffs(day);
    return { handoffs, rejected: [...rejected, this.rejection] };
  }
}

/** A `Storage` whose `saveHandoff` throws — for D-002's "falha na captura aborta o encerramento"
 * tests: a session whose write itself fails must never reach `terminateGracefully`. */
export class FailingSaveStorage extends FakeStorage {
  override saveHandoff(): Promise<void> {
    return Promise.reject(new Error('FailingSaveStorage: saveHandoff always fails'));
  }
}

/** A `Storage` whose `saveHandoff` succeeds but whose `readHandoff` never sees the write — for
 * D-002's verification-gap tests: a handoff that "saved" but can't be read back must also abort
 * termination, not just an outright write failure. */
export class UnverifiableSaveStorage extends FakeStorage {
  override saveHandoff(): Promise<void> {
    return Promise.resolve();
  }

  override readHandoff(): Promise<Handoff | null> {
    return Promise.resolve(null);
  }
}

/** Always reports nothing to clean up unless a test hands it a specific `ForkCleanupResult` —
 * `endDay`'s own tests aren't about D-012, they only need `EndDayDeps` to type-check with a real
 * implementation of every port (S2-T5 added this one). */
export class FakeForkCleanup implements ForkCleanup {
  constructor(private readonly result: ForkCleanupResult = { outcomes: [], rejected: [] }) {}

  cleanup(forkCleanupDays: number): Promise<ForkCleanupResult> {
    // Named/typed (not dropped to zero parameters) so a subclass overriding this method to spy on
    // the argument (endDay.test.ts) has a real parameter to type its own override against, matching
    // the real `ForkCleanup` port's signature exactly. This double itself doesn't need the value.
    void forkCleanupDays;
    return Promise.resolve(this.result);
  }
}

/** A `ForkCleanup` whose `cleanup()` always rejects — for `endDay`'s isolation test: a fork-cleanup
 * failure must never take down captures/briefing that already succeeded in the same run. */
export class FailingForkCleanup implements ForkCleanup {
  cleanup(): Promise<ForkCleanupResult> {
    return Promise.reject(new Error('FailingForkCleanup: cleanup always fails'));
  }
}

export class FakeProcessControl implements ProcessControl {
  constructor(
    private readonly terminateResult: (pid: number) => Promise<boolean> | boolean = () => true,
  ) {}

  isAlive(): Promise<boolean> {
    return Promise.reject(new Error('FakeProcessControl.isAlive is not exercised by endDay'));
  }

  async terminateGracefully(pid: number): Promise<boolean> {
    return this.terminateResult(pid);
  }
}

export const DEFAULT_TEST_CONFIG: Config = {
  endOfDayTime: null,
  leadTimesInMinutes: [30, 15],
  relevanceHours: 12,
  idleMinutes: 45,
  captureModel: 'sonnet',
  budgetPerSessionUsd: 0.25,
  captureConcurrency: 3,
  ignore: [],
  projectPolicy: {},
  forkCleanupDays: 7,
};
