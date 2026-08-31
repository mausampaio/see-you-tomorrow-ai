import { describe, expect, it } from 'vitest';
import {
  assistantEntrySchema,
  userEntrySchema,
  userEntryTextSchema,
  assistantEntryWithContentSchema,
  entryTypeSchema,
  KNOWN_ENTRY_TYPES,
  KNOWN_ENTRY_TYPE_SET,
} from '../../../../src/adapters/transcript/schemas.js';

/**
 * Unit tests for the transcript schemas (S0-T5). Synthetic fixtures shaped after what's observed
 * in this machine's real `.jsonl` files, but with generic uuids and path — confirming against
 * the real file is tests/contract/transcript.test.ts's job.
 */
describe('userEntrySchema', () => {
  const validEntry = {
    parentUuid: null,
    isSidechain: false,
    promptId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    type: 'user' as const,
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Do X' }],
    },
    uuid: '11111111-2222-4333-8444-555555555555',
    timestamp: '2026-08-16T20:41:11.000Z',
    sessionId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
    cwd: 'c:\\code\\projeto',
    entrypoint: 'cli',
    gitBranch: 'main',
    version: '2.1.233',
  };

  it('accepts a real entry with content as an array and drops unused fields', () => {
    const result = userEntrySchema.parse(validEntry);

    expect(result.type).toBe('user');
    expect(result.parentUuid).toBeNull();
    expect(result).not.toHaveProperty('gitBranch');
    expect(result).not.toHaveProperty('promptId');
  });

  it('accepts content as a plain string (a form observed less frequently)', () => {
    const result = userEntrySchema.parse({
      ...validEntry,
      message: { role: 'user', content: 'plain text' },
    });

    expect(result.message.content).toBe('plain text');
  });

  it('accepts a non-null parentUuid, chaining to another entry', () => {
    const result = userEntrySchema.parse({
      ...validEntry,
      parentUuid: '88888888-8888-4888-8888-888888888888',
    });

    expect(result.parentUuid).toBe('88888888-8888-4888-8888-888888888888');
  });

  it('rejects a type other than "user"', () => {
    const result = userEntrySchema.safeParse({ ...validEntry, type: 'assistant' });

    expect(result.success).toBe(false);
  });

  it('rejects a malformed uuid', () => {
    const result = userEntrySchema.safeParse({ ...validEntry, uuid: 'not-a-uuid' });

    expect(result.success).toBe(false);
  });

  it('rejects a content block without "type"', () => {
    const result = userEntrySchema.safeParse({
      ...validEntry,
      message: { role: 'user', content: [{ text: 'no type' }] },
    });

    expect(result.success).toBe(false);
  });
});

describe('assistantEntrySchema', () => {
  const validEntry = {
    parentUuid: '11111111-2222-4333-8444-555555555555',
    isSidechain: false,
    type: 'assistant' as const,
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '...' },
        { type: 'text', text: 'answer' },
        { type: 'tool_use', name: 'Read', input: {} },
      ],
      id: 'msg_123',
      model: 'claude-sonnet-5',
    },
    uuid: '22222222-3333-4444-8555-666666666666',
    timestamp: '2026-08-16T20:41:12.000Z',
    sessionId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
    cwd: 'c:\\code\\projeto',
    requestId: 'req_abc',
    effort: 'medium',
  };

  it('accepts a real assistant entry, with no promptId, and drops what is unused', () => {
    const result = assistantEntrySchema.parse(validEntry);

    expect(result.type).toBe('assistant');
    expect(result).not.toHaveProperty('requestId');
    expect(result).not.toHaveProperty('effort');
  });

  it('rejects an entry without sessionId', () => {
    const withoutSessionId: Record<string, unknown> = { ...validEntry };
    delete withoutSessionId['sessionId'];
    const result = assistantEntrySchema.safeParse(withoutSessionId);

    expect(result.success).toBe(false);
  });

  it('rejects a timestamp outside the ISO-with-milliseconds format', () => {
    const result = assistantEntrySchema.safeParse({
      ...validEntry,
      timestamp: '2026-08-16T20:41:12+00:00',
    });

    expect(result.success).toBe(false);
  });
});

describe('KNOWN_ENTRY_TYPES', () => {
  it('lists the twelve types observed on the real machine, including user and assistant', () => {
    expect(KNOWN_ENTRY_TYPES).toHaveLength(12);
    expect(KNOWN_ENTRY_TYPES).toContain('user');
    expect(KNOWN_ENTRY_TYPES).toContain('assistant');
  });
});

describe('KNOWN_ENTRY_TYPE_SET (S1-T4)', () => {
  it('has the exact same membership as the KNOWN_ENTRY_TYPES tuple', () => {
    expect(KNOWN_ENTRY_TYPE_SET.size).toBe(KNOWN_ENTRY_TYPES.length);
    for (const type of KNOWN_ENTRY_TYPES) {
      expect(KNOWN_ENTRY_TYPE_SET.has(type)).toBe(true);
    }
  });

  it('does not contain a type that was never observed', () => {
    expect(KNOWN_ENTRY_TYPE_SET.has('some-future-type')).toBe(false);
  });
});

describe('entryTypeSchema (S1-T4)', () => {
  it('accepts any object with a non-empty string type, ignoring the rest', () => {
    const result = entryTypeSchema.safeParse({ type: 'anything-at-all', extra: 123 });

    expect(result.success).toBe(true);
  });

  it('rejects a value with no type field', () => {
    expect(entryTypeSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-object line (e.g. a bare number or null)', () => {
    expect(entryTypeSchema.safeParse(42).success).toBe(false);
    expect(entryTypeSchema.safeParse(null).success).toBe(false);
  });
});

describe('userEntryTextSchema (S1-T4)', () => {
  const validEntry = {
    parentUuid: null,
    isSidechain: false,
    type: 'user' as const,
    message: { role: 'user', content: [{ type: 'text', text: 'Do X' }] },
    uuid: '11111111-1111-4111-8111-111111111111',
    timestamp: '2026-08-16T20:41:11.000Z',
    sessionId: '66666666-6666-4666-8666-666666666666',
    cwd: '/code/example-project',
  };

  it('keeps the text field a plain contentBlockSchema parse would have stripped', () => {
    const result = userEntryTextSchema.parse(validEntry);

    expect(result.message.content).toEqual([{ type: 'text', text: 'Do X' }]);
  });

  it('still accepts a non-text block, generically, alongside a text block', () => {
    const result = userEntryTextSchema.parse({
      ...validEntry,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'x' },
          { type: 'text', text: 'Do X' },
        ],
      },
    });

    expect(result.message.content).toEqual([
      { type: 'tool_result' },
      { type: 'text', text: 'Do X' },
    ]);
  });

  it('still rejects what userEntrySchema already rejected (malformed uuid)', () => {
    const result = userEntryTextSchema.safeParse({ ...validEntry, uuid: 'not-a-uuid' });

    expect(result.success).toBe(false);
  });
});

describe('assistantEntryWithContentSchema (S1-T4, extended S4-T00c/Q-036 for text)', () => {
  const validEntry = {
    parentUuid: '11111111-1111-4111-8111-111111111111',
    isSidechain: false,
    type: 'assistant' as const,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/code/example/a.ts' } }],
    },
    uuid: '22222222-2222-4222-8222-222222222222',
    timestamp: '2026-08-16T20:41:12.000Z',
    sessionId: '66666666-6666-4666-8666-666666666666',
    cwd: '/code/example-project',
  };

  it('keeps name and input.file_path for a write-tool tool_use block', () => {
    const result = assistantEntryWithContentSchema.parse(validEntry);

    expect(result.message.content).toEqual([
      { type: 'tool_use', name: 'Edit', input: { file_path: '/code/example/a.ts' } },
    ]);
  });

  it('falls back to the generic {type} shape for a tool_use whose name is not a write tool', () => {
    const result = assistantEntryWithContentSchema.parse({
      ...validEntry,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/code/example/a.ts' } }],
      },
    });

    expect(result.message.content).toEqual([{ type: 'tool_use' }]);
  });

  it('keeps the text field a plain contentBlockSchema parse would have stripped (S4-T00c)', () => {
    const result = assistantEntryWithContentSchema.parse({
      ...validEntry,
      message: { role: 'assistant', content: [{ type: 'text', text: '4 done, 6 pending' }] },
    });

    expect(result.message.content).toEqual([{ type: 'text', text: '4 done, 6 pending' }]);
  });

  it('keeps both a text block and a write tool_use block from the same entry', () => {
    const result = assistantEntryWithContentSchema.parse({
      ...validEntry,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'updated the parser' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/code/example/a.ts' } },
        ],
      },
    });

    expect(result.message.content).toEqual([
      { type: 'text', text: 'updated the parser' },
      { type: 'tool_use', name: 'Edit', input: { file_path: '/code/example/a.ts' } },
    ]);
  });
});
