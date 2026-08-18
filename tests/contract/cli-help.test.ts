import { describe, expect, it } from 'vitest';
import { runClaude, getClaudeCodeVersion } from './_support.js';

const version = getClaudeCodeVersion();
const helpOutput = runClaude(['--help']).output;

/**
 * docs/TESTES.md § Contrato, item 3: "`claude --help` still exposes `--resume`,
 * `--fork-session`, `-p`, `--output-format`, `--model`, `--max-budget-usd`,
 * `--no-session-persistence`." The PO's task expanded the list with `--tools`,
 * `--system-prompt` and `--json-schema` — the three also cited in D-011 as part of how the lean
 * capture tames the output. `claude --help` is a local command, it doesn't touch the network.
 * Doesn't run in standard CI — only via `npm run test:contrato`.
 */
describe(`contract: claude --help (claude ${version})`, () => {
  const flagsRequiredByTheProduct = [
    '--resume',
    '--fork-session',
    '-p',
    '--output-format',
    '--model',
    '--max-budget-usd',
    '--no-session-persistence',
    '--tools',
    '--system-prompt',
    '--json-schema',
  ];

  it.each(flagsRequiredByTheProduct)('exposes the flag %s', (flag) => {
    expect(
      helpOutput,
      `\`claude --help\` doesn't mention "${flag}". Raw output observed:\n${helpOutput}`,
    ).toContain(flag);
  });
});
