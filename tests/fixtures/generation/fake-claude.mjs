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
//   FAKE_CLAUDE_STDOUT         stdout text for 'success' mode
//   FAKE_CLAUDE_EXIT_CODE      exit code for 'nonzero' mode (default '1')
//   FAKE_CLAUDE_CAPTURE_FILE   if set, this process writes {argv, stdin, env} here as JSON BEFORE
//                              acting on FAKE_CLAUDE_MODE — this is the proof instrument for D-015
//                              (stdin arrives intact) and D-017 (the child's env is sanitized):
//                              the test reads this file back and inspects exactly what the real
//                              child process received, not what the test THINKS it sent.

import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';

function readAllStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    // No stdin piped in (e.g. a TTY) — normal for a manual run of this script, never for how the
    // real generator invokes it.
    return '';
  }
}

const stdin = readAllStdin();

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
    process.stderr.write('fake claude: simulated failure\n');
    process.exit(Number(process.env['FAKE_CLAUDE_EXIT_CODE'] ?? '1'));
    break;
  case 'hang':
    // Never exits on its own — the test's own timeout is what's supposed to kill this. Keeps the
    // event loop alive without busy-looping (D-019 doesn't apply here: this file isn't under
    // src/, it's a spawned test fixture, and `setInterval` is exactly what a real hung process
    // looks like from the parent's point of view).
    setInterval(() => {}, 1_000_000);
    break;
  default:
    process.stderr.write(`fake claude: unknown FAKE_CLAUDE_MODE "${mode}"\n`);
    process.exit(1);
}
