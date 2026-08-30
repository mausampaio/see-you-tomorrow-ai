/**
 * The project's single composition root (D-020): the only module allowed to name a concrete
 * adapter and wire it behind a `core/ports.ts` interface. `index.ts` calls `buildCliContext` once
 * per invocation with the real home directory; every test that needs these ports builds them by
 * hand against a `tmpdir` instead of importing this file, the same way `docs/TESTES.md` already
 * asks integration tests to do for each adapter on its own.
 */
import os from 'node:os';
import path from 'node:path';
import type { Clock, ProcessControl, SessionProvider, Storage } from '../core/ports.js';
import type { Config } from '../core/types.js';
import { processControl as realProcessControl } from '../adapters/process/index.js';
import { systemClock } from '../adapters/clock/index.js';
import { StorageAdapter } from '../adapters/storage/index.js';
import { DiscoverySessionProvider, DiscoveryForkCleanup } from '../adapters/discovery/index.js';
import { TranscriptFileReader } from '../adapters/transcript/index.js';
import { GitAdapter } from '../adapters/git/index.js';
import { LeanHandoffGenerator, DeepHandoffGenerator } from '../adapters/generation/index.js';
import type { EndDayDeps } from '../application/types.js';

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
}

/**
 * `seeya end-day`'s own composition (S2-T5): every port `application/endDay` orchestrates, wired
 * to its real adapter. Two pieces this task is the one to switch on, both built and ready since
 * earlier sprints (S2-T2's generators, S2-T6's `ForkCleanup`) but never named by `cli/` until now
 * — D-020 means nothing outside this file was allowed to instantiate them first.
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
  return { deps, config };
}
