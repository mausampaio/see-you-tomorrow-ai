/**
 * E2E nº1 (docs/TESTES.md § E2E): "`seeya sessions` lista corretamente vivas, ociosas e
 * encerradas." Runs the COMPILED `dist/cli/index.js` (via `_harness.ts#runSeeya`) with
 * `HOME`/`USERPROFILE` pointed at a `tmpdir` and a fake `claude` on PATH — never `src/` directly,
 * so a build-only defect (like the `tsconfig.build.json` gap AGENTS.md warns about) would actually
 * fail this test.
 *
 * Also covers, in the same journey (S1-T6's own acceptance list): D-021 (a session missing the
 * cosmetic `name` field is still listed, named from its `cwd`) and D-022/Q-012 (a corrupted
 * registry entry is reported as an ignored entry, not silently dropped).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureObservedProcStart } from '../../src/adapters/process/proc-start.js';
import { processExists } from '../../src/adapters/process/existence.js';
import {
  createE2eHome,
  removeE2eHome,
  runSeeya,
  writeRawSessionFile,
  writeSessionRecord,
  writeTranscript,
  type E2eHome,
} from './_harness.js';

const CHILD_SCRIPT = fileURLToPath(
  new URL('../fixtures/process/graceful-child.mjs', import.meta.url),
);

let home: E2eHome | undefined;
let spawned: ChildProcess[] = [];

function spawnTrivialChild(): ChildProcess {
  const child = spawn(process.execPath, [CHILD_SCRIPT], { stdio: 'ignore' });
  spawned.push(child);
  return child;
}

async function realProcStart(pid: number): Promise<string> {
  const capture = await captureObservedProcStart(pid, processExists);
  if (capture.kind !== 'value') {
    throw new Error(
      `expected a real procStart capture for pid ${pid}, got ${JSON.stringify(capture)}`,
    );
  }
  return capture.value;
}

function killAndWait(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });
}

afterEach(async () => {
  for (const child of spawned) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already dead — fine, this is test cleanup, not the product's own termination policy.
    }
  }
  spawned = [];
  if (home !== undefined) {
    await removeE2eHome(home);
    home = undefined;
  }
});

describe('e2e: seeya sessions', () => {
  it(
    'lists alive, idle and ended sessions correctly, keeps a nameless session visible (D-021), ' +
      'and surfaces a corrupted entry instead of dropping it (D-022/Q-012)',
    async () => {
      home = await createE2eHome();

      // 1. Alive: a real live process, no transcript at all — must read "alive", not "idle"
      // (D-025: absence of a transcript write is not evidence of idleness).
      const aliveChild = spawnTrivialChild();
      const alivePid = aliveChild.pid as number;
      await writeSessionRecord(home, 'alive', {
        pid: alivePid,
        sessionId: '11111111-1111-4111-8111-111111111111',
        cwd: 'c:\\code\\e2e-alive',
        startedAt: Date.now() - 60_000,
        procStart: await realProcStart(alivePid),
        name: 'e2e-alive',
      });

      // 2. Idle: a real live process with a transcript write older than idleMinutes (default 45m).
      const idleChild = spawnTrivialChild();
      const idlePid = idleChild.pid as number;
      await writeSessionRecord(home, 'idle', {
        pid: idlePid,
        sessionId: '22222222-2222-4222-8222-222222222222',
        cwd: 'c:\\code\\e2e-idle',
        startedAt: Date.now() - 2 * 60 * 60_000,
        procStart: await realProcStart(idlePid),
        name: 'e2e-idle',
      });
      await writeTranscript(
        home,
        'e2e-idle-slug',
        '22222222-2222-4222-8222-222222222222',
        `${JSON.stringify({ type: 'user', cwd: 'c:\\code\\e2e-idle' })}\n`,
        new Date(Date.now() - 60 * 60_000), // one hour of silence, past the 45m default
      );

      // 3. Ended: a genuinely dead PID — stale registry entry, reported "ended", not discarded
      // (docs/ESPECIFICACAO.md § "Como as sessões são descobertas").
      const endedChild = spawnTrivialChild();
      const endedPid = endedChild.pid as number;
      const endedProcStart = await realProcStart(endedPid);
      await killAndWait(endedChild);
      await writeSessionRecord(home, 'ended', {
        pid: endedPid,
        sessionId: '33333333-3333-4333-8333-333333333333',
        cwd: 'c:\\code\\e2e-ended',
        startedAt: Date.now() - 60_000,
        procStart: endedProcStart,
        name: 'e2e-ended',
      });

      // 4. D-021: no "name" field at all — must still appear, named from its cwd.
      const unnamedChild = spawnTrivialChild();
      const unnamedPid = unnamedChild.pid as number;
      await writeSessionRecord(home, 'unnamed', {
        pid: unnamedPid,
        sessionId: '44444444-4444-4444-8444-444444444444',
        cwd: 'c:\\code\\e2e-unnamed',
        startedAt: Date.now() - 60_000,
        procStart: await realProcStart(unnamedPid),
        // no "name": the point of this session.
      });

      // 5. D-022/Q-012: a corrupted registry entry — must be reported, not silently dropped.
      await writeRawSessionFile(home, 'broken.json', 'not json {{{');

      const result = await runSeeya(home, ['sessions']);

      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('4 sessions found, 1 entry ignored.');

      expect(result.stdout).toMatch(/e2e-alive\)[\s\S]*?state: alive/);
      expect(result.stdout).toMatch(/e2e-idle\)[\s\S]*?state: idle/);
      expect(result.stdout).toMatch(/e2e-ended\)[\s\S]*?state: ended/);
      // D-021's default name is the cwd's last segment (session-mapping.ts#deriveNameFromCwd).
      expect(result.stdout).toContain('e2e-unnamed');

      expect(result.stdout).toContain('Ignored entries:');
      expect(result.stdout).toContain('broken.json');
    },
  );
});
