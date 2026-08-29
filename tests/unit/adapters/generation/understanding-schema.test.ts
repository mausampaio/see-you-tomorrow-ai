import { describe, expect, it } from 'vitest';
import {
  generatedUnderstandingContentSchema,
  UNDERSTANDING_JSON_SCHEMA,
} from '../../../../src/adapters/generation/understanding-schema.js';

describe('generatedUnderstandingContentSchema', () => {
  const valid = {
    understanding: 'Working on the generator.',
    pendingItems: ['write tests'],
    tomorrowPlan: ['ship it'],
  };

  it('accepts the expected shape, empty arrays included', () => {
    expect(generatedUnderstandingContentSchema.safeParse(valid).success).toBe(true);
    expect(
      generatedUnderstandingContentSchema.safeParse({
        ...valid,
        pendingItems: [],
        tomorrowPlan: [],
      }).success,
    ).toBe(true);
  });

  it('rejects a missing required field', () => {
    const withoutUnderstanding: Partial<typeof valid> = { ...valid };
    delete withoutUnderstanding.understanding;
    expect(generatedUnderstandingContentSchema.safeParse(withoutUnderstanding).success).toBe(false);
  });

  it('rejects a pendingItems entry that is not a string', () => {
    const result = generatedUnderstandingContentSchema.safeParse({ ...valid, pendingItems: [1] });
    expect(result.success).toBe(false);
  });
});

describe('UNDERSTANDING_JSON_SCHEMA', () => {
  it('is a JSON string matching the fields the zod schema validates', () => {
    const parsed = JSON.parse(UNDERSTANDING_JSON_SCHEMA) as Record<string, unknown>;
    expect(parsed['type']).toBe('object');
    expect(Object.keys(parsed['properties'] as object).sort()).toStrictEqual([
      'pendingItems',
      'tomorrowPlan',
      'understanding',
    ]);
    expect(parsed['required']).toStrictEqual(
      expect.arrayContaining(['understanding', 'pendingItems', 'tomorrowPlan']),
    );
  });

  it('has no $schema meta key — confirmed real call used a schema without one', () => {
    const parsed = JSON.parse(UNDERSTANDING_JSON_SCHEMA) as Record<string, unknown>;
    expect(parsed['$schema']).toBeUndefined();
  });
});
