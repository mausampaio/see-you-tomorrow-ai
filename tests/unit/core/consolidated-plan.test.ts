import { describe, expect, it } from 'vitest';
import { renderConsolidatedPlan } from '../../../src/core/consolidated-plan.js';
import type { Briefing } from '../../../src/core/ports.js';
import { createHandoff } from './_fixtures.js';

describe('renderConsolidatedPlan', () => {
  it('titles the plan with the day and session count', () => {
    const briefing: Briefing = { day: '2026-08-16', handoffs: [createHandoff()], rejected: [] };
    expect(renderConsolidatedPlan(briefing)).toContain('Plan for 2026-08-16 (1 session)');
  });

  it('pluralizes the session count', () => {
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [
        createHandoff({ sessionId: '11111111-1111-4111-8111-111111111111' }),
        createHandoff({ sessionId: '22222222-2222-4222-8222-222222222222' }),
      ],
      rejected: [],
    };
    expect(renderConsolidatedPlan(briefing)).toContain('Plan for 2026-08-16 (2 sessions)');
  });

  it('lists pending items and plan for a session with real work left', () => {
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [
        createHandoff({
          name: 'projeto-a',
          cwd: 'c:\\code\\a',
          pendingItems: ['fix the flaky test'],
          tomorrowPlan: ['ship the release'],
        }),
      ],
      rejected: [],
    };
    const plan = renderConsolidatedPlan(briefing);
    expect(plan).toContain('projeto-a');
    expect(plan).toContain('c:\\code\\a');
    expect(plan).toContain('pending: fix the flaky test');
    expect(plan).toContain('plan: ship the release');
  });

  it('shows only "pending" when there is no plan for today yet', () => {
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [createHandoff({ pendingItems: ['fix the flaky test'], tomorrowPlan: [] })],
      rejected: [],
    };
    const plan = renderConsolidatedPlan(briefing);
    expect(plan).toContain('pending: fix the flaky test');
    expect(plan).not.toContain('plan:');
  });

  it('shows only "plan" when there are no pending items left', () => {
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [createHandoff({ pendingItems: [], tomorrowPlan: ['ship the release'] })],
      rejected: [],
    };
    const plan = renderConsolidatedPlan(briefing);
    expect(plan).not.toContain('pending:');
    expect(plan).toContain('plan: ship the release');
  });

  it('says plainly when a model-confirmed session has nothing pending (D-025)', () => {
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [createHandoff({ pendingItems: [], tomorrowPlan: [] })],
      rejected: [],
    };
    expect(renderConsolidatedPlan(briefing)).toContain('nothing pending recorded');
  });

  it('marks a non-model handoff as unknown status, never as confirmed-clean (D-025)', () => {
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [
        createHandoff({
          source: 'deterministic',
          generationError: 'timeout',
          pendingItems: [],
          tomorrowPlan: [],
        }),
      ],
      rejected: [],
    };
    const plan = renderConsolidatedPlan(briefing);
    expect(plan).toContain('status unknown');
    expect(plan).not.toContain('nothing pending recorded');
  });

  it('names the unreadable-entry count for a briefing with zero readable handoffs', () => {
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [],
      rejected: [{ file: 'sessions/broken.json', raw: undefined, reason: 'not valid JSON' }],
    };
    const plan = renderConsolidatedPlan(briefing);
    expect(plan).toContain('Plan for 2026-08-16 (0 sessions)');
    expect(plan).toContain('1 entry could not be read');
  });
});
