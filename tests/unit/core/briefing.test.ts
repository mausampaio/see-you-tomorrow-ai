import { describe, expect, it } from 'vitest';
import { generateBriefingMarkdown } from '../../../src/core/briefing.js';
import type { RejectedDiscoveryRecord } from '../../../src/core/ports.js';
import type { ResolvedEndDayScope, SessionListing } from '../../../src/core/types.js';
import { createHandoff } from './_fixtures.js';

const GENERATED_AT = new Date('2026-08-16T21:05:00.000Z');

function createListing(overrides: Partial<SessionListing> = {}): SessionListing {
  return {
    sessionId: '22222222-2222-4222-8222-222222222222',
    cwd: 'c:\\code\\fechada',
    name: 'fechada-01',
    info: { kind: 'read', aiTitle: 'Refactor the parser', lastPrompt: 'run the tests' },
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

describe('generateBriefingMarkdown — git facts (D-032: a list of repositories)', () => {
  it('states plainly there is no repository, instead of an empty-looking repository block', () => {
    const handoff = createHandoff({ facts: { ...createHandoff().facts, git: [] } });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain(
      'No git repository found among the touched files or launch directory of this session.',
    );
  });

  it('lists branch, dirtiness, modified files, commits, and other worktrees', () => {
    const handoff = createHandoff({
      facts: {
        lastActivity: null,
        lastPrompts: [],
        assistantMessages: [],
        touchedFiles: [],
        git: [
          {
            root: 'c:\\code\\projeto',
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
        ],
        filesOutsideRepository: 0,
        reposNotVisited: 0,
      },
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('**Git — `c:\\code\\projeto`**');
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
        git: [
          {
            root: 'c:\\code\\projeto',
            branch: 'main',
            dirty: false,
            modifiedFiles: [],
            commitsToday: [],
            worktrees: [{ path: 'c:\\code\\wt', branch: null, dirty: true, commitsTodayCount: 0 }],
          },
        ],
        filesOutsideRepository: 0,
        reposNotVisited: 0,
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
        git: [
          {
            root: 'c:\\code\\projeto',
            branch: null,
            dirty: false,
            modifiedFiles: [],
            commitsToday: [],
            worktrees: [],
          },
        ],
        filesOutsideRepository: 0,
        reposNotVisited: 0,
      },
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('- Branch: (detached HEAD)');
  });

  it('renders one block per repository when a session touched several (D-032)', () => {
    const handoff = createHandoff({
      facts: {
        lastActivity: null,
        lastPrompts: [],
        assistantMessages: [],
        touchedFiles: [],
        git: [
          {
            root: 'c:\\code\\frontend',
            branch: 'main',
            dirty: true,
            modifiedFiles: ['app.tsx'],
            commitsToday: [],
            worktrees: [],
          },
          {
            root: 'c:\\code\\backend',
            branch: 'main',
            dirty: false,
            modifiedFiles: [],
            commitsToday: [],
            worktrees: [],
          },
        ],
        filesOutsideRepository: 0,
        reposNotVisited: 0,
      },
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('**Git — `c:\\code\\frontend`**');
    expect(markdown).toContain('**Git — `c:\\code\\backend`**');
  });

  it('declares files that could not be traced to any repository (D-025/D-032)', () => {
    const handoff = createHandoff({
      facts: {
        lastActivity: null,
        lastPrompts: [],
        assistantMessages: [],
        touchedFiles: [],
        git: [
          {
            root: 'c:\\code\\projeto',
            branch: 'main',
            dirty: false,
            modifiedFiles: [],
            commitsToday: [],
            worktrees: [],
          },
        ],
        filesOutsideRepository: 12,
        reposNotVisited: 0,
      },
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).toContain('12 touched files could not be traced to any git repository.');
  });

  it('says nothing about the outside-repository count for a migrated (null) record', () => {
    const handoff = createHandoff({
      facts: {
        lastActivity: null,
        lastPrompts: [],
        assistantMessages: [],
        touchedFiles: [],
        git: [
          {
            root: 'c:\\code\\projeto',
            branch: 'main',
            dirty: false,
            modifiedFiles: [],
            commitsToday: [],
            worktrees: [],
          },
        ],
        filesOutsideRepository: null,
        reposNotVisited: null,
      },
    });
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], []);
    expect(markdown).not.toContain('could not be traced');
    expect(markdown).not.toContain('not visited');
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
      [createListing({ info: { kind: 'read', aiTitle: null, lastPrompt: null } })],
    );
    expect(markdown).toContain('- fechada-01 (c:\\code\\fechada): "(no title)"');
    expect(markdown).not.toContain('last prompt:');
  });

  it('S4-T0c: an unreadable transcript renders distinctly from an absent title, with the reason', () => {
    const markdown = generateBriefingMarkdown(
      '2026-08-16',
      GENERATED_AT,
      [],
      [],
      [createListing({ info: { kind: 'unreadable', reason: 'EACCES: permission denied' } })],
    );
    expect(markdown).toContain(
      '- fechada-01 (c:\\code\\fechada): title unavailable — could not read the transcript ' +
        '(EACCES: permission denied)',
    );
    expect(markdown).not.toContain('(no title)');
    expect(markdown).toContain('1 entry could not be read for title/prompt — see below.');
  });

  it('does not mention unreadable entries at all when every listing read successfully', () => {
    const markdown = generateBriefingMarkdown(
      '2026-08-16',
      GENERATED_AT,
      [],
      [],
      [createListing()],
    );
    expect(markdown).not.toContain('could not be read for title/prompt');
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

describe('generateBriefingMarkdown — EndDayScope (S4-T0c)', () => {
  it('a full-day run states so explicitly, even with the default parameter (never silence)', () => {
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [], []);
    expect(markdown).toContain(
      '**Scope:** full day — every discovered session was considered for capture.',
    );
  });

  it('a --session-narrowed run names the raw value', () => {
    const scope: ResolvedEndDayScope = {
      kind: 'singleSession',
      sessionValue: 'code-6d',
      captureCandidateCount: 4,
      consideredCount: 1,
    };
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [], [], [], scope);
    expect(markdown).toContain('**Scope:** narrowed by `--session "code-6d"`');
  });

  it('the scope note appears before the summary line, so a reader sees it first', () => {
    const scope: ResolvedEndDayScope = {
      kind: 'singleSession',
      sessionValue: 'code-6d',
      captureCandidateCount: 4,
      consideredCount: 1,
    };
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [], [], [], scope);
    expect(markdown.indexOf('**Scope:**')).toBeLessThan(markdown.indexOf('captured today'));
  });

  it(
    'aceite: a --session run and a full-day run on the same data produce two summary.md ' +
      'distinguishable by reading, not by comparing counts',
    () => {
      const handoff = createHandoff();
      const narrowed = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], [], [], {
        kind: 'singleSession',
        sessionValue: handoff.sessionId,
        captureCandidateCount: 1,
        consideredCount: 1,
      });
      const full = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [handoff], [], [], {
        kind: 'fullDay',
      });
      // Same handoffs, same counts — the only textual difference is the scope note itself.
      expect(narrowed).not.toEqual(full);
      expect(narrowed).toContain('narrowed by `--session');
      expect(full).toContain('full day — every discovered session was considered');
      expect(full).not.toContain('narrowed by');
    },
  );
});

describe('generateBriefingMarkdown — scope note reports the discard count (S4-T0d)', () => {
  it('names how many capture candidates were considered and how many were discarded', () => {
    const scope: ResolvedEndDayScope = {
      kind: 'singleSession',
      sessionValue: 'code-6d',
      captureCandidateCount: 4,
      consideredCount: 1,
    };
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [], [], [], scope);
    expect(markdown).toContain('1 of 4 capture candidates considered; 3 discarded by the filter.');
  });

  it('a full day never prints a discard count — there is nothing to report, not zero', () => {
    const markdown = generateBriefingMarkdown('2026-08-16', GENERATED_AT, [], []);
    expect(markdown).not.toContain('discarded');
    expect(markdown).not.toContain('candidate');
  });

  it(
    'the denominator is capture candidates, never discoveredCount — a closed session in the ' +
      'listing was never a capture candidate the filter could have discarded ' +
      '(the three-population case: one captured, one discarded by the filter, one closed)',
    () => {
      const scope: ResolvedEndDayScope = {
        kind: 'singleSession',
        sessionValue: 'viva-01',
        // Two capture candidates total (the captured one + the one the filter discarded) — NOT
        // three, which is what a wrong "discoveredCount" denominator would produce if it also
        // counted the closed session below as though `--session` could have discarded it too.
        captureCandidateCount: 2,
        consideredCount: 1,
      };
      const listing: SessionListing = {
        sessionId: '33333333-3333-4333-8333-333333333333',
        cwd: 'c:\\code\\fechada',
        name: 'fechada-01',
        info: { kind: 'read', aiTitle: 'Closed session', lastPrompt: null },
      };
      const markdown = generateBriefingMarkdown(
        '2026-08-16',
        GENERATED_AT,
        [createHandoff({ name: 'viva-01' })],
        [],
        [listing],
        scope,
      );
      // Correct math (denominator 2, D-031's capture-candidate population): 1 of 2, 1 discarded.
      expect(markdown).toContain(
        '1 of 2 capture candidates considered; 1 discarded by the filter.',
      );
      // The wrong math a `discoveredCount`-style denominator (3: captured + discarded + closed)
      // would have produced — must never appear.
      expect(markdown).not.toContain('1 of 3 capture candidates');
      expect(markdown).not.toContain('2 discarded by the filter');
    },
  );
});
