/**
 * Shared support for the contract suite (docs/TESTES.md § "Contrato"). Runs against this
 * machine's REAL `~/.claude` and the REAL `claude` binary on the PATH — that's why only this
 * folder may touch these things; no other test in the project may (unit/integration use doubles
 * and `tmpdir`).
 *
 * Golden rule from CLAUDE.md: if something here diverges from reality, the answer is to log it in
 * docs/QUESTOES.md with the raw output observed — never loosen the assertion to make the test
 * pass.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** This machine's real `~/.claude` root. Only used inside tests/contract/. */
export function realClaudeRoot(): string {
  return join(homedir(), '.claude');
}

/**
 * Runs `claude` with an array of arguments, `shell: false` (same process rule that applies to
 * the product — CLAUDE.md § Processos). Only use this here with cheap, local subcommands
 * (`--help`, `--version`, `agents --json`): no test in this project may call the real API.
 */
export function runClaude(args: readonly string[]): {
  exitCode: number | null;
  output: string;
  error: string;
} {
  const result = spawnSync('claude', args, {
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
  });

  if (result.error) {
    throw new Error(
      `Could not run \`claude ${args.join(' ')}\`. The contract suite requires the \`claude\` ` +
        `binary on this machine's PATH. Original error: ${result.error.message}`,
    );
  }

  return {
    exitCode: result.status,
    output: result.stdout ?? '',
    error: result.stderr ?? '',
  };
}

/**
 * Claude Code version the contract suite is currently running against. docs/TESTES.md requires
 * logging this on every run — Spike D proved that 2.1.201 and 2.1.233 coexist on the same
 * machine (PATH CLI × VS Code extension) and behave differently, so "green contract" without the
 * version noted proves nothing.
 *
 * Called by each test file and embedded in the `describe` name — useful for knowing which
 * version a specific failure came from, or when running with `--reporter=verbose`. **This alone
 * does not guarantee visibility on the happy path**: vitest's default reporter doesn't print test
 * names when everything passes (measured by the S0-T5 review — that's what this comment used to
 * claim, incorrectly). The real guarantee comes from `tests/contract/_version-global-setup.ts`,
 * which writes the version straight to stdout before the suite runs, outside any reporter's
 * control.
 */
export function getClaudeCodeVersion(): string {
  const result = runClaude(['--version']);

  if (result.exitCode !== 0) {
    throw new Error(
      `\`claude --version\` exited with code ${String(result.exitCode)}. ` +
        `stdout: ${result.output} stderr: ${result.error}`,
    );
  }

  const version = result.output.trim();
  if (version.length === 0) {
    throw new Error('`claude --version` returned nothing on stdout.');
  }

  return version;
}

/**
 * Path of the `claude` binary resolved by this machine's PATH, used only by the test that needs
 * to inspect the binary directly (the existence of `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` isn't
 * exposed by any local command — neither `--help` nor `doctor` document it on purpose, it's an
 * internal mechanism found in Spike D by inspecting the binary).
 */
export function locateClaudeBinary(): string {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, ['claude'], { encoding: 'utf8', shell: false });

  if (result.status !== 0 || result.stdout.trim().length === 0) {
    throw new Error(
      `Could not locate the \`claude\` binary on the PATH via \`${command} claude\`. ` +
        `stdout: ${result.stdout} stderr: ${result.stderr}`,
    );
  }

  // `where` on Windows may list more than one path, one per line; the first is the one the
  // shell actually resolves and runs.
  const firstLine = result.stdout.trim().split(/\r?\n/)[0];
  if (firstLine === undefined) {
    throw new Error('`where`/`which claude` returned empty output after split.');
  }

  return firstLine;
}

/**
 * Reads the `claude` binary from disk as raw bytes and checks whether a text marker appears
 * literally in it. A fragile technique — it works for the packaged native executable (`claude
 * install`), which is what this machine has (confirmed: ~320 MB PE), but may find nothing if the
 * install is a thin shim (e.g. npm's `.cmd` pointing to a separate `.js`) whose real bundle lives
 * in another file. That's why the test that uses this reports the raw output instead of deciding
 * on its own what to do when it finds nothing — see
 * tests/contract/persistence-variable.test.ts.
 */
export function binaryContainsText(binaryPath: string, searchedText: string): boolean {
  const bytes = readFileSync(binaryPath);
  return bytes.includes(searchedText);
}
