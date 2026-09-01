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
 *
 * **S4-T0c: the artifact itself now says whether the run that produced it was a full day or a
 * `--session`-narrowed slice.** Q-041 surfaced the gap: `seeya end-day --session X` used to write a
 * `summary.md` indistinguishable from a full day that happened to have one session. A reader
 * finding no other handoffs would read that as "nothing else was going on" — D-025's mistake one
 * level up from a single field, applied to the whole document. `renderScopeNote` below states the
 * scope explicitly for BOTH cases (never omitting the full-day note and letting silence mean
 * "complete" — the exact ambiguity this task exists to close), right after the generation
 * timestamp and before anything else, because a reader needs this before interpreting the rest of
 * the page. It never claims which OTHER sessions the filter excluded — `endDay` only knows a filter
 * ran, not what it skipped (see `core/types.ts#EndDayScope`'s own docstring).
 */
import type {
  Day,
  EndDayScope,
  EvidenceSource,
  GitFacts,
  Handoff,
  SessionListing,
  WorktreeFacts,
} from './types.js';
import type { RejectedDiscoveryRecord } from './ports.js';

const ALL_SOURCES: readonly EvidenceSource[] = ['git', 'transcript', 'registry'];

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * S4-T0c: states this run's `EndDayScope` explicitly, in both directions — a full day says so, a
 * narrowed run says so and names the raw `--session` value, and neither reads as the other by
 * omission (D-025, D-024 — see `EndDayScope`'s own docstring in `core/types.ts`). Deliberately
 * silent about which OTHER sessions a narrowed run might have skipped: `endDay` never learns that,
 * only that a filter ran, and this text never promises more than that (per the maintainer's own
 * framing of the task: "sem prometer o que não sabe").
 */
function renderScopeNote(scope: EndDayScope): string {
  if (scope.kind === 'fullDay') {
    return '**Scope:** full day — every discovered session was considered for capture.';
  }
  return (
    `**Scope:** narrowed by \`--session "${scope.sessionValue}"\` — only the matching session was ` +
    'considered for capture. Other sessions discovered today may not have been looked at.'
  );
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

/** Same stable-order reasoning as `sortedHandoffs` above, applied to D-031's listing instead of
 * captured handoffs — `endDay`'s own discovery order isn't a display guarantee either. */
function sortedListedSessions(listedSessions: readonly SessionListing[]): SessionListing[] {
  return [...listedSessions].sort(
    (a, b) => a.name.localeCompare(b.name) || a.sessionId.localeCompare(b.sessionId),
  );
}

/**
 * S4-T0c: `listing.info.kind === 'unreadable'` renders as an explicit, named problem — never the
 * same "(no title)" text an ordinary absent `ai-title` gets. Before this task the two collapsed
 * into the identical shape (D-025's mistake: "no title" and "couldn't check" are different claims,
 * and only the second is someone's problem to go fix). **Exported for `cli/format-end-day.ts` to
 * reuse as-is** — its own terminal report renders the exact same per-session text, and a second
 * copy of this branching would be exactly the duplication AGENTS.md § "Estilo de código" rules out
 * (same reuse precedent as `renderGitBlock` above, cited on its own docstring).
 */
export function formatSessionListingLine(listing: SessionListing): string {
  if (listing.info.kind === 'unreadable') {
    return (
      `- ${listing.name} (${listing.cwd}): title unavailable — could not read the transcript ` +
      `(${listing.info.reason})`
    );
  }
  const title = listing.info.aiTitle ?? '(no title)';
  const prompt =
    listing.info.lastPrompt === null ? '' : ` — last prompt: "${listing.info.lastPrompt}"`;
  return `- ${listing.name} (${listing.cwd}): "${title}"${prompt}`;
}

/**
 * D-022's "contável" applied to S4-T0c's read-failure distinction: how many `listedSessions`
 * entries failed to read their transcript, as opposed to ordinarily having no `ai-title`. Exported
 * for `cli/format-end-day.ts` to reuse, same reasoning as `formatSessionListingLine` above.
 */
export function countUnreadableListings(listedSessions: readonly SessionListing[]): number {
  return listedSessions.filter((listing) => listing.info.kind === 'unreadable').length;
}

/**
 * D-031's listing: every session that fell outside the day's capture scope, named plainly and kept
 * in its own section — **never merged into the handoff sections above**, since a listed session was
 * never captured at all (`application/types.ts#EndDayResult.listedSessions`'s own docstring makes
 * the same point about not mixing the two buckets in memory; this is that same rule applied to the
 * page a human actually reads). Omitted entirely when empty, same convention every other optional
 * section in this document already follows.
 */
function renderListedSessionsSection(listedSessions: readonly SessionListing[]): string {
  if (listedSessions.length === 0) {
    return '';
  }
  const unreadableCount = countUnreadableListings(listedSessions);
  const unreadableNote =
    unreadableCount > 0
      ? ` ${pluralize(unreadableCount, 'entry', 'entries')} could not be read for title/prompt — see below.`
      : '';
  return [
    '## Not captured (closed sessions)',
    '',
    'No live registry entry was found for these — D-031 reads that as closed gracefully, not ' +
      `work left in progress, so they are listed here for reference instead of captured.${unreadableNote}`,
    '',
    ...sortedListedSessions(listedSessions).map(formatSessionListingLine),
  ].join('\n');
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
 * `listedSessions` (D-031, default `[]` so every call site written before this parameter existed
 * keeps compiling with its original, listing-free output): sessions the day's capture never
 * attempted at all, rendered in their own section (`renderListedSessionsSection`) — see that
 * function's own docstring for why they're never folded into the handoff sections below.
 *
 * `scope` (S4-T0c, default `{ kind: 'fullDay' }` for the same backward-compatibility reason
 * `listedSessions` defaults to `[]`): THIS call's own `EndDayScope`, rendered by `renderScopeNote`
 * right after the timestamp — not persisted anywhere else, and not derived from `handoffs`/
 * `listedSessions` (a `--session`-narrowed run can still see a day with many handoffs already on
 * disk from earlier runs; the scope note describes how THIS run looked, not how big the day is).
 * A later full `seeya end-day` the same day overwrites `summary.md` wholesale, including this note
 * — the artifact always reflects its most recent generation's scope, same as every other section.
 *
 * @example
 * const markdown = generateBriefingMarkdown('2026-08-16', clock.now(), handoffs, rejected, listed);
 * await storage.saveBriefing('2026-08-16', markdown);
 */
export function generateBriefingMarkdown(
  day: Day,
  generatedAt: Date,
  handoffs: readonly Handoff[],
  rejected: readonly RejectedDiscoveryRecord[],
  listedSessions: readonly SessionListing[] = [],
  scope: EndDayScope = { kind: 'fullDay' },
): string {
  const header = [
    `# Daily briefing — ${day}`,
    `_Generated ${generatedAt.toISOString()}_`,
    renderScopeNote(scope),
    renderSummaryLine(handoffs.length, rejected.length),
  ].join('\n\n');

  const body = [
    ...sortedHandoffs(handoffs).map(renderHandoffSection),
    renderListedSessionsSection(listedSessions),
    renderRejectedSection(rejected),
  ]
    .filter((section) => section !== '')
    .join('\n\n---\n\n');

  return body === '' ? `${header}\n` : `${header}\n\n---\n\n${body}\n`;
}
