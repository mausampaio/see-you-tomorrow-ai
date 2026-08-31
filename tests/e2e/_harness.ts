/**
 * Shared e2e harness (docs/TESTES.md § E2E: "Rodam o binário `seeya` compilado, com
 * `HOME`/`USERPROFILE` apontando para `tmpdir` e um `claude` falso no PATH"). Every e2e test gets
 * its own root via `mkdtemp`, never touches the real `~/.claude`/`~/.seeya`, and must call
 * `removeE2eHome` in its own `afterEach` (same convention as
 * `tests/integration/discovery/_fixtures.ts`).
 */
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFakeClaudeFixture,
  removeFakeClaudeFixture,
  readCapturedClaudeCall,
  type CapturedClaudeCall,
  type FakeClaudeFixture,
} from '../integration/generation/_fixtures.js';
import {
  createFakeNotificationCommandsFixture,
  removeFakeNotificationCommandsFixture,
  type FakeNotificationCommandsFixture,
} from './_fake-notification-commands.js';

export interface E2eHome {
  readonly root: string;
  readonly homeDir: string;
  readonly claudeHome: string;
  readonly seeyaHome: string;
  readonly sessionsDir: string;
  readonly projectsDir: string;
  readonly fakeClaudeDir: string;
  /** The fake `claude` fixture itself (`tests/integration/generation/_fixtures.ts`, reused rather
   * than a second, weaker fake — see this file's own comment on `createFakeClaude` below). S2-T5
   * onward controls its behavior per-test through `FAKE_CLAUDE_*` env vars passed to `runSeeya`. */
  readonly claudeFixture: FakeClaudeFixture;
  /** S4-T1: fakes `powershell.exe`/`notify-send`/`osascript` so `seeya end-day`'s real `Notifier`
   * (wired in `cli/composition.ts`) never shows a real OS notification while this suite runs — see
   * `_fake-notification-commands.ts`'s own top comment. */
  readonly notificationCommandsFixture: FakeNotificationCommandsFixture;
}

/**
 * Puts a REAL fake `claude` on PATH — not the do-nothing stub S1-T6 (`seeya sessions`/`status`)
 * got away with, since neither of those commands ever spawns `claude` at all. S2-T5 (`end-day`)
 * does, so this harness now reuses `tests/integration/generation/_fixtures.ts`'s
 * `createFakeClaudeFixture()` instead of inventing a second, weaker fake: same script
 * (`fake-claude.mjs`), same Windows-native-`.exe`-shim workaround (a `.cmd` on PATH would lose to a
 * REAL `claude.exe` elsewhere on the developer's own PATH — measured in that file's own comment),
 * controlled the same way, via `FAKE_CLAUDE_MODE`/`FAKE_CLAUDE_STDOUT`/`FAKE_CLAUDE_EXIT_CODE`.
 */
async function createFakeClaude(): Promise<FakeClaudeFixture> {
  return createFakeClaudeFixture();
}

export async function createE2eHome(): Promise<E2eHome> {
  const root = await mkdtemp(path.join(tmpdir(), 'seeya-e2e-'));
  const homeDir = path.join(root, 'home');
  const claudeHome = path.join(homeDir, '.claude');
  const seeyaHome = path.join(homeDir, '.seeya');
  const sessionsDir = path.join(claudeHome, 'sessions');
  const projectsDir = path.join(claudeHome, 'projects');
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(projectsDir, { recursive: true });
  await mkdir(seeyaHome, { recursive: true });
  const claudeFixture = await createFakeClaude();
  // **NOT `claudeFixture.dir`.** On Windows, `createFakeClaudeFixture()`'s `binaryPath` lives in
  // its OWN separate compiled-shim directory (`getWindowsShimBinary()`, shared/memoized across the
  // whole worker process) — `dir` only ever holds `capture.json`, never the `.exe` itself. Every
  // existing caller of this fixture (`tests/integration/generation/*.test.ts`) passes
  // `binaryPath` straight to `claudeBinary`, sidestepping PATH entirely; THIS harness is the first
  // caller that needs a directory to prepend to `PATH` for a bare `claude` lookup, and
  // `claudeFixture.dir` is the wrong one to use for that (measured: without this fix, `PATH`
  // resolution silently fell through to a REAL `claude.exe` elsewhere on this machine's PATH).
  const fakeClaudeDir = path.dirname(claudeFixture.binaryPath);
  const notificationCommandsFixture = await createFakeNotificationCommandsFixture();
  return {
    root,
    homeDir,
    claudeHome,
    seeyaHome,
    sessionsDir,
    projectsDir,
    fakeClaudeDir,
    claudeFixture,
    notificationCommandsFixture,
  };
}

export async function removeE2eHome(home: E2eHome): Promise<void> {
  await removeFakeClaudeFixture(home.claudeFixture);
  await removeFakeNotificationCommandsFixture(home.notificationCommandsFixture);
  // S2-T5's own end-day journeys spawn a real fake `claude` INSIDE a project directory under
  // `home.root` (its `cwd`) — on Windows, the OS can hold a directory handle open for a few
  // milliseconds after the spawned process's `close` event already fired (observed here, not
  // theoretical: `EBUSY` on this exact `rm` without the retry). `maxRetries`/`retryDelay` is
  // `fs.rm`'s own documented mechanism for this Windows behavior — never a hand-rolled sleep loop
  // (D-019 forbids `setTimeout` outside `adapters/clock/`, and this is test-only cleanup, not
  // production code, but there is no reason to reinvent what `fs.rm` already offers).
  await rm(home.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Reads back what the fake `claude` process actually received on its LAST invocation this test
 * made — the same proof instrument `tests/integration/generation/_fixtures.ts` gives its own
 * suite, reused here instead of a second copy. */
export function readLastClaudeCall(home: E2eHome): Promise<CapturedClaudeCall> {
  return readCapturedClaudeCall(home.claudeFixture);
}

export async function writeSessionRecord(
  home: E2eHome,
  fileName: string,
  record: unknown,
): Promise<void> {
  await writeFile(path.join(home.sessionsDir, `${fileName}.json`), JSON.stringify(record), 'utf8');
}

export async function writeRawSessionFile(
  home: E2eHome,
  fileName: string,
  content: string,
): Promise<void> {
  await writeFile(path.join(home.sessionsDir, fileName), content, 'utf8');
}

export async function writeTranscript(
  home: E2eHome,
  slug: string,
  sessionId: string,
  content: string,
  mtime: Date,
): Promise<void> {
  const dir = path.join(home.projectsDir, slug);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  await writeFile(filePath, content, 'utf8');
  await utimes(filePath, mtime, mtime);
}

/**
 * `dist/cli/index.js` — the artifact `npm run build` produces (`tsconfig.build.json`). Resolved
 * relative to this file rather than `process.cwd()` so the harness works the same regardless of
 * which directory vitest is invoked from. `package.json`'s `pretest:e2e` script runs `npm run
 * build` before this project executes, so this path is always fresh — see that script's comment
 * for why a stale or missing `dist/` would otherwise pass silently against old code.
 */
const DIST_CLI_PATH = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));

export interface SeeyaResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

/**
 * Spawns the COMPILED binary via `node`, never via `tsx`/vitest's own TypeScript execution —
 * docs/TESTES.md's e2e nº1 is explicit that the point is exercising the built artifact. This
 * project has already been bitten once by a build gap invisible from source: `tsconfig.build.json`
 * compiled without `@types/node` for a while, and nothing caught it because nothing ran the
 * output (AGENTS.md's "erro clássico" is a different bug, but the same shape of gap).
 *
 * `extraEnv` (S2-T5) is how a test controls the fake `claude` this run's `seeya end-day` spawns —
 * `FAKE_CLAUDE_MODE`/`FAKE_CLAUDE_STDOUT`/`FAKE_CLAUDE_EXIT_CODE`/`FAKE_CLAUDE_CAPTURE_FILE`
 * (`tests/fixtures/generation/fake-claude.mjs`) all pass straight through: `seeya` spawns `claude`
 * from ITS OWN `process.env` (`adapters/generation/env.ts#buildGenerationEnv`), which is exactly
 * the env this harness gives the `seeya` process here, and none of these four names are in
 * D-017's stripped list, so they survive the sanitization untouched.
 *
 * `PATH` also shadows the real native notification command (S4-T1,
 * `_fake-notification-commands.ts`) ahead of whatever real one exists on the host running this
 * suite — every `seeya end-day` run past this point spawns the REAL `Notifier`
 * (`cli/composition.ts`), and without this, the process running this very test would show a real
 * OS notification.
 */
export function runSeeya(
  home: E2eHome,
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<SeeyaResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST_CLI_PATH, ...args], {
      env: {
        ...process.env,
        ...extraEnv,
        HOME: home.homeDir,
        USERPROFILE: home.homeDir,
        PATH: [
          home.fakeClaudeDir,
          home.notificationCommandsFixture.dir,
          process.env.PATH ?? '',
        ].join(path.delimiter),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}
