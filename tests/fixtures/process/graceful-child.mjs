// Trivial child process for tests/integration/process/*.test.ts. On SIGTERM (POSIX) or SIGBREAK
// (Windows, S1-T2b) it writes a marker file before exiting — the marker existing is the proof
// that a real signal handler ran to completion (a graceful shutdown), as opposed to the process
// being torn down mid-flight (docs/PLANO-DE-ENTREGA.md S1-T2, pitfall 1: Windows'
// `TerminateProcess` never gives it this chance). The marker path comes in as argv[2] so each
// test run gets its own file.
//
// SIGBREAK is what Node maps `CTRL_BREAK_EVENT` onto on Windows (docs/spikes/G-ctrl-break-no-
// windows.md) — registering a listener is what makes this fixture stand in for a real Claude
// Code session's own graceful shutdown path in tests/integration/process/termination.test.ts.
// The listener is harmless on POSIX: 'SIGBREAK' is simply never emitted there.
import { writeFileSync } from 'node:fs';

const markerPath = process.argv[2];
// Optional fourth signal channel: some tests launch this fixture through a mechanism that can't
// read its stdout (a new console via PowerShell's Start-Process, needed so the CTRL_BREAK
// broadcast in the Windows graceful test never reaches the test runner's own console — see
// tests/integration/process/_windows-console.ts). Those tests pass a path here and poll for the
// file instead of the 'ready' stdout line below.
const readyMarkerPath = process.argv[3];

function writeShutdownMarkerAndExit() {
  writeFileSync(markerPath, `graceful-shutdown ${Date.now()}\n`);
  process.exit(0);
}

process.on('SIGTERM', writeShutdownMarkerAndExit);
process.on('SIGBREAK', writeShutdownMarkerAndExit);

// Keep the event loop alive without a busy loop or a banned bare setInterval-as-scheduling —
// this is the fixture *being* the long-lived process, not code deciding when to check a clock.
setInterval(() => {}, 1000);

// Tells the test the handlers above are registered and it's safe to send a signal now — without
// this, a signal sent right after `spawn()` returns can race Node's own startup (parsing this
// file, wiring the listeners) and get treated as if there were no handler at all, killing the
// process before it ever had the chance to catch anything. Real-process race, not a test flake to
// paper over: reproduced on the Linux CI container before this line existed.
if (readyMarkerPath !== undefined) {
  writeFileSync(readyMarkerPath, 'ready\n');
}
process.stdout.write('ready\n');
