#!/usr/bin/env node
// A fake `claude` binary for tests/integration/generation (docs/TESTES.md § `generation/`: "um
// script falso de `claude` colocado no PATH do teste, que devolve JSON canned, JSON inválido,
// código de saída != 0, e um que trava"). Plain Node script, not part of the TypeScript program
// (eslint.config.js excludes tests/fixtures/**/*.mjs) — spawned as a real child process, never
// imported.
//
// Controlled entirely by environment variables the test sets before spawning, so ONE script
// covers every fixture instead of four near-duplicates:
//   FAKE_CLAUDE_MODE           'success' | 'invalid-json' | 'nonzero' | 'hang' (default 'success')
//   FAKE_CLAUDE_STDOUT         stdout text for 'success' mode; also honored by 'nonzero' (S4-T00d:
//                              claude can write its own `--output-format json` envelope to stdout
//                              even when the process itself exits non-zero — unset/empty here
//                              reproduces the original "exit != 0, unreadable stdout" case).
//   FAKE_CLAUDE_EXIT_CODE      exit code for 'nonzero' mode (default '1')
//   FAKE_CLAUDE_CAPTURE_FILE   if set, this process writes {argv, stdin, env} here as JSON BEFORE
//                              acting on FAKE_CLAUDE_MODE — this is the proof instrument for D-015
//                              (stdin arrives intact) and D-017 (the child's env is sanitized):
//                              the test reads this file back and inspects exactly what the real
//                              child process received, not what the test THINKS it sent.
//
// S4-T3e: stdin is read ASYNCHRONOUSLY (below), never with a blocking `readFileSync(0)`. Measured
// on this machine: killing the process this script's launcher spawns it from (the AbortSignal
// that `spawn-claude.ts` fires on timeout, or the two-hop Windows `.exe` shim
// `tests/integration/generation/_fixtures.ts` compiles to work around Node's `.cmd` EINVAL
// restriction) terminates only the IMMEDIATE child on Windows — a grandchild this process becomes,
// through the shim, is never signaled and is orphaned. A synchronous `readFileSync(0)` blocks the
// event loop, so nothing running in THIS process could ever notice and self-destruct; reading
// async keeps the loop free for the watchdog below to fire regardless of whether anything upstream
// ever kills this process. This is deliberately a backstop, not a replacement for whoever spawns
// this script closing its own end of the pipe — it's what caps the damage when that doesn't
// happen, or can't reach this process at all (the orphaned-grandchild case measured above).

import { writeFileSync } from 'node:fs';

// Generous relative to the shortest real timeout any test pairs with FAKE_CLAUDE_MODE=hang (300ms,
// tests/integration/generation/{lean,deep}-generator.test.ts) — the external kill should always
// win that race — but short enough that an orphaned process (the case this exists for) is gone
// long before "run the whole suite twice" (docs/PLANO-DE-ENTREGA.md S4-T3e's acceptance check)
// finishes, instead of living for weeks like the 31 processes that prompted this fix.
const MAX_LIFETIME_MS = 5_000;

// Fires unconditionally at process start, not after some later branch — an orphaned grandchild
// (see top comment) never reaches any later code, so the watchdog has to be armed before anything
// else runs. `process.exit()` below (every mode but 'hang') cancels pending timers as part of
// tearing the process down, so this never fires on the paths that already exit on their own.
setTimeout(() => {
  process.stderr.write(
    `fake claude: self-destructing after ${MAX_LIFETIME_MS}ms with no external kill (S4-T3e watchdog)\n`,
  );
  process.exit(1);
}, MAX_LIFETIME_MS);

function readAllStdin() {
  if (process.stdin.isTTY) {
    // No stdin piped in (e.g. a TTY) — normal for a manual run of this script, never for how the
    // real generator invokes it.
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    // 'error' resolves with whatever was read so far rather than rejecting: this script's job is
    // to report what it received, never to crash on a broken pipe, and the capture file below is
    // what makes a truncated read visible to the test instead of hiding it as a clean empty string.
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

const stdin = await readAllStdin();

const captureFile = process.env['FAKE_CLAUDE_CAPTURE_FILE'];
if (captureFile !== undefined) {
  writeFileSync(
    captureFile,
    JSON.stringify({ argv: process.argv.slice(2), stdin, env: process.env }),
    'utf8',
  );
}

const mode = process.env['FAKE_CLAUDE_MODE'] ?? 'success';

switch (mode) {
  case 'success':
    process.stdout.write(process.env['FAKE_CLAUDE_STDOUT'] ?? '');
    process.exit(0);
    break;
  case 'invalid-json':
    process.stdout.write('this is not json {{{');
    process.exit(0);
    break;
  case 'nonzero':
    // Writing FAKE_CLAUDE_STDOUT here too (S4-T00d) lets one test simulate claude reporting
    // `is_error` on stdout while still exiting non-zero; leaving it unset keeps the original
    // "exit != 0, stdout has nothing readable" case working unchanged.
    process.stdout.write(process.env['FAKE_CLAUDE_STDOUT'] ?? '');
    process.stderr.write('fake claude: simulated failure\n');
    process.exit(Number(process.env['FAKE_CLAUDE_EXIT_CODE'] ?? '1'));
    break;
  case 'hang':
    // Never exits on its own — the test's own timeout is what's supposed to kill this. Keeps the
    // event loop alive without busy-looping (D-019 doesn't apply here: this file isn't under
    // src/, it's a spawned test fixture, and `setInterval` is exactly what a real hung process
    // looks like from the parent's point of view). The S4-T3e watchdog above is what guarantees
    // this still ends, even if the external kill never arrives (the orphaned-grandchild case).
    setInterval(() => {}, 1_000_000);
    break;
  default:
    process.stderr.write(`fake claude: unknown FAKE_CLAUDE_MODE "${mode}"\n`);
    process.exit(1);
}
