/**
 * Named `Notifier`/`Storage` doubles for `cli/` tests (docs/TESTES.md: "duplo de I/O é
 * classe/objeto nomeado implementando a porta, não stub inline").
 */
import type { Notice, Notifier } from '../../../src/core/ports.js';
import type { Config, DayState } from '../../../src/core/types.js';
import { FakeStorage } from '../application/_fakes.js';

/** Records every `Notice` it was asked to show, in order — never throws. */
export class RecordingNotifier implements Notifier {
  readonly notices: Notice[] = [];

  notify(notice: Notice): Promise<void> {
    this.notices.push(notice);
    return Promise.resolve();
  }
}

/** Always rejects — proves a caller survives a broken `Notifier` (docs/core/ports.ts#Notifier:
 * "never rejects" is the CONTRACT; this fake exists to prove the CALLER doesn't just trust that
 * blindly). */
export class ThrowingNotifier implements Notifier {
  notify(): Promise<void> {
    return Promise.reject(new Error('ThrowingNotifier always rejects'));
  }
}

/**
 * In-memory `estado.json`/`config.json` for `snooze-command.test.ts`/`config-command.test.ts`
 * (S4-T4) — built on `tests/unit/application/_fakes.ts#FakeStorage` rather than duplicating its
 * `readHandoff`/`listHandoffs`/etc. reject-stubs, same extension pattern
 * `tests/unit/scheduler/_fakes.ts#InMemoryDaemonStorage` already uses for the daemon's own
 * `readState`/`saveState`/lock trio. Adds `saveConfig` on top of what that one covers, since
 * `seeya config` (unlike the daemon) actually calls it.
 */
export class InMemoryScheduleStorage extends FakeStorage {
  private state: DayState | null = null;
  private currentConfig: Config;
  readonly savedConfigs: Config[] = [];

  constructor(initialConfig: Config) {
    super(initialConfig);
    this.currentConfig = initialConfig;
  }

  override readConfig(): Promise<Config> {
    return Promise.resolve(this.currentConfig);
  }

  override saveConfig(config: Config): Promise<void> {
    this.currentConfig = config;
    this.savedConfigs.push(config);
    return Promise.resolve();
  }

  override readState(): Promise<DayState | null> {
    return Promise.resolve(this.state);
  }

  override saveState(state: DayState): Promise<void> {
    this.state = state;
    return Promise.resolve();
  }
}
