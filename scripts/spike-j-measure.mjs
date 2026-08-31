#!/usr/bin/env node
/**
 * Ad-hoc measurement tool for S4-T00 / Q-032 (docs/spikes/J-cache-na-captura.md). NOT wired into
 * package.json on purpose — this task does not touch package.json. Invoke directly:
 *
 *   node scripts/spike-j-measure.mjs turn1
 *   node scripts/spike-j-measure.mjs arm1
 *   node scripts/spike-j-measure.mjs arm2
 *   node scripts/spike-j-measure.mjs arm3   (run again with arm4/arm5/... for extra wait points)
 *
 * S4-T00b (docs/spikes/J-cache-na-captura.md's new section, Q-034/Q-035): which single flag among
 * `--tools ""`/`--system-prompt`/`--json-schema` actually breaks prefix identity, run against a
 * FRESH original session (`turn1b`/`IDS.original2`) since round 1's session is a day stale:
 *
 *   node scripts/spike-j-measure.mjs turn1b
 *   node scripts/spike-j-measure.mjs base                  (all three flags, anchors round 1's arm1)
 *   node scripts/spike-j-measure.mjs no-system-prompt       (the decisive arm)
 *   node scripts/spike-j-measure.mjs no-tools
 *   node scripts/spike-j-measure.mjs no-json-schema
 *   node scripts/spike-j-measure.mjs user-prompt-extraction (only if no-system-prompt confirms)
 *
 * Each step is a SEPARATE process invocation on purpose: the "measure the clock" arms need a real
 * wait between them, and per docs/FLUXO-DE-AGENTES.md's "commite cedo, nunca espere notificação",
 * the operator (agent) sleeps SYNCHRONOUSLY between steps and reads the clock itself — this script
 * never sleeps or waits internally, it only records timestamps so the caller can verify an
 * interval actually elapsed.
 *
 * Real invocations of `claude`, one per step. Costs real money — see the per-call
 * `--max-budget-usd` ceiling below and docs/spikes/J-cache-na-captura.md's invocation count.
 *
 * Console output only: tooling script outside src/, exempt from the "no bare console.log" rule
 * (AGENTS.md § "Registro e saída").
 *
 * Sanitization before writing to disk (AGENTS.md § "Este projeto é de código aberto"): every
 * `--session-id` used here is chosen up front as an obviously-synthetic UUID (<=4 distinct
 * symbols, same convention as docs/spikes/A-resume-headless.md), so `session_id` in the raw output
 * never needs redaction. The one field this script cannot pre-choose — the call-level `uuid` field
 * `claude -p --output-format json` emits — is swept by `sanitizeForCommit` below along with any
 * home-directory path, as a belt-and-suspenders measure the pre-commit guard would otherwise catch
 * anyway (scripts/verificar-termos-locais.mjs).
 *
 * JSDoc types throughout, not just tidiness: `eslint .` runs typed lint rules over every file it
 * doesn't ignore (eslint.config.js), including this one — an untyped parameter here is inferred
 * `any` and cascades into `no-unsafe-*` everywhere it flows, the same class of error the rest of
 * this project avoids with real TypeScript.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ cwd?: string } & Record<string, string | number | undefined>} SpikeState */
/**
 * @typedef {Object} ClaudeUsage
 * @property {unknown} [input_tokens]
 * @property {unknown} [cache_creation_input_tokens]
 * @property {unknown} [cache_read_input_tokens]
 * @property {unknown} [cache_creation]
 */
/**
 * @typedef {Object} ClaudeResult
 * @property {unknown} [total_cost_usd]
 * @property {ClaudeUsage} [usage]
 * @property {Record<string, unknown>} [modelUsage]
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(REPO_ROOT, 'docs', 'spikes', 'j-cache-na-captura-raw');
const STATE_FILE = path.join(tmpdir(), 'seeya-spike-j-state.json');

// D-017's exact list, duplicated here rather than imported: this is a plain .mjs tool script with
// no build step, and src/adapters/generation/env.ts is TypeScript. Kept manually in sync — if
// D-017's table changes, update both. The canonical, production-used list lives in env.ts.
const INHERITED_SESSION_VARS = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_PID',
  'CLAUDECODE',
  'CLAUDE_AGENT_SDK_VERSION',
];

// Copied literally from src/adapters/generation/system-prompt.ts (GENERATION_SYSTEM_PROMPT) and
// understanding-schema.ts (UNDERSTANDING_JSON_SCHEMA) — not imported, same reason as above. Kept
// byte-identical to what production sends so arm1 measures the REAL prefix, not an approximation.
const GENERATION_SYSTEM_PROMPT =
  'You extract a work handoff from session context for another engineer taking over tomorrow. ' +
  'You are not a conversational assistant: never offer help, never ask a question, never suggest ' +
  'next actions like turning this into a document. Respond only with the requested JSON — a ' +
  'short account of what was being worked on, what is left pending, and a short plan for the ' +
  'next session. If the context has nothing substantive, say so plainly instead of inventing ' +
  'activity.';

const UNDERSTANDING_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    understanding: { type: 'string' },
    pendingItems: { type: 'array', items: { type: 'string' } },
    tomorrowPlan: { type: 'array', items: { type: 'string' } },
  },
  required: ['understanding', 'pendingItems', 'tomorrowPlan'],
  additionalProperties: false,
});

const DEEP_PROMPT =
  'Based on the full conversation above, produce a short handoff: what was being worked on, ' +
  'what is left pending, and a short plan for the next session.';

// S4-T00b: turn1's synthetic codename for the SECOND original session, distinct from the first
// round's PLUM-42 so raw output from the two rounds is never ambiguous about which base it read.
const TURN1B_PROMPT =
  'This is a disposable session for a cache-behavior measurement, not a real project. Remember ' +
  'this fact: the test codename is ONYX-77. Reply with exactly one short plain sentence ' +
  'confirming you noted it. Do not ask questions, do not use any tool.';

// S4-T00b's decisive-arm-adjacent measurement (Q-034): if dropping ONLY --system-prompt turns out
// to restore prefix identity (the hypothesis under test), the practically interesting variant is
// whether moving the extractor instruction into the USER prompt — keeping --json-schema and
// --tools "" active, so output stays structured — also keeps that cache hit. This is
// GENERATION_SYSTEM_PROMPT's own text, relocated, plus the same handoff request DEEP_PROMPT makes.
const USER_PROMPT_WITH_EXTRACTION_INSTRUCTION =
  `${GENERATION_SYSTEM_PROMPT} Based on the full conversation above, produce the requested JSON: ` +
  'what was being worked on, what is left pending, and a short plan for the next session.';

const TURN1_PROMPT =
  'This is a disposable session for a cache-behavior measurement, not a real project. Remember ' +
  'this fact: the test codename is PLUM-42. Reply with exactly one short plain sentence ' +
  'confirming you noted it. Do not ask questions, do not use any tool.';

// Obviously-synthetic UUIDs (<=4 distinct symbols each), chosen up front and handed to `claude`
// via --session-id so the real output never contains an ID that needs redacting before commit.
const IDS = {
  original: '66666666-6666-4666-8666-666666666666',
  arm1Fork: '77777777-7777-4777-8777-777777777777',
  arm2Fork: '88888888-8888-4888-8888-888888888888',
  arm3Fork: '99999999-9999-4999-8999-999999999999',
  arm4Fork: '55555555-5555-4555-8555-555555555555',
  // S4-T00b (this file's second round, docs/spikes/J-cache-na-captura.md's new section): a FRESH
  // original session, not a reuse of `original` above. A day passed since the first round — cache
  // from `original` is long past even the generous 1h tier Achado 3 measured, and the arms below
  // need to run close in time to each other, anchored to a fresh base, not to yesterday's session.
  original2: '22222222-2222-4222-8222-222222222222',
  baseFork: '33333333-3333-4333-8333-333333333333',
  noSystemPromptFork: '44444444-4444-4444-8444-444444444444',
  noToolsFork: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  noJsonSchemaFork: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  userPromptExtractionFork: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  noFlagsControlFork: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

const MAX_BUDGET_USD = '0.20';

// S4-T00c (docs/PLANO-DE-ENTREGA.md, Q-036): measures the LEAN generator's prompt
// (adapters/generation/prompt.ts#buildLeanPrompt), not the deep/--resume path the arms above
// measure. Lean never uses --resume/--fork-session at all (args.ts#buildLeanArgs), so there is no
// cache-identity question here — every lean call is a fresh, unrelated session by design (D-011's
// "--no-session-persistence"). What's being measured instead is the plain cost slope of adding
// assistant text to the prompt, at two volumes, against the current five-fact baseline (D-011's
// reevaluation, 2026-08-31).
//
// Ten synthetic assistant turns, entirely invented (AGENTS.md § "Este projeto é de código
// aberto" — no real transcript content, ever, in this repo). Deliberately mirrors the real defect
// this task fixes (docs/DECISOES.md D-011 reevaluation): message 6 states "4 done, 6 pending" the
// way a real away-summary turn would, and is never repeated by the (also synthetic) user prompts
// below — that asymmetry is exactly what made the real handoff blind before this task.
const SYNTHETIC_ASSISTANT_MESSAGES = [
  'Set up the initial project scaffold: package.json, tsconfig, and a placeholder src/index.ts ' +
    'with a no-op main function.',
  'Implemented the CSV parser for the import command. It handles quoted fields and embedded ' +
    'commas correctly. Added three unit tests covering the happy path, an empty file, and a ' +
    'file with a trailing blank line.',
  'Refactored the sort comparator used by the `list` command. The previous version inverted ' +
    'ascending and descending order when two items had equal keys, which only showed up with the ' +
    'synthetic dataset of 500 rows once duplicates were introduced. Fixed the tie-break to fall ' +
    'back to insertion order, added a regression test with three duplicate keys, and confirmed ' +
    'the output now matches the expected fixture byte for byte. Also cleaned up a leftover ' +
    'console.log that had been left in from debugging.',
  'Wired the --verbose flag through to the logger. No behavior change otherwise.',
  'Investigated the flaky integration test for the export path. Root cause was a race between ' +
    'the temp file write and the read-back — added an explicit flush before reading. Test has ' +
    'now passed ten times in a row locally.',
  'Status check before wrapping up for today: of the ten tasks on the board, four are done — ' +
    'the CSV parser, the sort fix, the verbose flag, and the flaky test fix. Six are still open: ' +
    'the README update, the integration tests for the export path, the retry logic for network ' +
    'calls, the config validation error messages, the Windows path handling for the --output ' +
    'flag, and the final pass on removing dead code in the old parser module. Planning to start ' +
    "with the README update tomorrow since it's the smallest of the six.",
  'Added config validation: an unknown key in config.json now produces a clear error naming the ' +
    'key and the file path, instead of being silently ignored. Three tests added for a missing ' +
    'required field, an unknown key, and a value of the wrong type.',
  'Deleted the old parser module — nothing else in the codebase imported it anymore, confirmed ' +
    'with a full-repo grep before removing.',
  'Worked through the Windows path handling issue for --output. Paths with a drive letter and ' +
    'backslashes were being mangled by a naive string split on /. Switched to ' +
    'node:path.parse/.join throughout that command, added a test that runs the same assertions ' +
    'with both a Windows-style and POSIX-style path by passing the platform hint explicitly, and ' +
    'confirmed neither branch is skipped when the suite runs on a single OS.',
  'Started the retry logic for network calls: exponential backoff with a cap at three attempts. ' +
    'Not wired into the actual HTTP client yet — just the standalone withRetry helper and its ' +
    'unit tests so far. Will connect it to the client tomorrow.',
];

const SYNTHETIC_USER_PROMPTS = [
  'set up the project scaffold',
  'add a csv import command',
  'the list command sorts wrong when there are duplicates, can you check',
  'add a verbose flag',
  'the export test keeps failing randomly, look into it',
  'where are we, what is left',
  'config.json should reject unknown keys',
  'remove the old parser module, nothing uses it anymore',
  'the --output flag breaks on windows paths',
  'start on retrying failed network calls',
];

const SYNTHETIC_TOUCHED_FILES = [
  'src/cli/import.ts',
  'src/core/sort.ts',
  'src/adapters/logger.ts',
  'src/adapters/export.ts',
  'src/core/config-validation.ts',
  'src/core/parser-legacy.ts',
  'src/cli/output-path.ts',
  'src/adapters/http/retry.ts',
];

/**
 * Same label this task's `prompt.ts` change uses for the assistant-text section (S4-T00c) —
 * kept identical here on purpose, so the measured prompt is byte-for-byte what production sends,
 * not an approximation of it. Explicitly names the source ("the assistant said", not the user) —
 * the brief's own warning: confusing the two would be worse than not having the data at all.
 * @type {string}
 */
const ASSISTANT_SECTION_TITLE = 'What the assistant said it did (oldest first, its own words)';

/**
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateForMeasurement(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, maxChars)} […]` : text;
}

/**
 * Builds the lean prompt's stdin text (mirrors `adapters/generation/prompt.ts#buildLeanPrompt`
 * exactly, by hand, since this .mjs tool doesn't import TypeScript — same reasoning as
 * `GENERATION_SYSTEM_PROMPT`/`UNDERSTANDING_JSON_SCHEMA` above being copied, not imported).
 *
 * @param {string[]} assistantMessages Empty for the baseline (no-assistant-text) arm.
 * @returns {string}
 */
function buildLeanStdinForMeasurement(assistantMessages) {
  const lines = [
    'Project: widget-cli (synthetic, S4-T00c measurement)',
    'Working directory: /tmp/seeya-spike-j00c-synthetic',
    'Last known activity: 2026-08-31T14:00:00.000Z',
    'Recent user prompts (oldest first):',
    ...SYNTHETIC_USER_PROMPTS.map((p) => `- ${p}`),
    'Files touched:',
    ...SYNTHETIC_TOUCHED_FILES.map((f) => `- ${f}`),
  ];
  if (assistantMessages.length > 0) {
    lines.push(`${ASSISTANT_SECTION_TITLE}:`);
    lines.push(...assistantMessages.map((m) => `- ${m}`));
  }
  return lines.join('\n');
}

/**
 * Lean's own CLI shape (args.ts#buildLeanArgs): `--tools ""`, our system prompt, our JSON schema,
 * `--no-session-persistence` — never `--resume`/`--fork-session` (lean is always a fresh session
 * by design, D-011), so there is no cache/prefix-identity question for this measurement at all.
 * @returns {string[]}
 */
function buildLeanCliArgsForMeasurement() {
  return [
    '-p',
    '--model',
    'haiku',
    '--output-format',
    'json',
    '--tools',
    '',
    '--system-prompt',
    GENERATION_SYSTEM_PROMPT,
    '--json-schema',
    UNDERSTANDING_JSON_SCHEMA,
    '--no-session-persistence',
    '--max-budget-usd',
    MAX_BUDGET_USD,
  ];
}

/** Baseline: today's real lean prompt shape, zero assistant text (control arm).
 * @param {SpikeState} state */
function stepLeanBaseline(state) {
  const cwd = ensureCwd(state);
  const stdin = buildLeanStdinForMeasurement([]);
  console.log(`[lean-baseline] stdin length: ${stdin.length} chars`);
  const { startedAt, finishedAt } = runClaude(
    'lean-baseline',
    buildLeanCliArgsForMeasurement(),
    stdin,
    cwd,
  );
  state.leanBaselineStartedAt = startedAt;
  state.leanBaselineFinishedAt = finishedAt;
  saveState(state);
}

/** Small volume: last 3 assistant messages, each truncated to 400 chars — the "short/truncated"
 * end of the range under test.
 * @param {SpikeState} state */
function stepLeanAssistantSmall(state) {
  const cwd = ensureCwd(state);
  const last3 = SYNTHETIC_ASSISTANT_MESSAGES.slice(-3).map((m) => truncateForMeasurement(m, 400));
  const stdin = buildLeanStdinForMeasurement(last3);
  console.log(`[lean-assistant-small] stdin length: ${stdin.length} chars`);
  const { startedAt, finishedAt } = runClaude(
    'lean-assistant-small',
    buildLeanCliArgsForMeasurement(),
    stdin,
    cwd,
  );
  state.leanAssistantSmallStartedAt = startedAt;
  state.leanAssistantSmallFinishedAt = finishedAt;
  saveState(state);
}

/** Large volume: all 10 assistant messages, untruncated — the "many/long" end of the range,
 * matching `MAX_LAST_PROMPTS`'s own count for symmetry.
 * @param {SpikeState} state */
function stepLeanAssistantLarge(state) {
  const cwd = ensureCwd(state);
  const stdin = buildLeanStdinForMeasurement(SYNTHETIC_ASSISTANT_MESSAGES);
  console.log(`[lean-assistant-large] stdin length: ${stdin.length} chars`);
  const { startedAt, finishedAt } = runClaude(
    'lean-assistant-large',
    buildLeanCliArgsForMeasurement(),
    stdin,
    cwd,
  );
  state.leanAssistantLargeStartedAt = startedAt;
  state.leanAssistantLargeFinishedAt = finishedAt;
  saveState(state);
}

/**
 * @param {NodeJS.ProcessEnv} base
 * @returns {NodeJS.ProcessEnv}
 */
function sanitizeEnv(base) {
  const env = { ...base };
  for (const name of INHERITED_SESSION_VARS) {
    delete env[name];
  }
  // D-017's "deep" row: the fork must actually persist for --resume to find it later, and forcing
  // this removes any doubt about default persistence being silently suppressed (Spike C's original
  // failure mode) rather than genuinely on.
  env['CLAUDE_CODE_FORCE_SESSION_PERSISTENCE'] = '1';
  return env;
}

/**
 * Home-directory path and any UUID not already one of ours (IDS above) — see module docstring.
 *
 * **Learned the hard way, mid-run (arm4):** the model's own free-text `result` field once
 * invented a plausible-looking memory path containing the real Windows username, and it came back
 * JSON-escaped — TWO backslashes (`\\Users\\name`), not one. The first version of this regex only
 * matched a single backslash and silently let that occurrence through into a file already written
 * to disk (never committed — caught before `git add`, see the raw-file re-check in the spike's own
 * method section). `\\{1,2}` below matches either form.
 *
 * @param {string} rawStdout
 * @returns {string}
 */
function sanitizeForCommit(rawStdout) {
  let text = rawStdout.replace(
    /[A-Za-z]:\\{1,2}Users\\{1,2}[A-Za-z0-9._%+-]{2,}/g,
    'C:\\\\Users\\\\<usuario>',
  );
  const known = new Set(Object.values(IDS).map((id) => id.toLowerCase()));
  text = text.replace(
    /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    (match) => (known.has(match.toLowerCase()) ? match : '00000000-0000-4000-8000-000000000000'),
  );
  return text;
}

/** @returns {SpikeState} */
function loadState() {
  if (!existsSync(STATE_FILE)) {
    return {};
  }
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  return /** @type {SpikeState} */ (parsed);
}

/** @param {SpikeState} state */
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * @param {SpikeState} state
 * @returns {string}
 */
function ensureCwd(state) {
  if (state.cwd && existsSync(state.cwd)) {
    return state.cwd;
  }
  const cwd = mkdtempSync(path.join(tmpdir(), 'seeya-spike-j-'));
  state.cwd = cwd;
  saveState(state);
  return cwd;
}

/**
 * Runs one real `claude -p` call, writes the sanitized raw stdout to
 * docs/spikes/j-cache-na-captura-raw/<label>.json, and prints the two numbers this whole spike is
 * about. Throws loudly on a non-zero exit or unparseable JSON (CLAUDE.md § "O erro clássico neste
 * projeto": a schema/parse failure here is a finding, not something to loosen).
 *
 * @param {string} label
 * @param {string[]} args
 * @param {string} stdinContent
 * @param {string} cwd
 * @returns {{ startedAt: string, finishedAt: string, parsed: ClaudeResult }}
 */
function runClaude(label, args, stdinContent, cwd) {
  const startedAt = new Date().toISOString();
  console.log(`[${label}] starting at ${startedAt}`);
  console.log(`[${label}] args: claude ${args.join(' ')}`);
  const result = /** @type {import('node:child_process').SpawnSyncReturns<string>} */ (
    spawnSync('claude', args, {
      cwd,
      env: sanitizeEnv(process.env),
      input: stdinContent,
      encoding: 'utf8',
      shell: false,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    })
  );
  const finishedAt = new Date().toISOString();
  if (result.status !== 0) {
    console.error(`[${label}] exit=${String(result.status)}`);
    console.error(`[${label}] stderr:\n${result.stderr}`);
    console.error(`[${label}] stdout:\n${result.stdout}`);
    throw new Error(`[${label}] claude exited non-zero (${String(result.status)})`);
  }
  mkdirSync(RAW_DIR, { recursive: true });
  const sanitized = sanitizeForCommit(result.stdout);
  writeFileSync(path.join(RAW_DIR, `${label}.json`), sanitized, 'utf8');

  /** @type {unknown} */
  let parsedUnknown;
  try {
    parsedUnknown = JSON.parse(result.stdout);
  } catch (error) {
    console.error(`[${label}] stdout was not valid JSON — raw output still saved for inspection.`);
    throw error;
  }
  const parsed = /** @type {ClaudeResult} */ (parsedUnknown);
  const usage = parsed.usage ?? {};
  console.log(`[${label}] finished at ${finishedAt}`);
  console.log(`[${label}] total_cost_usd=${String(parsed.total_cost_usd)}`);
  console.log(`[${label}] usage.input_tokens=${String(usage.input_tokens)}`);
  console.log(
    `[${label}] usage.cache_creation_input_tokens=${String(usage.cache_creation_input_tokens)}`,
  );
  console.log(`[${label}] usage.cache_read_input_tokens=${String(usage.cache_read_input_tokens)}`);
  console.log(`[${label}] usage.cache_creation=${JSON.stringify(usage.cache_creation)}`);
  console.log(`[${label}] modelUsage keys=${JSON.stringify(Object.keys(parsed.modelUsage ?? {}))}`);
  return { startedAt, finishedAt, parsed };
}

/**
 * @param {string} forkId
 * @returns {string[]}
 */
function commonDeepResumeArgs(forkId) {
  return [
    '-p',
    '--model',
    'haiku',
    '--output-format',
    'json',
    '--resume',
    IDS.original,
    '--fork-session',
    '--session-id',
    forkId,
    '--max-budget-usd',
    MAX_BUDGET_USD,
  ];
}

/**
 * S4-T00b: builds the deep-resume args with any subset of the three prefix-shaping flags
 * (`--tools ""`, `--system-prompt`, `--json-schema`), always in production's own relative order
 * (args.ts#buildCommonArgs: tools, system-prompt, json-schema, THEN --resume/--fork-session), so
 * "drop one flag" arms differ from `base` by exactly one omission, nothing reordered.
 *
 * @param {string} forkId
 * @param {{ tools?: boolean, systemPrompt?: boolean, jsonSchema?: boolean }} include
 * @returns {string[]}
 */
function buildArgsWithFlags(forkId, include) {
  /** @type {string[]} */
  const shapingFlags = [];
  if (include.tools) {
    shapingFlags.push('--tools', '');
  }
  if (include.systemPrompt) {
    shapingFlags.push('--system-prompt', GENERATION_SYSTEM_PROMPT);
  }
  if (include.jsonSchema) {
    shapingFlags.push('--json-schema', UNDERSTANDING_JSON_SCHEMA);
  }
  return [
    '-p',
    '--model',
    'haiku',
    '--output-format',
    'json',
    ...shapingFlags,
    '--resume',
    IDS.original2,
    '--fork-session',
    '--session-id',
    forkId,
    '--max-budget-usd',
    MAX_BUDGET_USD,
  ];
}

/**
 * Fresh original session for the S4-T00b round (see IDS.original2's comment).
 * @param {SpikeState} state
 */
function stepTurn1b(state) {
  const cwd = ensureCwd(state);
  const args = [
    '-p',
    '--model',
    'haiku',
    '--output-format',
    'json',
    '--session-id',
    IDS.original2,
    '--max-budget-usd',
    MAX_BUDGET_USD,
  ];
  const { startedAt, finishedAt } = runClaude('turn1b', args, TURN1B_PROMPT, cwd);
  state.turn1bStartedAt = startedAt;
  state.turn1bFinishedAt = finishedAt;
  saveState(state);
}

/** `base`: today's real deep-capture shape again (all three flags), run close in time to the
 * single-flag-dropped arms below so the clock never confounds the comparison (unlike reusing
 * round 1's `arm1`, a day stale by the time this round runs). Anchors against round 1's `arm1`.
 * @param {SpikeState} state
 */
function stepBase(state) {
  const cwd = ensureCwd(state);
  const args = buildArgsWithFlags(IDS.baseFork, {
    tools: true,
    systemPrompt: true,
    jsonSchema: true,
  });
  const { startedAt, finishedAt } = runClaude('base', args, DEEP_PROMPT, cwd);
  state.baseStartedAt = startedAt;
  state.baseFinishedAt = finishedAt;
  saveState(state);
}

/** Control arm, added after the single-flag-dropped arms all read zero cache: replicates round
 * 1's `arm2` (drop ALL THREE flags) against THIS round's fresh session, to check whether the
 * environment/cache mechanism itself is capable of a hit right now at all. Without this, a zero
 * read on every single-flag-dropped arm is ambiguous between "that specific flag breaks the
 * cache" and "nothing is hitting cache in this session for an unrelated reason".
 * @param {SpikeState} state
 */
function stepNoFlagsControl(state) {
  const cwd = ensureCwd(state);
  const args = buildArgsWithFlags(IDS.noFlagsControlFork, {});
  const { startedAt, finishedAt } = runClaude('no-flags-control', args, DEEP_PROMPT, cwd);
  state.noFlagsControlStartedAt = startedAt;
  state.noFlagsControlFinishedAt = finishedAt;
  saveState(state);
}

/** The decisive arm: drop ONLY --system-prompt, keep --tools "" and --json-schema. If the
 * hypothesis is right (system-prompt alone breaks prefix identity because it sits at the absolute
 * start of the prefix), this should read close to full cache like round 1's `arm2` did.
 * @param {SpikeState} state
 */
function stepNoSystemPrompt(state) {
  const cwd = ensureCwd(state);
  const args = buildArgsWithFlags(IDS.noSystemPromptFork, { tools: true, jsonSchema: true });
  const { startedAt, finishedAt } = runClaude('no-system-prompt', args, DEEP_PROMPT, cwd);
  state.noSystemPromptStartedAt = startedAt;
  state.noSystemPromptFinishedAt = finishedAt;
  saveState(state);
}

/**
 * Drop ONLY --tools "" (default tool set active), keep --system-prompt and --json-schema.
 * @param {SpikeState} state
 */
function stepNoTools(state) {
  const cwd = ensureCwd(state);
  const args = buildArgsWithFlags(IDS.noToolsFork, { systemPrompt: true, jsonSchema: true });
  const { startedAt, finishedAt } = runClaude('no-tools', args, DEEP_PROMPT, cwd);
  state.noToolsStartedAt = startedAt;
  state.noToolsFinishedAt = finishedAt;
  saveState(state);
}

/** Drop ONLY --json-schema, keep --tools "" and --system-prompt. Achado 4's own candidate flag:
 * if the fixed internal apparatus --json-schema triggers is what reads the mystery 70,260 tokens,
 * this arm's cache_read should collapse relative to `base`.
 * @param {SpikeState} state
 */
function stepNoJsonSchema(state) {
  const cwd = ensureCwd(state);
  const args = buildArgsWithFlags(IDS.noJsonSchemaFork, { tools: true, systemPrompt: true });
  const { startedAt, finishedAt } = runClaude('no-json-schema', args, DEEP_PROMPT, cwd);
  state.noJsonSchemaStartedAt = startedAt;
  state.noJsonSchemaFinishedAt = finishedAt;
  saveState(state);
}

/** The variant Q-034 actually needs, run ONLY if `no-system-prompt` confirms the hypothesis:
 * extractor instruction moved to the USER prompt (stdin), --system-prompt dropped, --tools "" and
 * --json-schema both kept — structured output AND (if the hypothesis holds) prefix identity.
 * @param {SpikeState} state
 */
function stepUserPromptExtraction(state) {
  const cwd = ensureCwd(state);
  const args = buildArgsWithFlags(IDS.userPromptExtractionFork, { tools: true, jsonSchema: true });
  const { startedAt, finishedAt } = runClaude(
    'user-prompt-extraction',
    args,
    USER_PROMPT_WITH_EXTRACTION_INSTRUCTION,
    cwd,
  );
  state.userPromptExtractionStartedAt = startedAt;
  state.userPromptExtractionFinishedAt = finishedAt;
  saveState(state);
}

/** @param {SpikeState} state */
function stepTurn1(state) {
  const cwd = ensureCwd(state);
  const args = [
    '-p',
    '--model',
    'haiku',
    '--output-format',
    'json',
    '--session-id',
    IDS.original,
    '--max-budget-usd',
    MAX_BUDGET_USD,
  ];
  const { startedAt, finishedAt } = runClaude('turn1', args, TURN1_PROMPT, cwd);
  state.turn1StartedAt = startedAt;
  state.turn1FinishedAt = finishedAt;
  saveState(state);
}

/**
 * Arm 1 — today's real deep-capture shape (D-011): our system prompt, `--tools ""`, our JSON
 * schema, `--fork-session`. Different prefix from the live session by construction (Q-032): a
 * cache hit here would be surprising.
 *
 * @param {SpikeState} state
 */
function stepArm1(state) {
  const cwd = ensureCwd(state);
  const base = commonDeepResumeArgs(IDS.arm1Fork);
  const args = [
    ...base.slice(0, 5), // -p --model haiku --output-format json
    '--tools',
    '',
    '--system-prompt',
    GENERATION_SYSTEM_PROMPT,
    '--json-schema',
    UNDERSTANDING_JSON_SCHEMA,
    ...base.slice(5), // --resume <id> --fork-session --session-id <forkId> --max-budget-usd <n>
  ];
  const { startedAt, finishedAt } = runClaude('arm1', args, DEEP_PROMPT, cwd);
  state.arm1StartedAt = startedAt;
  state.arm1FinishedAt = finishedAt;
  saveState(state);
}

/**
 * Arm 2 — same resume, WITHOUT our shaping flags: no `--system-prompt`, no `--tools ""`, no
 * `--json-schema`. Hypothesis under test (Q-032 item 2): this prefix matches the live session's
 * own (default Claude Code system prompt + default tools), so run immediately after turn1/arm1 to
 * test prefix identity while the cache is still hot.
 *
 * @param {SpikeState} state
 */
function stepArm2(state) {
  const cwd = ensureCwd(state);
  const args = commonDeepResumeArgs(IDS.arm2Fork);
  const { startedAt, finishedAt } = runClaude('arm2', args, DEEP_PROMPT, cwd);
  state.arm2StartedAt = startedAt;
  state.arm2FinishedAt = finishedAt;
  saveState(state);
}

/**
 * Arm 3 (and arm4, arm5, ... via extra labels) — Arm 2's exact shape again, run as a SEPARATE
 * script invocation after the operator has slept synchronously for some interval since arm2
 * finished. Prints elapsed minutes since arm2 so the caller can confirm the intended wait actually
 * elapsed (docs/FLUXO-DE-AGENTES.md: read the clock, don't assume).
 *
 * @param {SpikeState} state
 * @param {string} label
 * @param {string} forkId
 */
function stepArmRepeat(state, label, forkId) {
  const arm2FinishedAt = state.arm2FinishedAt;
  if (!arm2FinishedAt) {
    throw new Error(`${label}: run "arm2" first — no arm2FinishedAt in state.`);
  }
  const cwd = ensureCwd(state);
  const elapsedMs = Date.now() - new Date(arm2FinishedAt).getTime();
  console.log(
    `[${label}] elapsed since arm2 finished: ${(elapsedMs / 60000).toFixed(2)} minutes ` +
      `(arm2 finished at ${arm2FinishedAt})`,
  );
  const args = commonDeepResumeArgs(forkId);
  const { startedAt, finishedAt } = runClaude(label, args, DEEP_PROMPT, cwd);
  state[`${label}StartedAt`] = startedAt;
  state[`${label}FinishedAt`] = finishedAt;
  state[`${label}ElapsedSinceArm2Ms`] = elapsedMs;
  saveState(state);
}

function main() {
  const step = process.argv[2];
  const state = loadState();
  console.log(`state file: ${STATE_FILE}`);
  switch (step) {
    case 'turn1':
      stepTurn1(state);
      break;
    case 'arm1':
      stepArm1(state);
      break;
    case 'arm2':
      stepArm2(state);
      break;
    case 'arm3':
      stepArmRepeat(state, 'arm3', IDS.arm3Fork);
      break;
    case 'arm4':
      stepArmRepeat(state, 'arm4', IDS.arm4Fork);
      break;
    // S4-T00b arms (docs/spikes/J-cache-na-captura.md's new section) — separate fresh original
    // session (IDS.original2), see that constant's comment.
    case 'turn1b':
      stepTurn1b(state);
      break;
    case 'base':
      stepBase(state);
      break;
    case 'no-system-prompt':
      stepNoSystemPrompt(state);
      break;
    case 'no-tools':
      stepNoTools(state);
      break;
    case 'no-json-schema':
      stepNoJsonSchema(state);
      break;
    case 'user-prompt-extraction':
      stepUserPromptExtraction(state);
      break;
    case 'no-flags-control':
      stepNoFlagsControl(state);
      break;
    // S4-T00c (Q-036): lean-prompt assistant-text volume measurement, unrelated to the
    // --resume/cache arms above — see the constants' own comments just above these steps.
    case 'lean-baseline':
      stepLeanBaseline(state);
      break;
    case 'lean-assistant-small':
      stepLeanAssistantSmall(state);
      break;
    case 'lean-assistant-large':
      stepLeanAssistantLarge(state);
      break;
    default:
      console.error(
        'Usage: node scripts/spike-j-measure.mjs ' +
          '<turn1|arm1|arm2|arm3|arm4|turn1b|base|no-system-prompt|no-tools|no-json-schema|' +
          'user-prompt-extraction|lean-baseline|lean-assistant-small|lean-assistant-large>',
      );
      process.exitCode = 1;
  }
}

main();
