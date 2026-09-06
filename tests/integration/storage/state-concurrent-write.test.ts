/**
 * S4-T4 introduces the first REAL reader+writer pair for `estado.json`/`config.json`: `seeya
 * snooze`/`skip-today`/`config` write from a separate terminal while a running daemon's
 * `scheduler/poll.ts` reads (`estado.json`) or reads (`config.json`) on every 30s cycle.
 * `atomic-write.ts`'s own module comment flagged this exact gap as unmeasured before this task —
 * "não há chamador que leia e escreva `config.json` concorrentemente... remedir antes de assumir
 * que continua sem problema". This file is that remeasurement, against real `fs` operations
 * (`StorageAdapter`, not mocked), hammering both sides at once.
 *
 * **What `writeFileAtomic`'s own comment already predicts, and what this test checks for.** On
 * Windows, `rename` over a destination another process holds open for reading fails with `EPERM` —
 * measured once already, in `atomic-write.test.ts`, for a kill-mid-write scenario. This test asks a
 * different question: under REAL, sustained concurrent read+write pressure (not a single kill),
 * does that race actually fire, how often, and does a reader ever observe anything worse than
 * "old value, new value, or briefly absent" (a torn write, a validation error)?
 *
 * **Measured on this machine (Windows), 2026-09-06 (Q-056/S4-T4), 300 concurrent read/write
 * iterations, 3 runs: the write side hit `EPERM` for real, and often — 60/300, 64/300, 56/300
 * (~19-21%).** The reader side never once threw or saw a corrupted document across all 3 runs
 * (0/300 read errors every time) — `writeFileAtomic`'s rename-based swap really does keep every
 * reader looking at either the fully-old or fully-new document, exactly as advertised. Before
 * S4-T4b, the WRITER'S OWN promise rejected with a raw `EPERM` on that fraction of calls whenever a
 * reader happened to have the destination file open for reading at the instant of `rename`, and
 * nothing caught or retried it: it propagated all the way to `cli/index.ts`'s top-level `.catch`.
 *
 * **S4-T4b (Q-058) added a bounded retry inside `writeFileAtomic` — re-measured here, same
 * machine, same 300-iteration/3-run shape: 3/300, 5/300, 1/300 (~0.3-1.7%).** Same instrument,
 * before and after, is the point: a ~19-21% writer rejection rate is now ~1%, and the invariant
 * this test exists to protect — 0/300 reader-side corruption — is unchanged. See
 * `atomic-write.ts`'s own module comment for the full attempt-count tuning table and why
 * `MAX_RENAME_ATTEMPTS = 8`, and docs/QUESTOES.md Q-058 for the full writeup (why the fix lives
 * entirely inside `writeFileAtomic` rather than a `Clock`-injected backoff threaded through
 * `StorageAdapter`). What's left after 8 attempts is no longer a raw `EPERM` — it's a message that
 * names the file and says it's still locked (AGENTS.md § "Mensagens de erro"), which is what the
 * assertion below checks for instead of the old `/EPERM/` pattern.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { StorageAdapter } from '../../../src/adapters/storage/index.js';
import { emptyDayState } from '../../../src/core/schedule.js';
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

describe('estado.json under real concurrent read+write pressure (Q-056)', () => {
  it('a reader (simulating the daemon poll) never observes a corrupted/invalid document while a writer (simulating seeya snooze) hammers it', async () => {
    fixture = await createDiscoveryFixture();
    const writer = new StorageAdapter(fixture.seeyaHome);
    const reader = new StorageAdapter(fixture.seeyaHome);
    await writer.saveState(emptyDayState('2026-08-16'));

    const writeErrors: unknown[] = [];
    const readErrors: unknown[] = [];

    const writeLoop = (async (): Promise<void> => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        try {
          await writer.saveState({ ...emptyDayState('2026-08-16'), snoozeMinutesTotal: i });
        } catch (error) {
          writeErrors.push(error);
        }
      }
    })();

    const readLoop = (async (): Promise<void> => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        try {
          const state = await reader.readState();
          // `null` is only legitimate before the FIRST write above ever lands — which already
          // happened, synchronously, before either loop starts — so every read here must resolve
          // to a real, schema-valid DayState. A thrown error (JSON parse failure, schema
          // rejection) would mean readVersionedDocument saw a torn/partial write, which
          // writeFileAtomic's rename-based swap is supposed to make impossible.
          expect(state).not.toBeNull();
        } catch (error) {
          readErrors.push(error);
        }
      }
    })();

    await Promise.all([writeLoop, readLoop]);

    // The real invariant this test protects: no reader-side corruption, ever, regardless of how
    // many writes raced it.
    expect(readErrors).toEqual([]);

    // The writer-side risk is a DIFFERENT thing, already known and documented (not this test's job
    // to eliminate entirely — see the module comment above and Q-058): S4-T4b's bounded retry
    // drives it from ~20% down to ~1%, but a reader can still win 8 attempts in a row. What must
    // NEVER happen again is the raw `EPERM` reaching the caller unreadable — every survivor here
    // must be `writeFileAtomic`'s readable message (names the file, says it's locked), never a new
    // failure mode.
    for (const error of writeErrors) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(
        /still locked by another process after \d+ attempts/,
      );
      expect(String((error as Error).cause)).toMatch(/EPERM/);
    }
  }, 30_000);
});
