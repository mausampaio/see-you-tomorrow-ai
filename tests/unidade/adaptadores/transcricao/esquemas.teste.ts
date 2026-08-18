import { describe, expect, it } from 'vitest';
import {
  assistantEntrySchema,
  userEntrySchema,
  KNOWN_ENTRY_TYPES,
} from '../../../../src/adaptadores/transcricao/esquemas.js';

/**
 * Unit tests for the transcript schemas (S0-T5). Synthetic fixtures shaped after what's observed
 * in this machine's real `.jsonl` files, but with generic uuids and path — confirming against
 * the real file is tests/contrato/transcript.teste.ts's job.
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
