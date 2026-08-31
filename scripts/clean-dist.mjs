#!/usr/bin/env node
// Removes `dist/` before `tsc` runs (S3-T7, docs/PLANO-DE-ENTREGA.md). `tsc -p
// tsconfig.build.json` only ever writes and overwrites; it never deletes a file that no longer
// has a corresponding source. When a directory gets renamed — as happened when this project's
// source moved to English — the old output (`dist/adaptadores`, `dist/aplicacao`, `dist/nucleo`,
// `dist/agendador`) keeps sitting next to the new one, invisible unless someone opens `dist/` by
// hand. That happened here for two weeks before anyone noticed.
//
// This is more than tidiness: `package.json`'s `files` field is `["dist"]`, so `npm publish`
// packages whatever is actually in that directory — stale output in the old language would ship
// in a package meant to be read by strangers.
//
// Plain `node:fs`, not a new dependency: this project has exactly two production dependencies
// (`commander`, `zod`) and AGENTS.md § "Dependências" is explicit that a new one needs asking
// first. `rmSync(..., { recursive: true, force: true })` works identically on Windows, macOS and
// Linux — no shell, no `rm -rf` (which isn't a thing on Windows), no dependency at all. `force:
// true` makes a first build (no `dist/` yet) a no-op instead of an ENOENT crash — this script's
// job is "make sure dist/ doesn't exist yet", and an absent directory already satisfies that.
//
// A standalone script rather than an inline `package.json` command for the same reason
// `verificar-linux.mjs` is one: `rm -rf` has no single cross-platform shell equivalent, and typing
// the wrong one (`rimraf`-as-a-dependency, or a `rd /s /q` that only works in cmd.exe) is exactly
// the kind of platform assumption this project has been burned by before (docs/DECISOES.md D-015,
// Spike C: PowerShell silently mangling something that worked fine as a plain array/API call).
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'dist');

rmSync(distDir, { recursive: true, force: true });
