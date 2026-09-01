import { describe, expect, it } from 'vitest';
import { generateBriefingMarkdown } from '../../../src/core/briefing.js';
import type { RejectedDiscoveryRecord } from '../../../src/core/ports.js';
import type { SessionListing } from '../../../src/core/types.js';
import { createHandoff } from './_fixtures.js';

const GENERATED_AT = new Date('2026-08-16T21:05:00.000Z');

function createListing(overrides: Partial<SessionListing> = {}): SessionListing {
  return {
    sessionId: '22222222-2222-4222-8222-222222222222',
    cwd: 'c:\\code\\fechada',
    name: 'fechada-01',
    aiTitle: 'Refactor the parser',
    lastPrompt: 'run the tests',
    ...overrides,
  };
}

describe('generateBriefingMarkdown — the empty day (aceite #5)', () => {
  it('says plainly that nothing was captured, without inventing work', () => {
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [], []);
    expect(markdown).toContain('# Daily briefing — 2026-08-16');
    expect(markdown).toContain('No sessions were captured today.');
  });

  it('still reports unreadable entries even when zero handoffs parsed successfully', () => {
    const rejected: RejectedDiscoveryRecord[] = [
      { file: 'sessions/broken.json', raw: undefined, reason: 'not valid JSON' },
    ];
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [], rejected);
    expect(markdown).toContain('No sessions were captured today.');
    expect(markdown).toContain('1 entry could not be read');
    expect(markdown).toContain('sessions/broken.json');
  });
});

describe('generateBriefingMarkdown — unreadable entries (D-022, aceite #4)', () => {
  it('names the file and the reason, and does not drop the readable handoffs', () => {
    const handoff = createHandoff();
    const rejected: RejectedDiscoveryRecord[] = [
      {
        file: 'sessions/22222222.json',
        raw: undefined,
        reason: 'handoff is malformed: bad sessionId',
      },
    ];
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], rejected);
    expect(markdown).toContain('1 session captured today');
    expect(markdown).toContain('1 entry could not be read');
    expect(markdown).toContain('## Unreadable entries');
    expect(markdown).toContain('sessions/22222222.json');
    expect(markdown).toContain('bad sessionId');
    expect(markdown).toContain('projeto-01');
  });
});

describe('generateBriefingMarkdown — multiple unreadable entries', () => {
  it('uses plural phrasing and lists every rejected file', () => {
    const rejected: RejectedDiscoveryRecord[] = [
      { file: 'sessions/a.json', raw: undefined, reason: 'not valid JSON' },
      { file: 'sessions/b.json', raw: undefined, reason: 'handoff is malformed' },
    ];
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [], rejected);
    expect(markdown).toContain('2 entries could not be read');
    expect(markdown).toContain('2 handoff files could not be read and are excluded');
    expect(markdown).toContain('sessions/a.json');
    expect(markdown).toContain('sessions/b.json');
  });
});

describe('generateBriefingMarkdown — deterministic source (aceite #2)', () => {
  it('flags a failed generation as missing understanding, never as an uneventful session', () => {
    const handoff = createHandoff({
      source: 'deterministic',
      understanding: '',
      generationError: 'claude binary not found',
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('Understanding not available for this session');
    expect(markdown).toContain('claude binary not found');
    expect(markdown).toContain('nobody has reviewed them yet');
  });

  it('falls back to a plain note when no error message was recorded at all', () => {
    const handoff = createHandoff({ source: 'deterministic', generationError: null });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('no error message was recorded');
  });

  it('a successful model handoff never shows the deterministic callout', () => {
    const handoff = createHandoff({ source: 'model' });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).not.toContain('Understanding not available');
  });
});

describe('generateBriefingMarkdown — capturedDuringActiveTurn (aceite #3)', () => {
  it('warns the handoff may be incomplete right next to the session state', () => {
    const handoff = createHandoff({ capturedDuringActiveTurn: true, sessionState: 'alive' });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain(
      '**State:** alive — captured mid-turn, this handoff may be incomplete',
    );
  });

  it('says nothing extra when the capture was not mid-turn', () => {
    const handoff = createHandoff({ capturedDuringActiveTurn: false, sessionState: 'alive' });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('**State:** alive\n');
  });
});

describe('generateBriefingMarkdown — partial evidence (D-013/D-025)', () => {
  it('names exactly which sources answered and which did not', () => {
    const handoff = createHandoff({ sources: ['git'] });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('**Evidence:** git (missing: transcript, registry)');
  });

  it('says plainly that nothing responded when sources is empty', () => {
    const handoff = createHandoff({ sources: [] });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('**Evidence:** none responded');
  });

  it('shows every source with no missing note when all three answered', () => {
    const handoff = createHandoff({ sources: ['git', 'transcript', 'registry'] });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('**Evidence:** git, transcript, registry');
    expect(markdown).not.toContain('missing:');
  });
});

describe('generateBriefingMarkdown — git facts', () => {
  it('states plainly there is no repository, instead of an empty-looking GitFacts block', () => {
    const handoff = createHandoff({ facts: { ...createHandoff().facts, git: null } });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('_No git repository at this path._');
  });

  it('lists branch, dirtiness, modified files, commits, and other worktrees', () => {
    const handoff = createHandoff({
      facts: {
        lastActivity: null,
        lastPrompts: [],
        assistantMessages: [],
        touchedFiles: [],
        git: {
          branch: 'main',
          dirty: true,
          modifiedFiles: ['src/a.ts'],
          commitsToday: [{ sha: '1b7fd99', title: 'docs: initial spec' }],
          worktrees: [
            {
              path: 'c:\\code\\projeto\\.wt\\issue-42',
              branch: 'issue-42',
              dirty: false,
              commitsTodayCount: 3,
            },
          ],
        },
      },
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('- Branch: main');
    expect(markdown).toContain('- Working tree: dirty');
    expect(markdown).toContain('- Modified files: src/a.ts');
    expect(markdown).toContain('`1b7fd99` docs: initial spec');
    expect(markdown).toContain('.wt\\issue-42 (issue-42) — clean, 3 commits today');
  });

  it('renders a dirty worktree with a detached HEAD as such', () => {
    const handoff = createHandoff({
      facts: {
        lastActivity: null,
        lastPrompts: [],
        assistantMessages: [],
        touchedFiles: [],
        git: {
          branch: 'main',
          dirty: false,
          modifiedFiles: [],
          commitsToday: [],
          worktrees: [{ path: 'c:\\code\\wt', branch: null, dirty: true, commitsTodayCount: 0 }],
        },
      },
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('c:\\code\\wt ((detached HEAD)) — dirty, 0 commits today');
  });

  it('renders a detached HEAD as such, never as a fake branch name (D-025)', () => {
    const handoff = createHandoff({
      facts: {
        lastActivity: null,
        lastPrompts: [],
        assistantMessages: [],
        touchedFiles: [],
        git: { branch: null, dirty: false, modifiedFiles: [], commitsToday: [], worktrees: [] },
      },
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('- Branch: (detached HEAD)');
  });
});

describe('generateBriefingMarkdown — ordering and recall', () => {
  it('sorts multiple handoffs by name, independent of input order', () => {
    const zebra = createHandoff({
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'zebra',
    });
    const apple = createHandoff({
      sessionId: '22222222-2222-4222-8222-222222222222',
      name: 'apple',
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [zebra, apple], []);
    expect(markdown.indexOf('## apple')).toBeLessThan(markdown.indexOf('## zebra'));
  });

  it('omits recent-prompts and touched-files sections entirely when empty', () => {
    const handoff = createHandoff({
      facts: { ...createHandoff().facts, lastPrompts: [], touchedFiles: [] },
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).not.toContain('Recent prompts');
    expect(markdown).not.toContain('Touched files');
  });

  it('shows recent prompts and touched files when present', () => {
    const handoff = createHandoff({
      facts: { ...createHandoff().facts, lastPrompts: ['fix the bug'], touchedFiles: ['src/a.ts'] },
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('**Recent prompts**\n\n- fix the bug');
    expect(markdown).toContain('**Touched files**\n\n- src/a.ts');
  });
});

describe('generateBriefingMarkdown — pending items and plan', () => {
  it('shows an explicit "nothing recorded" instead of a blank section', () => {
    const handoff = createHandoff({ pendingItems: [], tomorrowPlan: [] });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('**Pending**\n\n_Nothing recorded._');
    expect(markdown).toContain('**Plan for tomorrow**\n\n_Nothing recorded._');
  });

  it('lists every pending item and plan step', () => {
    const handoff = createHandoff({
      pendingItems: ['finish the thing'],
      tomorrowPlan: ['start the next thing'],
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('**Pending**\n\n- finish the thing');
    expect(markdown).toContain('**Plan for tomorrow**\n\n- start the next thing');
  });
});

describe('generateBriefingMarkdown — D-031 listing (S4-T0b)', () => {
  it('omits the section entirely when nothing was listed (default parameter)', () => {
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [], []);
    expect(markdown).not.toContain('Not captured');
  });

  it('names each listed session with its title and last prompt, in its own section', () => {
    const markdown = generateBriefingMarkdown(
      '2026-08-16',
      GENERATED_AT,
      [],
      [],
      [createListing()],
    );
    expect(markdown).toContain('## Not captured (closed sessions)');
    expect(markdown).toContain(
      '- fechada-01 (c:\\code\\fechada): "Refactor the parser" — last prompt: "run the tests"',
    );
  });

  it('D-025: an absent ai-title renders "(no title)", never an invented one', () => {
    const markdown = generateBriefingMarkdown(
      '2026-08-16',
      GENERATED_AT,
      [],
      [],
      [createListing({ aiTitle: null, lastPrompt: null })],
    );
    expect(markdown).toContain('- fechada-01 (c:\\code\\fechada): "(no title)"');
    expect(markdown).not.toContain('last prompt:');
  });

  it('never mixes a listed session into a handoff "## <name>" section', () => {
    const handoff = createHandoff({ name: 'viva-01' });
    const markdown = generateBriefingMarkdown(
      '2026-08-16',
      GENERATED_AT,
      [handoff],
      [],
      [createListing({ name: 'fechada-01' })],
    );
    expect(markdown).toContain('## viva-01');
    expect(markdown).not.toContain('## fechada-01');
  });

  it('sorts multiple listed sessions by name, independent of input order', () => {
    const zebra = createListing({
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'zebra',
    });
    const apple = createListing({
      sessionId: '22222222-2222-4222-8222-222222222222',
      name: 'apple',
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [], [], [zebra, apple]);
    expect(markdown.indexOf('apple')).toBeLessThan(markdown.indexOf('zebra'));
  });
});
