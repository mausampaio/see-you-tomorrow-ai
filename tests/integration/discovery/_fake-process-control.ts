import type { ProcessControl } from '../../../src/core/ports.js';

/**
 * Named double for `ProcessControl` (docs/TESTES.md § Testes: "duplo de I/O é classe/objeto
 * nomeado implementando a porta, não stub inline"). Liveness, `cwd` and command line are each a
 * fixed map keyed by `pid`, supplied by the test. Real process liveness/inspection is
 * `adapters/process`'s own suite (tests/integration/process/); this one is about the discovery
 * adapters' file/JSON handling and field mapping, so faking the port out keeps it independent of
 * any real OS process — except `process-key.test.ts`'s own dedicated real-process describe block
 * (D-023/S1-T10's aceite item 1 needs a real process, same reasoning as
 * tests/integration/process/liveness.test.ts).
 */
export class FakeProcessControl implements ProcessControl {
  constructor(
    private readonly aliveByPid: ReadonlyMap<number, boolean> = new Map(),
    private readonly cwdByPid: ReadonlyMap<number, string> = new Map(),
    private readonly commandLineByPid: ReadonlyMap<number, string> = new Map(),
  ) {}

  isAlive(pid: number): Promise<boolean> {
    // Default true: most fixtures describe a session that's still running: unlisted pids opting
    // into "alive" keeps every other test from having to enumerate every pid it uses.
    return Promise.resolve(this.aliveByPid.get(pid) ?? true);
  }

  readCwd(pid: number): Promise<string | null> {
    // Default null (not found), matching the real adapter's answer for a pid it has nothing for.
    return Promise.resolve(this.cwdByPid.get(pid) ?? null);
  }

  readCommandLine(pid: number): Promise<string | null> {
    return Promise.resolve(this.commandLineByPid.get(pid) ?? null);
  }

  terminateGracefully(): Promise<boolean> {
    return Promise.reject(
      new Error('FakeProcessControl.terminateGracefully is not exercised by the discovery suite'),
    );
  }
}
