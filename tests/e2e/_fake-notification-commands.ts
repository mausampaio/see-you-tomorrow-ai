/**
 * Fakes every native notification command `adapters/notification/` might spawn, so e2e — which
 * runs the REAL compiled `dist/cli/index.js` (`_harness.ts#runSeeya`) — never shows a real OS
 * notification on whatever machine runs the suite (docs/PLANO-DE-ENTREGA.md S4-T1: "não notifique
 * de verdade durante o teste. Ninguém quer o portão cuspindo notificação na tela de quem roda
 * `npm test`"). Every e2e `end-day` run reaches `cli/composition.ts`'s real `notifier`
 * (`adapters/notification/index.ts`), which picks its backend by `process.platform` — only the
 * command matching the CI runner's real OS is ever actually resolved, but this fixture installs a
 * fake for all three uniformly: cheap, and future-proof against that platform check changing shape.
 *
 * Windows needs a REAL compiled `.exe`: `spawn('powershell.exe', args, {shell:false})` resolves
 * strictly by `PATH` + a real executable image — a text file named `.exe` fails to launch at all.
 * Same `csc.exe` technique `tests/integration/generation/_fixtures.ts` already established for
 * `claude.exe`, trimmed down: this fake needs no re-exec, just `exit 0`, since nothing here reads
 * back what it was called with (unlike the fake `claude`, which e2e's OWN assertions inspect).
 */
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CSC_CANDIDATES = [
  path.join(
    process.env['WINDIR'] ?? 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  ),
  path.join(
    process.env['WINDIR'] ?? 'C:\\Windows',
    'Microsoft.NET',
    'Framework',
    'v4.0.30319',
    'csc.exe',
  ),
];

function findCsc(): string {
  const found = CSC_CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `no C# compiler (csc.exe) found among: ${CSC_CANDIDATES.join(', ')}. This Windows-only ` +
        "e2e fixture needs it to build a real, no-op .exe (see this file's top comment for why a " +
        'plain text file cannot stand in for one).',
    );
  }
  return found;
}

/** A no-op `Main` is enough: nothing calls back into this process, and nothing reads its exit
 * code except `notification/`'s own backends, which only care that it is `0`. */
const NOOP_EXE_SOURCE = 'class NoOp { static int Main(string[] args) { return 0; } }\n';

async function writeWindowsNoOpExe(dir: string, fileName: string): Promise<void> {
  const sourcePath = path.join(dir, `${fileName}.cs`);
  const exePath = path.join(dir, fileName);
  await writeFile(sourcePath, NOOP_EXE_SOURCE, 'utf8');
  await execFileAsync(findCsc(), ['/nologo', `/out:${exePath}`, sourcePath]);
}

/** POSIX: a plain shebang script works fine with `shell:false` — no `EINVAL` restriction there
 * (that is a Windows-only, batch-file-specific Node behavior). */
async function writePosixNoOpScript(dir: string, fileName: string): Promise<void> {
  const scriptPath = path.join(dir, fileName);
  await writeFile(scriptPath, '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(scriptPath, 0o755);
}

export interface FakeNotificationCommandsFixture {
  readonly dir: string;
}

export async function createFakeNotificationCommandsFixture(): Promise<FakeNotificationCommandsFixture> {
  const dir = await mkdtemp(path.join(tmpdir(), 'seeya-e2e-fake-notify-'));
  if (process.platform === 'win32') {
    await writeWindowsNoOpExe(dir, 'powershell.exe');
  } else {
    // Both installed regardless of `process.platform === 'darwin' | 'linux'`: cheap, and it means
    // this fixture doesn't need to know which POSIX backend the real `seeya` process will pick.
    await writePosixNoOpScript(dir, 'notify-send');
    await writePosixNoOpScript(dir, 'osascript');
  }
  return { dir };
}

export async function removeFakeNotificationCommandsFixture(
  fixture: FakeNotificationCommandsFixture,
): Promise<void> {
  await rm(fixture.dir, { recursive: true, force: true });
}
