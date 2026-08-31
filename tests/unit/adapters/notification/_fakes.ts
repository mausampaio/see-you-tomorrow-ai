/**
 * Named `NotificationBackend` doubles (docs/TESTES.md: "duplo de I/O é classe/objeto nomeado
 * implementando a porta, não stub inline") for `chain.test.ts` — never touch a real OS or spawn a
 * real process, on purpose: this is exactly the fallback-selection LOGIC docs/TESTES.md's unit
 * tier asks for, independent of which OS actually runs the test (the S2-T1 lesson).
 */
import type { Notice } from '../../../../src/core/ports.js';
import type { NotificationBackend } from '../../../../src/adapters/notification/backend.js';

export class AlwaysAvailableBackend implements NotificationBackend {
  readonly sent: Notice[] = [];
  constructor(readonly name: string = 'always-available') {}
  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
  supportsActions(): boolean {
    return false;
  }
  send(notice: Notice): Promise<void> {
    this.sent.push(notice);
    return Promise.resolve();
  }
}

export class NeverAvailableBackend implements NotificationBackend {
  constructor(readonly name: string = 'never-available') {}
  isAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }
  supportsActions(): boolean {
    return false;
  }
  send(): Promise<void> {
    throw new Error(`${this.name}: send() should never be called — isAvailable() was false`);
  }
}

/** Available, but its `send()` always fails — the "attempted and lost" case, distinct from
 * "never tried" (`NeverAvailableBackend`). */
export class FailingSendBackend implements NotificationBackend {
  constructor(readonly name: string = 'failing-send') {}
  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
  supportsActions(): boolean {
    return false;
  }
  send(): Promise<void> {
    return Promise.reject(new Error(`${this.name}: send() always fails`));
  }
}

/** Its OWN availability probe throws instead of resolving `false` — proves `ChainNotifier` treats
 * a broken detector as "not available", not as a crash. */
export class ThrowingAvailabilityBackend implements NotificationBackend {
  constructor(readonly name: string = 'throwing-availability') {}
  isAvailable(): Promise<boolean> {
    return Promise.reject(new Error(`${this.name}: isAvailable() is broken`));
  }
  supportsActions(): boolean {
    return false;
  }
  send(): Promise<void> {
    throw new Error(`${this.name}: send() should never be called`);
  }
}
