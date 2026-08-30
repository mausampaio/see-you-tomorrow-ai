#!/usr/bin/env node
// A fake `claude` binary for tests/integration/resumption (S3-T2). Plain Node script, not part of
// the TypeScript program (eslint.config.js excludes tests/fixtures/**/*.mjs) — spawned as a real
// child process with stdio INHERITED, exactly like production's `spawn-interactive.ts` does.
//
// **Deliberately never reads stdin**, unlike tests/fixtures/generation/fake-claude.mjs. That one
// reads stdin because generation's real contract sends the prompt over it; resumption's contract
// is `stdio: 'inherit'` — stdin is the real terminal, and reading fd 0 synchronously with
// `readFileSync(0)` would block forever waiting for a human to type or press Ctrl+D whenever this
// process's own inherited stdin isn't already closed (a live interactive shell running the test
// suite, as opposed to CI's usually-closed stdin). This script proves the resumption adapter's
// argv/env/timing contract without needing that channel at all.
//
// Controlled entirely by environment variables the test sets before spawning:
//   FAKE_CLAUDE_EXIT_CODE          exit code to use (default '0')
//   FAKE_CLAUDE_EXIT_DELAY_MS      milliseconds to wait before exiting (default '0') — lets a
//                                  test simulate "closed fast" vs. "ran for a while, like a real
//                                  session"
//   FAKE_CLAUDE_FAIL_IF_RESUME     if set, exits 1 fast whenever argv contains `--resume`, and
//                                  0 otherwise — lets ONE `ClaudeSessionResumer.resume()` call
//                                  exercise "the --resume attempt fails, the fallback succeeds"
//                                  with a single fake binary and a single env, since both the
//                                  primary and fallback spawn share the same sanitized env
//                                  (`resumer.ts` builds it once per `resume()` call) and can only
//                                  be told apart by what each one's own argv looks like.
//   FAKE_CLAUDE_CAPTURE_FILE       if set, appends one JSON line per invocation with
//                                  {argv, env, contextFileContent} to this file — the proof
//                                  instrument for D-015 (argument shape) and D-017 (env
//                                  sanitization). One line per call (not a single overwritten
//                                  object) because a resume-then-fallback sequence spawns this
//                                  script twice and a test needs to see both calls.
//                                  `contextFileContent` is read HERE, before `resumer.ts`'s own
//                                  cleanup deletes the scratch file right after this process
//                                  exits — a test reading the path back afterward would always
//                                  find it already gone, exactly what that cleanup is for.

import { appendFileSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const contextFileFlagIndex = argv.indexOf('--append-system-prompt-file');
const contextFileContent =
  contextFileFlagIndex === -1 ? null : readFileSync(argv[contextFileFlagIndex + 1], 'utf8');

const captureFile = process.env['FAKE_CLAUDE_CAPTURE_FILE'];
if (captureFile !== undefined) {
  appendFileSync(
    captureFile,
    `${JSON.stringify({ argv, env: process.env, contextFileContent })}\n`,
    'utf8',
  );
}

const failIfResume = process.env['FAKE_CLAUDE_FAIL_IF_RESUME'] !== undefined;
const resumedInvocation = argv.includes('--resume');
const exitCode =
  failIfResume && resumedInvocation ? 1 : Number(process.env['FAKE_CLAUDE_EXIT_CODE'] ?? '0');
const delayMs = Number(process.env['FAKE_CLAUDE_EXIT_DELAY_MS'] ?? '0');

setTimeout(() => {
  process.exit(exitCode);
}, delayMs);
