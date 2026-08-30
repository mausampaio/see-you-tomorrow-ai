import { describe, expect, it } from 'vitest';
import { renderConsolidatedPlan, renderRelativeAge } from '../../../src/core/consolidated-plan.js';
import type { Briefing } from '../../../src/core/ports.js';
import { createHandoff } from './_fixtures.js';

// `daysAgo: 1` ("yesterday") throughout this describe block on purpose: it's the ordinary case
// that adds no age note (see the "age note" describe block below for the cases that do), so tests
// about session content aren't also, incidentally, tests about the age note.
describe('renderConsolidatedPlan — content (daysAgo: 1, the ordinary case)', () => {
  it('titles the plan with the day and session count, no age note for yesterday', () => {
    const briefing: Briefing = { day: '2026-08-16', handoffs: [createHandoff()], rejected: [] };
    const plan = renderConsolidatedPlan(briefing, 1);
    expect(plan).toContain('Plan for 2026-08-16 (1 session)');
    expect(plan).not.toContain('ago');
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
    expect(renderConsolidatedPlan(briefing, 1)).toContain('Plan for 2026-08-16 (2 sessions)');
  });

  it('lists pending items and plan for a session with real work left, one item per line', () => {
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
    const plan = renderConsolidatedPlan(briefing, 1);
    // No backticks anywhere in this header (S3-T6): this is terminal text, not markdown.
    expect(plan).toContain('- projeto-a (c:\\code\\a)');
    expect(plan).toContain('    pending:\n      - fix the flaky test');
    expect(plan).toContain('    plan:\n      - ship the release');
  });

  // S3-T6: the wall-of-text bug from the first real run — `join('; ')` turned five pending items
  // and four plan items into two run-on lines. Single-item lists (the case above) never exposed
  // this, because a list of one reads fine either way.
  it('renders every pending item and every plan item on its own line, not joined into a paragraph', () => {
    const pendingItems = [
      'Confirm whether the todo list markdown file was actually created',
      'If not created, create the .md file with a short list of simple sample tasks',
      'Determine which tasks the user wants completed vs left open',
      'Mark selected tasks as done and leave others explicitly open in the file',
      'Verify final file state shows a realistic mix of completed and pending tasks',
    ];
    const tomorrowPlan = [
      'Check for an existing todo list markdown file from this session',
      'If missing, create it with a short list of simple tasks as originally requested',
      'Get from the user which specific tasks to complete now vs. leave pending',
      'Update the markdown file, checking off completed tasks and keeping others unchecked',
    ];
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [createHandoff({ pendingItems, tomorrowPlan })],
      rejected: [],
    };
    const plan = renderConsolidatedPlan(briefing, 1);
    for (const item of [...pendingItems, ...tomorrowPlan]) {
      expect(plan).toContain(`      - ${item}`);
    }
    // The old bug, named explicitly so it can't come back quietly: no semicolon-joined run-on.
    expect(plan).not.toContain('; ');
    expect(plan).not.toContain('`');
  });

  it('shows only "pending" when there is no plan for today yet', () => {
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [createHandoff({ pendingItems: ['fix the flaky test'], tomorrowPlan: [] })],
      rejected: [],
    };
    const plan = renderConsolidatedPlan(briefing, 1);
    expect(plan).toContain('pending:\n      - fix the flaky test');
    expect(plan).not.toContain('plan:');
  });

  it('shows only "plan" when there are no pending items left', () => {
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [createHandoff({ pendingItems: [], tomorrowPlan: ['ship the release'] })],
      rejected: [],
    };
    const plan = renderConsolidatedPlan(briefing, 1);
    expect(plan).not.toContain('pending:');
    expect(plan).toContain('plan:\n      - ship the release');
  });

  it('says plainly when a model-confirmed session has nothing pending (D-025)', () => {
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [createHandoff({ pendingItems: [], tomorrowPlan: [] })],
      rejected: [],
    };
    expect(renderConsolidatedPlan(briefing, 1)).toContain('nothing pending recorded');
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
    const plan = renderConsolidatedPlan(briefing, 1);
    expect(plan).toContain('status unknown');
    expect(plan).not.toContain('nothing pending recorded');
  });

  it('names the unreadable-entry count for a briefing with zero readable handoffs', () => {
    const briefing: Briefing = {
      day: '2026-08-16',
      handoffs: [],
      rejected: [{ file: 'sessions/broken.json', raw: undefined, reason: 'not valid JSON' }],
    };
    const plan = renderConsolidatedPlan(briefing, 1);
    expect(plan).toContain('Plan for 2026-08-16 (0 sessions)');
    expect(plan).toContain('1 entry could not be read');
  });
});

describe('renderConsolidatedPlan — resumedSessionIds (S3-T3)', () => {
  it('marks an already-resumed session distinctly, instead of showing its (stale) pending content', () => {
    const handoff = createHandoff({ pendingItems: ['still on the handoff, but already handled'] });
    const briefing: Briefing = { day: '2026-08-16', handoffs: [handoff], rejected: [] };
    const plan = renderConsolidatedPlan(briefing, 1, new Set([handoff.sessionId]));
    expect(plan).toContain('already resumed today');
    expect(plan).not.toContain('still on the handoff');
  });

  it('a session NOT in the resumed set still shows its real pending content', () => {
    const resumed = createHandoff({
      sessionId: '11111111-1111-4111-8111-111111111111',
      pendingItems: ['done already'],
    });
    const untouched = createHandoff({
      sessionId: '22222222-2222-4222-8222-222222222222',
      pendingItems: ['still needs a look'],
    });
    const briefing: Briefing = { day: '2026-08-16', handoffs: [resumed, untouched], rejected: [] };
    const plan = renderConsolidatedPlan(briefing, 1, new Set([resumed.sessionId]));
    expect(plan).toContain('already resumed today');
    expect(plan).toContain('pending:\n      - still needs a look');
  });

  it('defaults to an empty resumed set when omitted (back-compat with existing call sites)', () => {
    const briefing: Briefing = { day: '2026-08-16', handoffs: [createHandoff()], rejected: [] };
    expect(renderConsolidatedPlan(briefing, 1)).not.toContain('already resumed');
  });
});

describe('renderRelativeAge', () => {
  it('names today and yesterday specially', () => {
    expect(renderRelativeAge(0)).toBe('today');
    expect(renderRelativeAge(1)).toBe('yesterday');
  });

  it('counts single days under a week', () => {
    expect(renderRelativeAge(2)).toBe('2 days ago');
    expect(renderRelativeAge(6)).toBe('6 days ago');
  });

  it('switches to weeks from 7 days on, singular', () => {
    expect(renderRelativeAge(7)).toBe('1 week ago');
  });

  it('switches to weeks, plural, and rounds to the nearest week', () => {
    expect(renderRelativeAge(14)).toBe('2 weeks ago');
    expect(renderRelativeAge(21)).toBe('3 weeks ago');
    expect(renderRelativeAge(13)).toBe('2 weeks ago');
  });
});

describe('renderConsolidatedPlan — age note (Q-026: no cutoff, but the age is shown)', () => {
  it('adds no age note when the briefing is from yesterday (the ordinary case)', () => {
    const briefing: Briefing = { day: '2026-08-15', handoffs: [createHandoff()], rejected: [] };
    expect(renderConsolidatedPlan(briefing, 1)).not.toContain('ago');
  });

  it('calls out "today" explicitly when the briefing is from the same day', () => {
    const briefing: Briefing = { day: '2026-08-16', handoffs: [createHandoff()], rejected: [] };
    expect(renderConsolidatedPlan(briefing, 0)).toContain('today');
  });

  it('reads as "3 weeks ago" for an old but still-pending briefing, never silently resumed as fresh', () => {
    const briefing: Briefing = {
      day: '2026-07-26',
      handoffs: [createHandoff({ pendingItems: ['pick this back up'] })],
      rejected: [],
    };
    const plan = renderConsolidatedPlan(briefing, 21);
    expect(plan).toContain('Plan for 2026-07-26');
    expect(plan).toContain('3 weeks ago');
  });
});
