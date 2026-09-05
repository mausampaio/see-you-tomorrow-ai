/**
 * The project's single composition root (D-020): the only module allowed to name a concrete
 * adapter and wire it behind a `core/ports.ts` interface. `index.ts` calls `buildCliContext` once
 * per invocation with the real home directory; every test that needs these ports builds them by
 * hand against a `tmpdir` instead of importing this file, the same way `docs/TESTES.md` already
 * asks integration tests to do for each adapter on its own.
 */
import os from 'node:os';
import path from 'node:path';
import type {
  Clock,
  Notifier,
  ProcessControl,
  SessionProvider,
  SessionResumer,
  Storage,
} from '../core/ports.js';
import type { Config } from '../core/types.js';
import { processControl as realProcessControl } from '../adapters/process/index.js';
import { systemClock } from '../adapters/clock/index.js';
import { StorageAdapter } from '../adapters/storage/index.js';
import {
  DiscoverySessionProvider,
  DiscoveryForkCleanup,
  discoverEarlyWarnings,
} from '../adapters/discovery/index.js';
import { TranscriptFileReader } from '../adapters/transcript/index.js';
import { GitAdapter } from '../adapters/git/index.js';
import { LeanHandoffGenerator, DeepHandoffGenerator } from '../adapters/generation/index.js';
import { ClaudeSessionResumer } from '../adapters/resumption/index.js';
import { notifier as realNotifier } from '../adapters/notification/index.js';
import type { EndDayDeps } from '../application/types.js';
import type { DaemonDeps } from '../scheduler/index.js';

export interface CliHome {
  readonly claudeHome: string;
  readonly seeyaHome: string;
}

export interface CliContext {
  readonly sessionProvider: SessionProvider;
  readonly config: Config;
  readonly clock: Clock;
}

/**
 * `os.homedir()` resolved once, here — the one place in the project allowed to call it at all
 * (every adapter takes its root injected instead, AGENTS.md § "Sistema de arquivos"). Node's
 * `homedir()` reads `HOME` (POSIX) / `USERPROFILE` (Windows) first, which is exactly the hook
 * docs/TESTES.md's e2e harness relies on to point a real compiled build at a `tmpdir` instead of
 * the operator's real home — nothing here needs its own test-only override.
 */
export function resolveCliHome(homeDir: string = os.homedir()): CliHome {
  return {
    claudeHome: path.join(homeDir, '.claude'),
    seeyaHome: path.join(homeDir, '.seeya'),
  };
}

function buildSessionProvider(
  home: CliHome,
  clock: Clock,
  processControl: ProcessControl,
  relevanceHours: number,
): SessionProvider {
  return new DiscoverySessionProvider({
    claudeHome: home.claudeHome,
    seeyaHome: home.seeyaHome,
    processControl,
    clock,
    relevanceHours,
  });
}

function buildStorage(home: CliHome): Storage {
  return new StorageAdapter(home.seeyaHome);
}

/**
 * Builds every port a `sessions`/`status` command needs, reading `config.json` exactly once
 * (`relevanceHours` has to be known before the `SessionProvider` can be constructed — the config
 * read isn't optional plumbing, it's an input the provider needs). `homeDir` defaults to the real
 * `os.homedir()`; tests pass a `tmpdir` fixture instead, same convention as `resolveCliHome`.
 */
export async function buildCliContext(homeDir: string = os.homedir()): Promise<CliContext> {
  const home = resolveCliHome(homeDir);
  const clock = systemClock;
  const storage = buildStorage(home);
  const config = await storage.readConfig();
  const sessionProvider = buildSessionProvider(
    home,
    clock,
    realProcessControl,
    config.relevanceHours,
  );
  return { sessionProvider, config, clock };
}

export interface EndDayContext {
  readonly deps: EndDayDeps;
  readonly config: Config;
  /**
   * S4-T1: `cli/end-day-command.ts`'s own step 5 (docs/ESPECIFICACAO.md § `seeya end-day`,
   * "Notifica o resultado"). Not part of `EndDayDeps` — `application/end-day.ts`'s own docstring
   * earmarks notifying as happening OUTSIDE `endDay` itself, in whichever caller runs after it.
   */
  readonly notifier: Notifier;
}

/**
 * `seeya end-day`'s own composition (S2-T5, `notifier` added in S4-T1): every port
 * `application/endDay` orchestrates, wired to its real adapter, plus the `Notifier` its own
 * caller (`end-day-command.ts`) uses for step 5. Two pieces this task is the one to switch on,
 * both built and ready since earlier sprints (S2-T2's generators, S2-T6's `ForkCleanup`) but never
 * named by `cli/` until now — D-020 means nothing outside this file was allowed to instantiate
 * them first.
 *
 * `leanGenerator`/`deepGenerator` are both always built, never chosen here: `captureSession`
 * (`application/capture-session.ts`) picks between them per session, since that decision needs
 * `session.hasTranscript`, only known at capture time (see `EndDayDeps`'s own docstring).
 */
export async function buildEndDayContext(homeDir: string = os.homedir()): Promise<EndDayContext> {
  const home = resolveCliHome(homeDir);
  const clock = systemClock;
  const storage = buildStorage(home);
  const config = await storage.readConfig();
  const sessionProvider = buildSessionProvider(
    home,
    clock,
    realProcessControl,
    config.relevanceHours,
  );
  const generatorOptions = {
    model: config.captureModel,
    budgetPerSessionUsd: config.budgetPerSessionUsd,
  };
  const deps: EndDayDeps = {
    sessionProvider,
    transcriptReader: new TranscriptFileReader({ claudeHome: home.claudeHome }),
    gitReader: new GitAdapter({ clock }),
    leanGenerator: new LeanHandoffGenerator(generatorOptions),
    deepGenerator: new DeepHandoffGenerator({
      ...generatorOptions,
      seeyaHome: home.seeyaHome,
      clock,
    }),
    storage,
    processControl: realProcessControl,
    clock,
    forkCleanup: new DiscoveryForkCleanup({
      claudeHome: home.claudeHome,
      seeyaHome: home.seeyaHome,
      clock,
    }),
  };
  return { deps, config, notifier: realNotifier };
}

export interface StartDayContext {
  readonly storage: Storage;
  readonly clock: Clock;
  readonly sessionResumer: SessionResumer;
}

/**
 * `seeya start-day`'s own composition (S3-T3): the two ports its five steps need
 * (docs/ESPECIFICACAO.md § `seeya start-day`) — `Storage` for the briefing and the per-session
 * resumed bookkeeping (step 5), `SessionResumer` for steps 4-5's actual resume. No
 * `SessionProvider`/git/generation here: unlike `end-day`, this command never re-discovers
 * sessions from `~/.claude/` — it works entirely from what `end-day` already persisted (D-004).
 */
export function buildStartDayContext(homeDir: string = os.homedir()): Promise<StartDayContext> {
  const home = resolveCliHome(homeDir);
  const clock = systemClock;
  const storage = buildStorage(home);
  const sessionResumer = new ClaudeSessionResumer({ seeyaHome: home.seeyaHome });
  // No `await`: unlike `buildCliContext`/`buildEndDayContext`, this command never reads
  // `config.json` (it doesn't need `relevanceHours` or any other config field) — but the return
  // type stays `Promise<StartDayContext>` for the same reason those two are async, so `index.ts`
  // can `await` every `build*Context` call uniformly without caring which ones actually do I/O.
  return Promise.resolve({ storage, clock, sessionResumer });
}

/**
 * `seeya daemon`'s own composition (S4-T3): every port `scheduler/` orchestrates, wired to its
 * real adapter — same generators/`ForkCleanup`/`GitReader`/`TranscriptReader` `buildEndDayContext`
 * already wires for `seeya end-day`, since the daemon calls the exact same `application/endDay`
 * pipeline (docs/PLANO-DE-ENTREGA.md S4-T3's own brief: "a S4-T1 entregou a porta `Notifier`... o
 * daemon herda o escopo certo").
 *
 * **`buildSessionProvider` is a closure, not a pre-built `SessionProvider`** — see
 * `scheduler/types.ts#DaemonDeps.buildSessionProvider`'s own docstring for why a long-running
 * daemon can't reuse one instance built once at startup the way every other, short-lived command
 * safely does: a later `seeya config` edit to `relevanceHours` has to take effect on the daemon's
 * very next poll, not just after the daemon itself restarts.
 *
 * **`discoverEarlyWarnings` is likewise a closure** over this function's own `home`/`storage` —
 * `scheduler/` cannot import `adapters/discovery/` at all (docs/ARQUITETURA.md's layer matrix), so
 * this is what lets `scheduler/poll.ts` call the real S1-T7 detection without ever naming it.
 *
 * **Known, accepted limitation: `leanGenerator`/`deepGenerator` are NOT closures.** Both are built
 * once, here, from whatever `captureModel`/`budgetPerSessionUsd` `config.json` held at daemon
 * startup — unlike `relevanceHours` (which affects discovery correctness: which sessions even show
 * up) and unlike the schedule/eligibility values `scheduler/poll.ts` re-reads every single poll, a
 * later `seeya config` edit to the capture model or budget only takes effect after the daemon
 * itself restarts. Accepted because the daemon already restarts on any config edit that matters
 * MORE (the scheduling ones), and rebuilding two generator instances every 30s poll for a value
 * that changes rarely, if ever, during a daemon's lifetime is complexity this task's brief doesn't
 * ask for — flagged in docs/QUESTOES.md Q-049 rather than silently accepted.
 */
export async function buildDaemonContext(homeDir: string = os.homedir()): Promise<DaemonDeps> {
  const home = resolveCliHome(homeDir);
  const clock = systemClock;
  const storage = buildStorage(home);
  const config = await storage.readConfig();
  const generatorOptions = {
    model: config.captureModel,
    budgetPerSessionUsd: config.budgetPerSessionUsd,
  };
  return {
    clock,
    storage,
    notifier: realNotifier,
    processControl: realProcessControl,
    transcriptReader: new TranscriptFileReader({ claudeHome: home.claudeHome }),
    gitReader: new GitAdapter({ clock }),
    leanGenerator: new LeanHandoffGenerator(generatorOptions),
    deepGenerator: new DeepHandoffGenerator({
      ...generatorOptions,
      seeyaHome: home.seeyaHome,
      clock,
    }),
    forkCleanup: new DiscoveryForkCleanup({
      claudeHome: home.claudeHome,
      seeyaHome: home.seeyaHome,
      clock,
    }),
    buildSessionProvider: (relevanceHours) =>
      buildSessionProvider(home, clock, realProcessControl, relevanceHours),
    discoverEarlyWarnings: async (sessions) => {
      const result = await discoverEarlyWarnings(sessions, {
        claudeHome: home.claudeHome,
        storage,
      });
      return result.earlyWarnings;
    },
  };
}
