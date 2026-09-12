#!/usr/bin/env node
/**
 * Entry point for the `seeya` CLI (D-020: the project's only composition root). `sessions` and
 * `status` are the first two real commands (S1-T6, docs/ESPECIFICACAO.md § "Comandos") — every
 * other command in docs/PLANO-DE-ENTREGA.md still needs the tasks that build its own dependencies
 * (git, generation, storage's handoff methods, the daemon) first.
 *
 * This file itself stays deliberately thin: it only wires `commander` to `composition.ts` (the
 * one place allowed to name a concrete adapter) and the two command modules, then prints their
 * plain-text result (AGENTS.md § "Registro e saída" — user-facing output is plain text, through
 * `cli/`, never JSON). Building the context and formatting the report are both unit/integration
 * -tested without spawning this file; only the end-to-end journey (docs/TESTES.md's e2e nº1)
 * exercises this module for real, against the compiled `dist/cli/index.js`.
 */
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { z } from 'zod';
import packageJson from '../../package.json' with { type: 'json' };
import {
  buildCliContext,
  buildConfigContext,
  buildDaemonContext,
  buildEndDayContext,
  buildSnoozeContext,
  buildStartDayContext,
} from './composition.js';
import { runSessionsCommand } from './sessions-command.js';
import { runStatusCommand } from './status-command.js';
import { runEndDayCommand } from './end-day-command.js';
import { runStartDayCommand } from './start-day-command.js';
import {
  runDaemonLauncher,
  runDaemonWorker,
  runDaemonStatus,
  runDaemonStop,
} from './daemon-command.js';
import { runSnoozeCommand, runSkipTodayCommand } from './snooze-command.js';
import {
  runConfigGetCommand,
  runConfigPolicyCommand,
  runConfigSetCommand,
} from './config-command.js';
import { DAEMON_CHILD_ENV_VAR } from '../adapters/process/daemon-launch.js';
import { captureObservedProcStart } from '../adapters/process/proc-start.js';
import { processExists } from '../adapters/process/existence.js';

const PackageJsonSchema = z.object({
  version: z.string(),
});

const { version } = PackageJsonSchema.parse(packageJson);

const program = new Command();

program
  .name('seeya')
  .description(
    'Discovers Claude Code sessions, captures their state at the end of the day, and resumes them the next day.',
  )
  .version(version);

program
  .command('sessions')
  .description(
    'List known sessions: name, cwd, state (alive/idle/ended/unknown), last activity and ' +
      'end-of-day termination policy. Read-only.',
  )
  .action(async () => {
    const context = await buildCliContext();
    console.log(await runSessionsCommand(context));
  });

program
  .command('status')
  .description(
    'The single-panel answer to what is going to happen today and whether the daemon is ' +
      'handling it: configured and effective end-of-day time (snooze/skip-today folded in), ' +
      "eligible sessions, and the daemon's own state and health. Read-only.",
  )
  .action(async () => {
    const context = await buildCliContext();
    console.log(await runStatusCommand(context));
  });

program
  .command('end-day')
  .description(
    'Run the end-of-day capture: gathers evidence for every eligible session, writes a handoff ' +
      'and the daily briefing, and terminates opted-in sessions once their handoff is verified ' +
      'on disk. A generation failure never aborts the day (D-003) — this command exits ' +
      'successfully even when the model call fails for every session.',
  )
  .option(
    '--dry-run',
    'Run the same pipeline but stop before writing or terminating anything; show what would happen.',
  )
  .option('--session <idOrCwd>', 'Limit end-day to a single session, matched by sessionId or cwd.')
  .action(async (options: { dryRun?: boolean; session?: string }) => {
    const { deps, config, notifier } = await buildEndDayContext();
    console.log(
      await runEndDayCommand(
        deps,
        config,
        {
          dryRun: options.dryRun ?? false,
          // `exactOptionalPropertyTypes`: only set `session` when commander actually parsed one.
          ...(options.session !== undefined ? { session: options.session } : {}),
        },
        notifier,
      ),
    );
  });

program
  .command('start-day')
  .description(
    'Read the most recent still-pending briefing, show its consolidated plan, and resume the ' +
      'chosen sessions where they left off, one at a time (D-004).',
  )
  .option('--all', 'Resume every still-unresumed session in the found briefing.')
  .option('--session <id>', 'Resume only the session matching this sessionId or cwd.')
  .action(async (options: { all?: boolean; session?: string }) => {
    const context = await buildStartDayContext();
    const exitCode = await runStartDayCommand(
      context,
      {
        all: options.all ?? false,
        // `exactOptionalPropertyTypes`: only set `session` when commander actually parsed one.
        ...(options.session !== undefined ? { session: options.session } : {}),
      },
      { stdin: process.stdin, stdout: process.stdout, isTTY: process.stdin.isTTY === true },
    );
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  });

program
  .command('daemon')
  .description(
    'Start the long-running daemon that watches sessions and triggers the end-of-day capture ' +
      'at the configured time (D-005). Runs detached from this terminal — closing the window or ' +
      'logging out does not stop it. A second instance refuses to start while one is already ' +
      'running.',
  )
  .option(
    '--stop',
    'Stop the currently running daemon, if any (D-005). Not an error when none is running.',
  )
  .option(
    '--status',
    "Show whether a daemon is running, its health (S4-T3b), and today's schedule. Read-only.",
  )
  .action(async (options: { stop?: boolean; status?: boolean }) => {
    if (options.stop === true && options.status === true) {
      console.error('seeya: --stop and --status cannot be used together.');
      process.exitCode = 1;
      return;
    }
    if (options.stop === true) {
      const { storage, processControl, clock } = await buildDaemonContext();
      console.log(await runDaemonStop({ storage, processControl, clock }));
      return;
    }
    if (options.status === true) {
      const { storage, processControl, clock } = await buildDaemonContext();
      console.log(await runDaemonStatus({ storage, processControl, clock }));
      return;
    }
    if (process.env[DAEMON_CHILD_ENV_VAR] === '1') {
      const deps = await buildDaemonContext();
      // S4-T3b: the lock's own recycled-PID tie-break needs the WORKER's own procStart at the
      // moment it starts (core/daemon-lock.ts's own docstring) — captured here, the one real
      // composition root allowed to call adapters/process directly (D-020), then threaded down as
      // a plain value so scheduler/ never has to know how it was obtained (same discipline `pid`
      // itself already gets).
      const procStartCapture = await captureObservedProcStart(process.pid, processExists);
      const procStart = procStartCapture.kind === 'value' ? procStartCapture.value : undefined;
      const exitCode = await runDaemonWorker(deps, process.pid, procStart);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
      return;
    }
    const { storage, processControl } = await buildDaemonContext();
    const scriptPath = fileURLToPath(import.meta.url);
    console.log(await runDaemonLauncher(storage, processControl, { scriptPath, args: ['daemon'] }));
  });

program
  .command('snooze')
  .description(
    "Push back today's scheduled end-of-day closure by a fixed increment (D-006). Works with " +
      'or without the daemon running — the change is persisted to disk and picked up on its next poll.',
  )
  .argument('<increment>', 'One of +15m, +30m, +1h.')
  .action(async (increment: string) => {
    const context = await buildSnoozeContext();
    console.log(await runSnoozeCommand(context, increment));
  });

program
  .command('skip-today')
  .description(
    "Skip today's automatic end-of-day closure entirely (D-006); it resumes tomorrow. Works " +
      'with or without the daemon running.',
  )
  .action(async () => {
    const context = await buildSnoozeContext();
    console.log(await runSkipTodayCommand(context));
  });

const configCommand = program
  .command('config')
  .description(
    'Read and write ~/.seeya/config.json: end-of-day time, lead times, project policy, capture ' +
      'model and limits.',
  );

configCommand
  .command('get')
  .description('Print the current config, or a single key.')
  .argument('[key]', 'A single config key to print, e.g. endOfDayTime.')
  .action(async (key: string | undefined) => {
    const context = buildConfigContext();
    console.log(await runConfigGetCommand(context, key));
  });

configCommand
  .command('set')
  .description(
    'Set one config key. Validated before writing — an unknown key or an invalid value is refused.',
  )
  .argument('<key>', 'A config key, e.g. endOfDayTime, leadTimesInMinutes, captureModel.')
  .argument(
    '<value>',
    'The new value. Comma-separate list values (e.g. "30,15" for leadTimesInMinutes).',
  )
  .action(async (key: string, value: string) => {
    const context = buildConfigContext();
    console.log(await runConfigSetCommand(context, key, value));
  });

configCommand
  .command('policy')
  .description(
    "Show or update one project's termination/deep-capture policy, keyed by cwd (D-002, D-011).",
  )
  .argument('<cwd>', 'The project working directory this policy applies to.')
  .option(
    '--can-terminate <bool>',
    "true or false — allow seeya to terminate this project's live session after a successful handoff.",
  )
  .option(
    '--deep-capture <bool>',
    'true or false — use the deep --resume capture for this project instead of the lean default.',
  )
  .action(async (cwd: string, options: { canTerminate?: string; deepCapture?: string }) => {
    const context = buildConfigContext();
    console.log(
      await runConfigPolicyCommand(context, cwd, {
        // `exactOptionalPropertyTypes`: only set a key when commander actually parsed that flag.
        ...(options.canTerminate !== undefined ? { canTerminate: options.canTerminate } : {}),
        ...(options.deepCapture !== undefined ? { deepCapture: options.deepCapture } : {}),
      }),
    );
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`seeya: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
