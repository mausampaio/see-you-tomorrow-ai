import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assistantEntrySchema, userEntrySchema } from '../../src/adapters/transcript/schemas.js';
import { getClaudeCodeVersion, realClaudeRoot } from './_apoio.js';

const version = getClaudeCodeVersion();

/** Recursively scans `~/.claude/projects/**​/*.jsonl`, without relying on any project parser. */
function listRealTranscripts(): string[] {
  const projectsRoot = join(realClaudeRoot(), 'projects');
  const result: string[] = [];

  const visit = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      const info = statSync(path);
      if (info.isDirectory()) {
        visit(path);
      } else if (name.endsWith('.jsonl')) {
        result.push(path);
      }
    }
  };

  visit(projectsRoot);
  return result;
}

/**
 * docs/TESTES.md § Contrato, item 2: "The real `.jsonl` has `user` and `assistant` entries with
 * the fields the parser uses." Doesn't run in standard CI — only via `npm run test:contrato`.
 */
describe(`contrato: real transcript .jsonl (claude ${version})`, () => {
  it('finds and validates real user and assistant entries in at least one transcript', () => {
    const transcripts = listRealTranscripts();

    expect(
      transcripts.length,
      `No .jsonl in ${join(realClaudeRoot(), 'projects')}. The contract suite needs at least ` +
        'one real transcript to confirm the schema — use Claude Code normally before running ' +
        '`npm run test:contrato`.',
    ).toBeGreaterThan(0);

    let totalUser = 0;
    let totalAssistant = 0;

    for (const path of transcripts) {
      const lines = readFileSync(path, 'utf8').split('\n');

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) {
          continue;
        }

        let entry: unknown;
        try {
          entry = JSON.parse(trimmedLine);
        } catch {
          // Truncated line (Claude Code may be writing). The contract only validates the types
          // it knows; an unreadable line is the real parser's (S1-T4) concern, not this test's.
          continue;
        }

        if (typeof entry !== 'object' || entry === null || !('type' in entry)) {
          continue;
        }

        const type = entry.type;

        if (type === 'user') {
          const result = userEntrySchema.safeParse(entry);
          if (!result.success) {
            throw new Error(
              `userEntrySchema rejected a real "user" entry in ${path}. Reality changed — log ` +
                `it in docs/QUESTOES.md with this raw output, don't loosen the schema.` +
                `\n\nObserved content: ${trimmedLine}\n\n` +
                `zod errors: ${JSON.stringify(result.error.issues, null, 2)}`,
            );
          }
          totalUser += 1;
        } else if (type === 'assistant') {
          const result = assistantEntrySchema.safeParse(entry);
          if (!result.success) {
            throw new Error(
              `assistantEntrySchema rejected a real "assistant" entry in ${path}. Reality ` +
                "changed — log it in docs/QUESTOES.md with this raw output, don't loosen the " +
                `schema.\n\nObserved content: ${trimmedLine}\n\n` +
                `zod errors: ${JSON.stringify(result.error.issues, null, 2)}`,
            );
          }
          totalAssistant += 1;
        }
        // Type outside "user"/"assistant": ignored on purpose, exactly the tolerant behavior
        // wanted (docs/ARQUITETURA.md § transcript/).
      }
    }

    expect(
      totalUser,
      'No real "user" entry found in any transcript — can\'t confirm the schema against reality.',
    ).toBeGreaterThan(0);
    expect(
      totalAssistant,
      'No real "assistant" entry found in any transcript — can\'t confirm the schema against ' +
        'reality.',
    ).toBeGreaterThan(0);
  });
});
