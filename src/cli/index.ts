#!/usr/bin/env node
/**
 * Entry point for the `seeya` CLI. In this task (S0-T1) only `--version` exists — no other
 * business command is implemented here yet. See docs/PLANO-DE-ENTREGA.md.
 */
import { Command } from 'commander';
import { z } from 'zod';
import packageJson from '../../package.json' with { type: 'json' };

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

program.parse();
