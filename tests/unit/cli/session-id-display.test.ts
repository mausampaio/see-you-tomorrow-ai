import { describe, expect, it } from 'vitest';
import { computeDisplaySessionIds } from '../../../src/cli/session-id-display.js';

describe('computeDisplaySessionIds', () => {
  it("assigns the first 8 characters (the UUID's first group) when there is no collision", () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

    const result = computeDisplaySessionIds(ids);

    expect(result.get(ids[0]!)).toBe('11111111');
    expect(result.get(ids[1]!)).toBe('22222222');
  });

  it('every session in the batch gets an entry, including a batch of one', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const result = computeDisplaySessionIds([id]);
    expect(result.get(id)).toBe('33333333');
  });

  it('an empty batch produces an empty map', () => {
    expect(computeDisplaySessionIds([]).size).toBe(0);
  });

  /**
   * The case S3-T5 exists for: two sessions with the same `cwd` (already covered by
   * `session-view.test.ts`'s own "two sessions, one cwd" case) still need DISTINCT ids — this is
   * the unit-level proof that a first-group collision is handled, not ignored, by escalating only
   * the colliding pair to the next UUID group boundary.
   */
  it('escalates to the next UUID group boundary for ids that collide at 8 characters', () => {
    const colliding = [
      '88888888-1111-4111-8111-111111111111',
      '88888888-2222-4222-8222-222222222222',
    ];

    const result = computeDisplaySessionIds(colliding);

    const first = result.get(colliding[0]!);
    const second = result.get(colliding[1]!);
    expect(first).toBe('88888888-1111');
    expect(second).toBe('88888888-2222');
    expect(first).not.toBe(second);
  });

  it('escalates past the second boundary to the third for ids identical through the second', () => {
    // Identical through length 13 ("88888888-1111"), first differing character at position 17
    // (inside the third group) — so length 13 still collides, and length 18 is the first
    // boundary where these two actually differ.
    const a = '88888888-1111-4888-8111-111111111111';
    const b = '88888888-1111-4844-8222-222222222222';
    const distinct = '44444444-0000-4000-8000-000000000000';

    const result = computeDisplaySessionIds([a, b, distinct]);

    expect(result.get(a)).toBe('88888888-1111-4888');
    expect(result.get(b)).toBe('88888888-1111-4844');
    // The unrelated third id was never involved in that escalation and keeps its short,
    // 8-character prefix — collision handling is scoped to the ids that actually collide.
    expect(result.get(distinct)).toBe('44444444');
  });

  /**
   * A real `sessionId` is always exactly 36 characters, so two DISTINCT UUIDs can never still
   * collide at the last boundary (36) — this only exercises the defensive floor with malformed,
   * longer-than-a-UUID values that happen to share their first 36 characters. It matters anyway
   * (D-025's spirit, applied to code instead of data): the function must not silently conflate
   * two different sessionIds just because every boundary it knows about ran out.
   */
  it('falls back to the full string for entries that still collide after the last boundary', () => {
    const a = `${'1'.repeat(36)}-extra-a`;
    const b = `${'1'.repeat(36)}-extra-b`;

    const result = computeDisplaySessionIds([a, b]);

    expect(result.get(a)).toBe(a);
    expect(result.get(b)).toBe(b);
    expect(result.get(a)).not.toBe(result.get(b));
  });

  it('an exact duplicate sessionId (same string twice) still yields exactly one map entry', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const result = computeDisplaySessionIds([id, id]);
    expect(result.size).toBe(1);
    expect(result.get(id)).toBe('44444444');
  });
});
