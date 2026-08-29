import { describe, expect, it } from 'vitest';
import {
  extractPromptText,
  extractTouchedFiles,
  MAX_LAST_PROMPTS,
} from '../../../../src/adapters/transcript/facts.js';
import {
  userEntryTextSchema,
  assistantEntryToolUseSchema,
} from '../../../../src/adapters/transcript/schemas.js';

/**
 * Unit tests for the pure fact-extraction functions (S1-T4, docs/TESTES.md § Unidade: "a lógica
 * pura de `transcript/`"). No I/O — entries are built in memory and validated through the same
 * schemas `reader.ts` uses, so a test entry is exactly what the real streaming parser would hand
 * these functions.
 */
const BASE_USER_FIELDS = {
  type: 'user' as const,
  uuid: '11111111-1111-4111-8111-111111111111',
  parentUuid: null,
  isSidechain: false,
  sessionId: '66666666-6666-4666-8666-666666666666',
  cwd: '/code/example-project',
  timestamp: '2026-08-16T20:41:11.000Z',
};

function userEntry(
  content: string | ReadonlyArray<Record<string, unknown>>,
  overrides: { isSidechain?: boolean } = {},
) {
  const raw = {
    ...BASE_USER_FIELDS,
    isSidechain: overrides.isSidechain ?? false,
    message: { role: 'user', content },
  };
  return userEntryTextSchema.parse(raw);
}

const BASE_ASSISTANT_FIELDS = {
  type: 'assistant' as const,
  uuid: '22222222-2222-4222-8222-222222222222',
  parentUuid: '11111111-1111-4111-8111-111111111111',
  isSidechain: false,
  sessionId: '66666666-6666-4666-8666-666666666666',
  cwd: '/code/example-project',
  timestamp: '2026-08-16T20:41:12.000Z',
};

function assistantEntry(content: string | ReadonlyArray<Record<string, unknown>>) {
  const raw = { ...BASE_ASSISTANT_FIELDS, message: { role: 'assistant', content } };
  return assistantEntryToolUseSchema.parse(raw);
}

describe('extractPromptText', () => {
  it('joins the text of every text block in an array-shaped content', () => {
    const entry = userEntry([
      { type: 'text', text: 'First line.' },
      { type: 'text', text: 'Second line.' },
    ]);

    expect(extractPromptText(entry)).toBe('First line.\nSecond line.');
  });

  it('returns the trimmed string directly when content is a plain string', () => {
    const entry = userEntry('  Do the thing.  ');

    expect(extractPromptText(entry)).toBe('Do the thing.');
  });

  it('returns null when content has no text block at all (a synthetic tool-result turn)', () => {
    const entry = userEntry([{ type: 'tool_result', tool_use_id: 'abc', content: 'ok' }]);

    expect(extractPromptText(entry)).toBeNull();
  });

  it('returns null for a sub-agent turn even when it has real text', () => {
    const entry = userEntry([{ type: 'text', text: 'A sub-agent prompt.' }], {
      isSidechain: true,
    });

    expect(extractPromptText(entry)).toBeNull();
  });

  it('returns null for a whitespace-only string prompt', () => {
    const entry = userEntry('   ');

    expect(extractPromptText(entry)).toBeNull();
  });
});

describe('extractTouchedFiles', () => {
  it('collects the file_path of Edit, Write and NotebookEdit tool_use blocks', () => {
    const entry = assistantEntry([
      { type: 'text', text: 'Working on it.' },
      { type: 'tool_use', name: 'Edit', input: { file_path: '/code/example-project/a.ts' } },
      { type: 'tool_use', name: 'Write', input: { file_path: '/code/example-project/b.ts' } },
      {
        type: 'tool_use',
        name: 'NotebookEdit',
        input: { file_path: '/code/example-project/c.ipynb' },
      },
    ]);

    expect(extractTouchedFiles(entry)).toEqual([
      '/code/example-project/a.ts',
      '/code/example-project/b.ts',
      '/code/example-project/c.ipynb',
    ]);
  });

  it('excludes read-only tools (Read, Grep, Bash) — they do not "touch" a file', () => {
    const entry = assistantEntry([
      { type: 'tool_use', name: 'Read', input: { file_path: '/code/example-project/a.ts' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
    ]);

    expect(extractTouchedFiles(entry)).toEqual([]);
  });

  it('returns an empty list for a plain-string content (no tool call possible)', () => {
    const entry = assistantEntry('Just talking, no tool use.');

    expect(extractTouchedFiles(entry)).toEqual([]);
  });
});

describe('MAX_LAST_PROMPTS', () => {
  it('is a positive, finite bound', () => {
    expect(MAX_LAST_PROMPTS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_LAST_PROMPTS)).toBe(true);
  });
});
