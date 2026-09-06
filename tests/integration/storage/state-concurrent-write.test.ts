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
 * **Measured on this machine (Windows), 2026-09-06, 300 concurrent read/write iterations, 3 runs:
 * the write side hits `EPERM` for real, and often — 57/300, 59/300, 55/300 (~18-20%).** The reader
 * side never once threw or saw a corrupted document across all 3 runs (0/300 read errors every
 * time) — `writeFileAtomic`'s rename-based swap really does keep every reader looking at either the
 * fully-old or fully-new document, exactly as advertised. But the WRITER'S OWN promise rejects with
 * a raw `EPERM` on a real fraction of calls whenever a reader happens to have the destination file
 * open for reading at the instant of `rename` — this is not a rare edge case at this contention
 * level, and nothing in `seeya snooze`/`config`/`StorageAdapter#saveState`/`saveConfig` catches or
 * retries it: it propagates all the way to `cli/index.ts`'s top-level `.catch`, printing a raw
 * Node error and exiting 1 — while the file on disk stays fully intact at its PREVIOUS value (never
 * torn, never lost, just not updated this one time). A person's `seeya snooze +30m` run at the
 * unlucky instant would see this ugly error and have to re-run the command; the underlying state is
 * never corrupted. See docs/QUESTOES.md Q-056 for the full writeup, why no retry/lock was added
 * (AGENTS.md: "não invente travamento" — this task's brief is explicit that discovering this is
 * the deliverable, not fixing it), and why a real daemon's much lower actual poll frequency (every
 * 30s, vs. this test's tight loop) makes the real-world rate far lower than the number above, but
 * not zero.
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

    // The writer-side risk is a DIFFERENT thing, already known and documented (not this test's
    // job to eliminate it — see the module comment above and Q-056): if it fires at all, it must
    // be exactly the EPERM `atomic-write.ts` already describes, never a new failure mode.
    for (const error of writeErrors) {
      expect(String(error)).toMatch(/EPERM/);
    }
  }, 30_000);
});
