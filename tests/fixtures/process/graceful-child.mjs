// Trivial child process for tests/integration/process/*.test.ts. On SIGTERM it writes a marker
// file before exiting — the marker existing is the proof that a real signal handler ran to
// completion (a graceful shutdown), as opposed to the process being torn down mid-flight
// (docs/PLANO-DE-ENTREGA.md S1-T2, pitfall 1: Windows' `TerminateProcess` never gives it this
// chance). The marker path comes in as argv[2] so each test run gets its own file.
import { writeFileSync } from 'node:fs';

const markerPath = process.argv[2];

process.on('SIGTERM', () => {
  writeFileSync(markerPath, `graceful-shutdown ${Date.now()}\n`);
  process.exit(0);
});

// Keep the event loop alive without a busy loop or a banned bare setInterval-as-scheduling —
// this is the fixture *being* the long-lived process, not code deciding when to check a clock.
setInterval(() => {}, 1000);

// Tells the test the handler above is registered and it's safe to send a signal now — without
// this, a signal sent right after `spawn()` returns can race Node's own startup (parsing this
// file, wiring the listener) and get treated as if there were no handler at all, killing the
// process before it ever had the chance to catch anything. Real-process race, not a test flake to
// paper over: reproduced on the Linux CI container before this line existed.
process.stdout.write('ready\n');
