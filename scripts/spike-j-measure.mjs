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
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
};

const MAX_BUDGET_USD = '0.20';

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

function loadState() {
  if (!existsSync(STATE_FILE)) {
    return {};
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

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
 */
function runClaude(label, args, stdinContent, cwd) {
  const startedAt = new Date().toISOString();
  console.log(`[${label}] starting at ${startedAt}`);
  console.log(`[${label}] args: claude ${args.join(' ')}`);
  const result = spawnSync('claude', args, {
    cwd,
    env: sanitizeEnv(process.env),
    input: stdinContent,
    encoding: 'utf8',
    shell: false,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
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

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    console.error(`[${label}] stdout was not valid JSON — raw output still saved for inspection.`);
    throw error;
  }
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

/** Arm 1 — today's real deep-capture shape (D-011): our system prompt, `--tools ""`, our JSON
 * schema, `--fork-session`. Different prefix from the live session by construction (Q-032): a
 * cache hit here would be surprising. */
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

/** Arm 2 — same resume, WITHOUT our shaping flags: no `--system-prompt`, no `--tools ""`, no
 * `--json-schema`. Hypothesis under test (Q-032 item 2): this prefix matches the live session's
 * own (default Claude Code system prompt + default tools), so run immediately after turn1/arm1 to
 * test prefix identity while the cache is still hot. */
function stepArm2(state) {
  const cwd = ensureCwd(state);
  const args = commonDeepResumeArgs(IDS.arm2Fork);
  const { startedAt, finishedAt } = runClaude('arm2', args, DEEP_PROMPT, cwd);
  state.arm2StartedAt = startedAt;
  state.arm2FinishedAt = finishedAt;
  saveState(state);
}

/** Arm 3 (and arm4, arm5, ... via extra labels) — Arm 2's exact shape again, run as a SEPARATE
 * script invocation after the operator has slept synchronously for some interval since arm2
 * finished. Prints elapsed minutes since arm2 so the caller can confirm the intended wait actually
 * elapsed (docs/FLUXO-DE-AGENTES.md: read the clock, don't assume). */
function stepArmRepeat(state, label, forkId) {
  if (!state.arm2FinishedAt) {
    throw new Error(`${label}: run "arm2" first — no arm2FinishedAt in state.`);
  }
  const cwd = ensureCwd(state);
  const elapsedMs = Date.now() - new Date(state.arm2FinishedAt).getTime();
  console.log(
    `[${label}] elapsed since arm2 finished: ${(elapsedMs / 60000).toFixed(2)} minutes ` +
      `(arm2 finished at ${state.arm2FinishedAt})`,
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
    default:
      console.error('Usage: node scripts/spike-j-measure.mjs <turn1|arm1|arm2|arm3|arm4>');
      process.exitCode = 1;
  }
}

main();
