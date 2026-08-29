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
import { Command } from 'commander';
import { z } from 'zod';
import packageJson from '../../package.json' with { type: 'json' };
import { buildCliContext } from './composition.js';
import { runSessionsCommand } from './sessions-command.js';
import { runStatusCommand } from './status-command.js';

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
    'Show the configured end-of-day time and how many discovered sessions are currently eligible for it.',
  )
  .action(async () => {
    const context = await buildCliContext();
    console.log(await runStatusCommand(context));
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`seeya: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
