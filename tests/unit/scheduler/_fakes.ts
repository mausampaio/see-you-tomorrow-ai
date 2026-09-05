/**
 * Named doubles for `scheduler/`'s own tests (docs/TESTES.md: "duplo de I/O é classe/objeto
 * nomeado implementando a porta, não stub inline"). Builds on `tests/unit/application/_fakes.ts`'s
 * `FakeStorage` rather than duplicating its `readConfig`/`saveHandoff`/etc. — `InMemoryDaemonStorage`
 * below only overrides the five S4-T3 methods that fake left rejecting (accurately: `endDay` itself
 * never calls them), the same extension pattern `StorageWithRejectedHandoffs`/`FailingSaveStorage`
 * already use in that file for a different subset of methods.
 */
import type { Notifier, ProcessControl } from '../../../src/core/ports.js';
import type { DaemonLockInfo } from '../../../src/core/daemon-lock.js';
import type { DayState } from '../../../src/core/types.js';
import type { Notice } from '../../../src/core/ports.js';
import { FakeStorage } from '../application/_fakes.js';

/** Real in-memory `estado.json`/`daemon.lock` — what every `scheduler/` test needs that
 * `application/endDay`'s own tests never touch. */
export class InMemoryDaemonStorage extends FakeStorage {
  private state: DayState | null = null;
  private lock: DaemonLockInfo | null = null;

  override readState(): Promise<DayState | null> {
    return Promise.resolve(this.state);
  }

  override saveState(state: DayState): Promise<void> {
    this.state = state;
    return Promise.resolve();
  }

  override readDaemonLock(): Promise<DaemonLockInfo | null> {
    return Promise.resolve(this.lock);
  }

  override writeDaemonLock(lock: DaemonLockInfo): Promise<void> {
    this.lock = lock;
    return Promise.resolve();
  }

  override clearDaemonLock(): Promise<void> {
    this.lock = null;
    return Promise.resolve();
  }
}

/** Records every `Notice` shown, in order — `scheduler/` tests assert both content and count (no
 * repeat notification for the same lead time/day, docs/PLANO-DE-ENTREGA.md S4-T3's acceptance). */
export class RecordingNotifier implements Notifier {
  readonly notices: Notice[] = [];

  notify(notice: Notice): Promise<void> {
    this.notices.push(notice);
    return Promise.resolve();
  }
}

/** `isAlive`/`terminateGracefully` both controllable per test, unlike
 * `tests/unit/application/_fakes.ts#FakeProcessControl` (whose `isAlive` always rejects — accurate
 * for `endDay`, which never calls it, but `scheduler/lock.ts` calls it on every lock check). */
export class ControllableProcessControl implements ProcessControl {
  constructor(
    private readonly aliveByPid: ReadonlyMap<number, boolean> = new Map(),
    private readonly terminateResult: (pid: number) => Promise<boolean> | boolean = () => true,
  ) {}

  isAlive(pid: number): Promise<boolean> {
    return Promise.resolve(this.aliveByPid.get(pid) ?? false);
  }

  async terminateGracefully(pid: number): Promise<boolean> {
    return this.terminateResult(pid);
  }
}
