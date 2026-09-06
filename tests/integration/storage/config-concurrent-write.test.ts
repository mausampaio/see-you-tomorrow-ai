/**
 * The `config.json` counterpart of `state-concurrent-write.test.ts` — see that file's module
 * comment for the full context (Q-056). `config.json` is actually the NEWER case: before S4-T4,
 * `saveConfig` didn't exist at all, so `config.json` never had a writer in production, only many
 * readers (`buildCliContext`/`buildEndDayContext`/`buildStartDayContext`/`buildDaemonContext`, one
 * `readConfig()` each). This is the very first measurement of a `config.json` writer racing a
 * reader — `atomic-write.ts`'s own module comment named this exact gap before it existed.
 *
 * **Measured on this machine (Windows), 2026-09-06 (Q-056/S4-T4), 300 concurrent read/write
 * iterations, 3 runs: 63/300, 63/300, 55/300 (~18-21%) writes hit `EPERM`, 0/300 reads ever saw a
 * corrupted document.** Same shape and same order of magnitude as `estado.json`'s own measurement
 * in `state-concurrent-write.test.ts` — see that file for the full reasoning (identical mechanism,
 * `writeFileAtomic` underneath both).
 *
 * **S4-T4b (Q-058) re-measured after adding `writeFileAtomic`'s bounded retry: 7/300, 1/300, 1/300
 * (~0.3-2.3%).** Same before/after story as `estado.json`'s — see that file's module comment and
 * `atomic-write.ts`'s own for the full tuning table and why the fix lives inside `writeFileAtomic`
 * rather than a `Clock`-injected backoff (docs/QUESTOES.md Q-058).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';
import { DEFAULT_CONFIG } from '../../../src/adapters/storage/config-schema.js';
import {
  createDiscoveryFixture,
  removeDiscoveryFixture,
  type DiscoveryFixture,
} from '../discovery/_fixtures.js';

let fixture: DiscoveryFixture | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await removeDiscoveryFixture(fixture);
    fixture = undefined;
  }
});

const ITERATIONS = 300;

describe('config.json under real concurrent read+write pressure (Q-056)', () => {
  it('a reader (simulating any command reading config.json) never observes a corrupted document while a writer (simulating seeya config set) hammers it', async () => {
    fixture = await createDiscoveryFixture();
    const writer = new StorageAdapter(fixture.seeyaHome);
    const reader = new StorageAdapter(fixture.seeyaHome);
    await writer.saveConfig(DEFAULT_CONFIG);

    const writeErrors: unknown[] = [];
    const readErrors: unknown[] = [];

    const writeLoop = (async (): Promise<void> => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        try {
          await writer.saveConfig({ ...DEFAULT_CONFIG, relevanceHours: 1 + (i % 20) });
        } catch (error) {
          writeErrors.push(error);
        }
      }
    })();

    const readLoop = (async (): Promise<void> => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        try {
          const config = await reader.readConfig();
          // config.json is seeded above before either loop starts, so every read must resolve to
          // a real, schema-valid Config — never a thrown corruption error.
          expect(config.relevanceHours).toBeGreaterThan(0);
        } catch (error) {
          readErrors.push(error);
        }
      }
    })();

    await Promise.all([writeLoop, readLoop]);

    expect(readErrors).toEqual([]);
    // S4-T4b/Q-058: what survives the bounded retry must be a readable message (names the file,
    // says it's locked), never the raw `EPERM` that used to reach `cli/index.ts` unformatted.
    for (const error of writeErrors) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(
        /still locked by another process after \d+ attempts/,
      );
      expect(String((error as Error).cause)).toMatch(/EPERM/);
    }
  }, 30_000);
});
