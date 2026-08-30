import type {
  Clock,
  DiscoveryResult,
  GitReader,
  GitReadResult,
  HandoffGenerator,
  ProcessControl,
  SessionProvider,
  Storage,
  TranscriptReader,
  TranscriptReadResult,
} from '../../../src/core/ports.js';
import type {
  Config,
  DiscoveredSession,
  EarlyWarningState,
  GeneratedUnderstanding,
  Handoff,
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
  facts: { lastActivity: null, lastPrompts: [], touchedFiles: [] },
  rejected: [],
  unknownEntryTypeCount: 0,
};

/** Keyed by `sessionId`. A session not in `bySessionId` gets the "no transcript" default — the
 * same graceful behavior the real `TranscriptFileReader` gives a session it can't locate. */
export class FakeTranscriptReader implements TranscriptReader {
  constructor(
    private readonly bySessionId: ReadonlyMap<string, TranscriptReadResult> = new Map(),
    private readonly throwFor: ReadonlySet<string> = new Set(),
  ) {}

  readFacts(session: DiscoveredSession): Promise<TranscriptReadResult> {
    if (this.throwFor.has(session.sessionId)) {
      return Promise.reject(
        new Error(`FakeTranscriptReader: forced failure for ${session.sessionId}`),
      );
    }
    return Promise.resolve(this.bySessionId.get(session.sessionId) ?? EMPTY_TRANSCRIPT_READ_RESULT);
  }
}

const NOT_A_REPO: GitReadResult = { hasGit: false };

/** Keyed by `cwd`. A `cwd` not in `byCwd` gets `{ hasGit: false }` — the same "not a repository"
 * default the real `GitAdapter` gives a `cwd` outside a working tree. */
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
};
