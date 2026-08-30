/**
 * `findPendingBriefing` (S3-T1) — the walk-back logic for `seeya start-day`'s step 1
 * (docs/ESPECIFICACAO.md § `seeya start-day`, docs/QUESTOES.md Q-026). `FakeStorage`/`FakeClock`
 * come from `_fakes.ts`, same doubles `end-day.test.ts` already uses (docs/TESTES.md: "duplo de
 * I/O é classe/objeto nomeado implementando a porta").
 */
import { describe, expect, it } from 'vitest';
import {
  findPendingBriefing,
  MAX_BRIEFING_LOOKBACK_DAYS,
} from '../../../src/application/find-pending-briefing.js';
import { subtractLocalDays, localDayString } from '../../../src/core/day.js';
import { createHandoff } from '../core/_fixtures.js';
import { DEFAULT_TEST_CONFIG, FakeClock, FakeStorage } from './_fakes.js';

const TODAY = new Date(2026, 7, 16, 21, 0, 0); // 2026-08-16, local

function dayOffset(offset: number): string {
  return localDayString(subtractLocalDays(TODAY, offset));
}

describe('findPendingBriefing — nothing captured anywhere (aceite #5: normal, not an error)', () => {
  it('reports found: false with how many days it looked, never throws', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const clock = new FakeClock(TODAY);
    const result = await findPendingBriefing(storage, clock);
    expect(result).toEqual({ found: false, daysSearched: MAX_BRIEFING_LOOKBACK_DAYS + 1 });
  });
});

describe('findPendingBriefing — "mais recente" (Q-026)', () => {
  it("finds today's briefing when it still has pending work", async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const handoff = createHandoff({ pendingItems: ['finish the parser'] });
    await storage.saveHandoff(dayOffset(0), handoff);
    const clock = new FakeClock(TODAY);

    const result = await findPendingBriefing(storage, clock);
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.briefing.day).toBe(dayOffset(0));
    }
  });

  it('walks backward to yesterday when today has no briefing at all', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const handoff = createHandoff({ pendingItems: ['finish the parser'] });
    await storage.saveHandoff(dayOffset(1), handoff);
    const clock = new FakeClock(TODAY);

    const result = await findPendingBriefing(storage, clock);
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.briefing.day).toBe(dayOffset(1));
    }
  });

  it('skips a day whose briefing exists but has nothing pending (model-confirmed clean)', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    const clean = createHandoff({ pendingItems: [], tomorrowPlan: [] });
    const pending = createHandoff({
      sessionId: '22222222-2222-4222-8222-222222222222',
      pendingItems: ['still open'],
    });
    await storage.saveHandoff(dayOffset(0), clean);
    await storage.saveHandoff(dayOffset(1), pending);
    const clock = new FakeClock(TODAY);

    const result = await findPendingBriefing(storage, clock);
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.briefing.day).toBe(dayOffset(1));
    }
  });

  it('prefers the more recent pending day over an older one further back', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff(dayOffset(1), createHandoff({ pendingItems: ['recent'] }));
    await storage.saveHandoff(
      dayOffset(3),
      createHandoff({
        sessionId: '22222222-2222-4222-8222-222222222222',
        pendingItems: ['older'],
      }),
    );
    const clock = new FakeClock(TODAY);

    const result = await findPendingBriefing(storage, clock);
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.briefing.day).toBe(dayOffset(1));
    }
  });
});

describe('findPendingBriefing — bounded lookback (Q-026: stale is not "yesterday")', () => {
  it('never looks further back than maxLookbackDays', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    // One day beyond the default window — must never be found.
    await storage.saveHandoff(
      dayOffset(MAX_BRIEFING_LOOKBACK_DAYS + 1),
      createHandoff({ pendingItems: ['ancient work'] }),
    );
    const clock = new FakeClock(TODAY);

    const result = await findPendingBriefing(storage, clock);
    expect(result).toEqual({ found: false, daysSearched: MAX_BRIEFING_LOOKBACK_DAYS + 1 });
  });

  it('does find a briefing exactly at the edge of the window', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff(
      dayOffset(MAX_BRIEFING_LOOKBACK_DAYS),
      createHandoff({ pendingItems: ['still counts'] }),
    );
    const clock = new FakeClock(TODAY);

    const result = await findPendingBriefing(storage, clock);
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.briefing.day).toBe(dayOffset(MAX_BRIEFING_LOOKBACK_DAYS));
    }
  });

  it('a caller can narrow the window explicitly', async () => {
    const storage = new FakeStorage(DEFAULT_TEST_CONFIG);
    await storage.saveHandoff(dayOffset(2), createHandoff({ pendingItems: ['too far for 1'] }));
    const clock = new FakeClock(TODAY);

    const result = await findPendingBriefing(storage, clock, 1);
    expect(result).toEqual({ found: false, daysSearched: 2 });
  });
});
