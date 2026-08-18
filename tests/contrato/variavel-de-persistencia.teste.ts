import { describe, expect, it } from 'vitest';
import { binaryContainsText, locateClaudeBinary, getClaudeCodeVersion } from './_apoio.js';

const version = getClaudeCodeVersion();

/**
 * docs/TESTES.md § Contrato, item 5: "`CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` is still
 * recognized by the installed version." D-017 and D-018 depend on this variable to fix the
 * transcript suppression (Spike D). No local command documents the variable — neither `--help`
 * nor `doctor` expose it on purpose, it's an internal mechanism. The only way without touching
 * the network is the same one used in Spike D: search for the literal text in the installed
 * binary. Doesn't run in standard CI — only via `npm run test:contrato`.
 */
describe(`contrato: CLAUDE_CODE_FORCE_SESSION_PERSISTENCE (claude ${version})`, () => {
  it('the claude binary on the PATH recognizes the environment variable', () => {
    const binaryPath = locateClaudeBinary();
    const found = binaryContainsText(binaryPath, 'CLAUDE_CODE_FORCE_SESSION_PERSISTENCE');

    expect(
      found,
      `The binary at ${binaryPath} (claude ${version}) doesn't contain the literal text ` +
        '"CLAUDE_CODE_FORCE_SESSION_PERSISTENCE". Either the variable changed name/mechanism ' +
        'between versions, or this binary is a thin shim that doesn\'t contain the real bundle ' +
        '(see the comment in tests/contrato/_apoio.ts). Log it in docs/QUESTOES.md with the ' +
        'path and the result observed before changing D-017/D-018.',
    ).toBe(true);
  });
});
