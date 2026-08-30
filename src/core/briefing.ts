/**
 * Renders the day's consolidated briefing — `~/.seeya/days/<day>/summary.md`
 * (docs/ESPECIFICACAO.md § "Formato do handoff": "gerado a partir dos handoffs, em markdown
 * legível"). Pure formatting: no I/O, no `Date.now()` read here (D-019) — `generatedAt` is the
 * caller's already-resolved `Clock.now()` — so this is testable with plain `Handoff` fixtures,
 * no adapter doubles needed. `application/` calls `StorageAdapter#listHandoffs` to gather the
 * inputs and `#saveBriefing` to persist the result; this module only turns one into the other.
 *
 * **D-022, all the way to the page a person reads.** `rejected` isn't decoration: a corrupted or
 * hand-edited handoff file never takes the rest of the day's briefing down
 * (`Storage#listHandoffs`), and this module is what makes that fact visible to a human instead of
 * just survivable in code — "N sessions captured, M entries unreadable" is D-022's "aceitos e
 * rejeitados" contract reaching the one place someone actually looks at the end of the day.
 *
 * **D-025, written as prose instead of a data field, is where it's easiest to lose.** Two states
 * this module never launders into "nothing happened":
 * - `source: "deterministic"` — the model failed, not the session. The facts are real; nobody
 *   has explained them yet. Folding that into quiet prose ("worked on the thing") would make a
 *   failed generation indistinguishable from a session with genuinely little going on.
 * - `capturedDuringActiveTurn: true` — the capture landed mid-turn; some fields may lag reality
 *   by a few seconds. Silence here would let a reader treat a possibly-incomplete snapshot as a
 *   settled one.
 * Both surface as first-order lines next to the session, not footnotes.
 */
import type { Day, EvidenceSource, GitFacts, Handoff, WorktreeFacts } from './types.js';
import type { RejectedDiscoveryRecord } from './ports.js';

const ALL_SOURCES: readonly EvidenceSource[] = ['git', 'transcript', 'registry'];

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Alphabetical by display name, `sessionId` as tie-break — a stable order independent of
 * whatever order `Storage#listHandoffs` happened to read the directory in (`readdir` makes no
 * ordering promise), so the same day's handoffs always render the same way. */
function sortedHandoffs(handoffs: readonly Handoff[]): Handoff[] {
  return [...handoffs].sort(
    (a, b) => a.name.localeCompare(b.name) || a.sessionId.localeCompare(b.sessionId),
  );
}

function renderSummaryLine(handoffCount: number, rejectedCount: number): string {
  const captured =
    handoffCount === 0
      ? 'No sessions were captured today.'
      : `${pluralize(handoffCount, 'session', 'sessions')} captured today.`;
  if (rejectedCount === 0) {
    return captured;
  }
  const unreadable =
    `${pluralize(rejectedCount, 'entry', 'entries')} could not be read — ` +
    `see "Unreadable entries" below.`;
  return `${captured} ${unreadable}`;
}

/** Names every D-013 source that responded, and every one that didn't — partial evidence is a
 * fact worth stating plainly (D-025), not something the reader has to infer by counting. */
function evidenceLabel(sources: readonly EvidenceSource[]): string {
  if (sources.length === 0) {
    return 'none responded';
  }
  const missing = ALL_SOURCES.filter((source) => !sources.includes(source));
  const missingNote = missing.length > 0 ? ` (missing: ${missing.join(', ')})` : '';
  return `${sources.join(', ')}${missingNote}`;
}

/** D-025: mid-turn capture is a first-order fact about THIS handoff, appended right next to the
 * state a reader already checks first — never a separate line easy to skim past. */
function stateLabel(handoff: Handoff): string {
  const turnNote = handoff.capturedDuringActiveTurn
    ? ' — captured mid-turn, this handoff may be incomplete'
    : '';
  return `${handoff.sessionState}${turnNote}`;
}

/** D-025/D-003: a failed generation is not a quiet session. Rendered as a blockquote so it reads
 * as a warning, not just another bullet among many. `null` on `generationError` shouldn't happen
 * for `source: "deterministic"` (`generation-policy.ts` always fills it), but this never
 * fabricates a reason that wasn't recorded. */
function renderDeterministicCallout(handoff: Handoff): string {
  if (handoff.source !== 'deterministic') {
    return '';
  }
  const reason = handoff.generationError ?? 'no error message was recorded';
  return (
    `\n> **Understanding not available for this session.** The model call failed during ` +
    `capture: ${reason}\n> The facts below are still accurate — nobody has reviewed them yet.\n`
  );
}

function renderTextBlock(label: string, text: string): string {
  const body = text.trim() === '' ? '_Nothing recorded._' : text.trim();
  return `**${label}**\n\n${body}`;
}

function renderListBlock(label: string, items: readonly string[]): string {
  const body =
    items.length === 0 ? '_Nothing recorded._' : items.map((item) => `- ${item}`).join('\n');
  return `**${label}**\n\n${body}`;
}

function renderWorktreeLine(worktree: WorktreeFacts): string {
  const branch = worktree.branch ?? '(detached HEAD)';
  const dirty = worktree.dirty ? 'dirty' : 'clean';
  const commits = pluralize(worktree.commitsTodayCount, 'commit', 'commits');
  return `  - ${worktree.path} (${branch}) — ${dirty}, ${commits} today`;
}

/** `git: null` is a real, ordinary state (`cwd` isn't a repository at all, D-025) — rendered as
 * its own sentence, never as a `GitFacts` block with every field looking emptily "clean".
 *
 * **Exported for `core/resume-prompt.ts` (S3-T1) to reuse as-is** for a `source !== "model"`
 * handoff's facts-only resume prompt: same git facts, same "no repository here" honesty, and
 * writing a second renderer for the same `GitFacts` shape would be exactly the duplication
 * AGENTS.md § "Estilo de código" rules out. */
export function renderGitBlock(git: GitFacts | null): string {
  if (git === null) {
    return '**Git**\n\n_No git repository at this path._';
  }
  const commits =
    git.commitsToday.map((commit) => `\`${commit.sha}\` ${commit.title}`).join('; ') || 'none';
  const worktrees =
    git.worktrees.length === 0 ? 'none' : `\n${git.worktrees.map(renderWorktreeLine).join('\n')}`;
  return [
    '**Git**\n',
    `- Branch: ${git.branch ?? '(detached HEAD)'}`,
    `- Working tree: ${git.dirty ? 'dirty' : 'clean'}`,
    `- Modified files: ${git.modifiedFiles.join(', ') || 'none'}`,
    `- Commits today: ${commits}`,
    `- Other worktrees: ${worktrees}`,
  ].join('\n');
}

function renderHandoffHeader(handoff: Handoff): string {
  return [
    `## ${handoff.name}`,
    '',
    `- **Directory:** \`${handoff.cwd}\``,
    `- **State:** ${stateLabel(handoff)}`,
    `- **Captured:** ${handoff.capturedAt.toISOString()} · **Mode:** ${handoff.captureMode} · ` +
      `**Evidence:** ${evidenceLabel(handoff.sources)}`,
  ].join('\n');
}

/** Recent prompts and touched files are supporting recall, not the main subject (`understanding`
 * already is) — omitted entirely when empty instead of printing an empty section header, so a
 * lean handoff doesn't read as padded out with placeholders. */
function renderRecallBlocks(handoff: Handoff): string {
  const blocks: string[] = [];
  if (handoff.facts.lastPrompts.length > 0) {
    blocks.push(renderListBlock('Recent prompts', handoff.facts.lastPrompts));
  }
  if (handoff.facts.touchedFiles.length > 0) {
    blocks.push(renderListBlock('Touched files', handoff.facts.touchedFiles));
  }
  return blocks.join('\n\n');
}

function renderHandoffSection(handoff: Handoff): string {
  const sections = [
    renderHandoffHeader(handoff),
    renderDeterministicCallout(handoff),
    renderTextBlock('What was happening', handoff.understanding),
    renderListBlock('Pending', handoff.pendingItems),
    renderListBlock('Plan for tomorrow', handoff.tomorrowPlan),
    renderGitBlock(handoff.facts.git),
    renderRecallBlocks(handoff),
  ].filter((section) => section !== '');
  return sections.join('\n\n');
}

/** D-022's other half of "aceitos e rejeitados": named files with reasons, not just a count in
 * the summary line — a reader who wants to go fix a hand-edited file needs to know which one. */
function renderRejectedSection(rejected: readonly RejectedDiscoveryRecord[]): string {
  if (rejected.length === 0) {
    return '';
  }
  const lines = rejected.map((entry) => `- \`${entry.file}\`: ${entry.reason}`);
  return [
    '## Unreadable entries',
    '',
    `${pluralize(rejected.length, 'handoff file', 'handoff files')} could not be read and ` +
      `${rejected.length === 1 ? 'is' : 'are'} excluded from this briefing:`,
    '',
    ...lines,
  ].join('\n');
}

/**
 * Builds the full markdown document for `day`. `handoffs`/`rejected` come from
 * `Storage#listHandoffs(day)` — every handoff written so far today, not only the ones a single
 * `endDay` run just captured, so re-running `seeya end-day --session <id>` (S2-T5) later the same
 * day regenerates a briefing that still reflects everyone captured earlier.
 *
 * @example
 * const markdown = generateBriefingMarkdown('2026-08-16', clock.now(), handoffs, rejected);
 * await storage.saveBriefing('2026-08-16', markdown);
 */
export function generateBriefingMarkdown(
  day: Day,
  generatedAt: Date,
  handoffs: readonly Handoff[],
  rejected: readonly RejectedDiscoveryRecord[],
): string {
  const header = [
    `# Daily briefing — ${day}`,
    `_Generated ${generatedAt.toISOString()}_`,
    renderSummaryLine(handoffs.length, rejected.length),
  ].join('\n\n');

  const body = [
    ...sortedHandoffs(handoffs).map(renderHandoffSection),
    renderRejectedSection(rejected),
  ]
    .filter((section) => section !== '')
    .join('\n\n---\n\n');

  return body === '' ? `${header}\n` : `${header}\n\n---\n\n${body}\n`;
}
