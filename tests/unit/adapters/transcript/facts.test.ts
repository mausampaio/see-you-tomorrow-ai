import { describe, expect, it } from 'vitest';
import {
  extractPromptText,
  extractAssistantMessageText,
  extractTouchedFiles,
  MAX_LAST_PROMPTS,
  MAX_ASSISTANT_MESSAGES,
  MAX_ASSISTANT_MESSAGE_CHARS,
} from '../../../../src/adapters/transcript/facts.js';
import {
  userEntryTextSchema,
  assistantEntryWithContentSchema,
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

function assistantEntry(
  content: string | ReadonlyArray<Record<string, unknown>>,
  overrides: { isSidechain?: boolean } = {},
) {
  const raw = {
    ...BASE_ASSISTANT_FIELDS,
    isSidechain: overrides.isSidechain ?? false,
    message: { role: 'assistant', content },
  };
  return assistantEntryWithContentSchema.parse(raw);
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

// S4-T00c/Q-036: this is the defect the D-011 reevaluation found — before this function existed,
// nothing in adapters/transcript/ ever read the text of an assistant entry at all.
describe('extractAssistantMessageText', () => {
  it('joins the text of every text block, same as extractPromptText', () => {
    const entry = assistantEntry([
      { type: 'text', text: 'First, I did X.' },
      { type: 'text', text: 'Then Y.' },
    ]);

    expect(extractAssistantMessageText(entry)).toBe('First, I did X.\nThen Y.');
  });

  it('reads the text alongside a tool_use block in the same entry (a real mixed turn)', () => {
    const entry = assistantEntry([
      { type: 'text', text: '4 of 10 tasks are done; 6 remain.' },
      { type: 'tool_use', name: 'Edit', input: { file_path: '/code/example-project/a.ts' } },
    ]);

    expect(extractAssistantMessageText(entry)).toBe('4 of 10 tasks are done; 6 remain.');
  });

  it('returns null for a pure tool-use entry with no text block at all', () => {
    const entry = assistantEntry([
      { type: 'tool_use', name: 'Edit', input: { file_path: '/code/example-project/a.ts' } },
    ]);

    expect(extractAssistantMessageText(entry)).toBeNull();
  });

  it('returns null for a sub-agent turn, even with real text — internal narration, not said to the user', () => {
    const entry = assistantEntry([{ type: 'text', text: 'Subagent internal note.' }], {
      isSidechain: true,
    });

    expect(extractAssistantMessageText(entry)).toBeNull();
  });

  it('returns the trimmed string directly when content is a plain string', () => {
    const entry = assistantEntry('  Working on it.  ');

    expect(extractAssistantMessageText(entry)).toBe('Working on it.');
  });

  it(`truncates a message longer than MAX_ASSISTANT_MESSAGE_CHARS (${String(MAX_ASSISTANT_MESSAGE_CHARS)})`, () => {
    const long = 'x'.repeat(MAX_ASSISTANT_MESSAGE_CHARS + 200);
    const entry = assistantEntry([{ type: 'text', text: long }]);

    const result = extractAssistantMessageText(entry);
    expect(result).not.toBeNull();
    expect(result?.startsWith('x'.repeat(MAX_ASSISTANT_MESSAGE_CHARS))).toBe(true);
    expect(result?.length).toBeLessThan(long.length);
  });

  it('does not truncate a message at or under the cap', () => {
    const exact = 'y'.repeat(MAX_ASSISTANT_MESSAGE_CHARS);
    const entry = assistantEntry([{ type: 'text', text: exact }]);

    expect(extractAssistantMessageText(entry)).toBe(exact);
  });
});

describe('MAX_ASSISTANT_MESSAGES / MAX_ASSISTANT_MESSAGE_CHARS', () => {
  it('are positive, finite bounds', () => {
    expect(MAX_ASSISTANT_MESSAGES).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_ASSISTANT_MESSAGES)).toBe(true);
    expect(MAX_ASSISTANT_MESSAGE_CHARS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_ASSISTANT_MESSAGE_CHARS)).toBe(true);
  });
});
