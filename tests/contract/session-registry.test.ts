import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionRecordSchema } from '../../src/adapters/discovery/schemas.js';
import { getClaudeCodeVersion, realClaudeRoot } from './_support.js';

const version = getClaudeCodeVersion();

/**
 * docs/TESTES.md § Contrato, item 1: "The zod schema for `~/.claude/sessions/*.json` validates
 * this machine's real files." Doesn't run in standard CI — only via `npm run test:contrato`.
 */
describe(`contract: ~/.claude/sessions/*.json (claude ${version})`, () => {
  it('validates every real session-record file on this machine', () => {
    const sessionsFolder = join(realClaudeRoot(), 'sessions');
    const files = readdirSync(sessionsFolder).filter((name) => name.endsWith('.json'));

    expect(
      files.length,
      `No files in ${sessionsFolder}. The contract suite needs at least one session (alive or ` +
        'stale) registered to confirm the schema against reality — open a Claude Code session ' +
        'before running `npm run test:contrato`.',
    ).toBeGreaterThan(0);

    for (const file of files) {
      const path = join(sessionsFolder, file);
      const rawContent = readFileSync(path, 'utf8');

      let json: unknown;
      try {
        json = JSON.parse(rawContent);
      } catch (error) {
        throw new Error(
          `${path} is not valid JSON — raw output observed:\n${rawContent}\n\n` +
            `Error: ${String(error)}`,
        );
      }

      const result = sessionRecordSchema.safeParse(json);
      if (!result.success) {
        throw new Error(
          `sessionRecordSchema rejected the real record at ${path}. Reality changed — log it ` +
            `in docs/QUESTOES.md with this raw output, don't loosen the schema.\n\n` +
            `Observed content: ${rawContent}\n\n` +
            `zod errors: ${JSON.stringify(result.error.issues, null, 2)}`,
        );
      }
    }
  });
});
