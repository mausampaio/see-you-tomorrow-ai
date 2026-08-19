import type { ProcessControl } from '../../../src/core/ports.js';

/**
 * Named double for `ProcessControl` (docs/TESTES.md § Testes: "duplo de I/O é classe/objeto
 * nomeado implementando a porta, não stub inline"). Liveness is a fixed map keyed by `pid`,
 * supplied by the test. Real process liveness is `adapters/process`'s own suite
 * (tests/integration/process/); this one is about the discovery adapters' file/JSON handling and
 * field mapping, so faking the port out keeps it independent of any real OS process.
 *
 * **Briefly (S1-T10 to S1-T11) also faked `readCwd`/`readCommandLine`, with two more constructor
 * maps, for the `.key`-without-`.json` discovery strategy (D-023).** Removed along with that
 * strategy and the two `ProcessControl` methods it needed — see docs/DECISOES.md D-029.
 */
export class FakeProcessControl implements ProcessControl {
  constructor(private readonly aliveByPid: ReadonlyMap<number, boolean> = new Map()) {}

  isAlive(pid: number): Promise<boolean> {
    // Default true: most fixtures describe a session that's still running: unlisted pids opting
    // into "alive" keeps every other test from having to enumerate every pid it uses.
    return Promise.resolve(this.aliveByPid.get(pid) ?? true);
  }

  terminateGracefully(): Promise<boolean> {
    return Promise.reject(
      new Error('FakeProcessControl.terminateGracefully is not exercised by the discovery suite'),
    );
  }
}
