/**
 * Shared e2e harness (docs/TESTES.md § E2E: "Rodam o binário `seeya` compilado, com
 * `HOME`/`USERPROFILE` apontando para `tmpdir` e um `claude` falso no PATH"). Every e2e test gets
 * its own root via `mkdtemp`, never touches the real `~/.claude`/`~/.seeya`, and must call
 * `removeE2eHome` in its own `afterEach` (same convention as
 * `tests/integration/discovery/_fixtures.ts`).
 */
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface E2eHome {
  readonly root: string;
  readonly homeDir: string;
  readonly claudeHome: string;
  readonly seeyaHome: string;
  readonly sessionsDir: string;
  readonly projectsDir: string;
  readonly fakeClaudeDir: string;
}

/**
 * A `claude` on PATH that does nothing but exit 0. docs/TESTES.md's e2e harness always sets one
 * up, even though `seeya sessions`/`status` (S1-T6) never invoke it — later e2e tasks (S2-T5
 * onward, which need canned `claude -p` output) are expected to grow this into something with
 * real behavior. Inventing that behavior now, before any command needs it, isn't this task's job.
 */
async function createFakeClaude(dir: string): Promise<void> {
  if (process.platform === 'win32') {
    await writeFile(path.join(dir, 'claude.cmd'), '@echo off\r\nexit /b 0\r\n', 'utf8');
    return;
  }
  const scriptPath = path.join(dir, 'claude');
  await writeFile(scriptPath, '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(scriptPath, 0o755);
}

export async function createE2eHome(): Promise<E2eHome> {
  const root = await mkdtemp(path.join(tmpdir(), 'seeya-e2e-'));
  const homeDir = path.join(root, 'home');
  const claudeHome = path.join(homeDir, '.claude');
  const seeyaHome = path.join(homeDir, '.seeya');
  const sessionsDir = path.join(claudeHome, 'sessions');
  const projectsDir = path.join(claudeHome, 'projects');
  const fakeClaudeDir = path.join(root, 'fake-claude');
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(projectsDir, { recursive: true });
  await mkdir(seeyaHome, { recursive: true });
  await mkdir(fakeClaudeDir, { recursive: true });
  await createFakeClaude(fakeClaudeDir);
  return { root, homeDir, claudeHome, seeyaHome, sessionsDir, projectsDir, fakeClaudeDir };
}

export async function removeE2eHome(home: E2eHome): Promise<void> {
  await rm(home.root, { recursive: true, force: true });
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
 */
export function runSeeya(home: E2eHome, args: readonly string[]): Promise<SeeyaResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST_CLI_PATH, ...args], {
      env: {
        ...process.env,
        HOME: home.homeDir,
        USERPROFILE: home.homeDir,
        PATH: `${home.fakeClaudeDir}${path.delimiter}${process.env.PATH ?? ''}`,
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
