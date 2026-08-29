import { describe, expect, it } from 'vitest';
import {
  EARLY_WARNING_SCHEMA_VERSION,
  parseEarlyWarningDocument,
  serializeEarlyWarningState,
} from '../../../../src/adapters/storage/early-warning-schema.js';

describe('parseEarlyWarningDocument', () => {
  it('returns both sets empty when the document has no fields at all', () => {
    const state = parseEarlyWarningDocument({});
    expect(state.notifiedMissingTranscriptSessionIds.size).toBe(0);
    expect(state.notifiedUninspectableSessionKeys.size).toBe(0);
  });

  it('parses a fully-specified document into the matching sets', () => {
    const state = parseEarlyWarningDocument({
      notifiedMissingTranscriptSessionIds: ['a', 'b'],
      notifiedUninspectableSessionKeys: ['1.h.key'],
    });
    expect([...state.notifiedMissingTranscriptSessionIds]).toEqual(['a', 'b']);
    expect([...state.notifiedUninspectableSessionKeys]).toEqual(['1.h.key']);
  });

  it('ignores unknown top-level keys without failing (tolerant of the unfamiliar)', () => {
    expect(() => parseEarlyWarningDocument({ somethingFuture: 'x' })).not.toThrow();
  });

  it.each([
    ['notifiedMissingTranscriptSessionIds as a number', { notifiedMissingTranscriptSessionIds: 1 }],
    [
      'notifiedUninspectableSessionKeys with a non-string entry',
      { notifiedUninspectableSessionKeys: [42] },
    ],
    ['root not an object', 'not-an-object'],
  ])('throws a visible error on %s, never silently falling back to empty', (_label, raw) => {
    expect(() => parseEarlyWarningDocument(raw)).toThrow(/malformed/);
  });
});

describe('serializeEarlyWarningState', () => {
  it('round-trips through parseEarlyWarningDocument', () => {
    const state = {
      notifiedMissingTranscriptSessionIds: new Set(['a']),
      notifiedUninspectableSessionKeys: new Set(['1.h.key', '2.h.key']),
    };
    const reparsed = parseEarlyWarningDocument(serializeEarlyWarningState(state));
    expect([...reparsed.notifiedMissingTranscriptSessionIds]).toEqual(['a']);
    expect([...reparsed.notifiedUninspectableSessionKeys].sort()).toEqual(['1.h.key', '2.h.key']);
  });

  it('stamps the current schemaVersion', () => {
    const serialized = serializeEarlyWarningState({
      notifiedMissingTranscriptSessionIds: new Set(),
      notifiedUninspectableSessionKeys: new Set(),
    });
    expect(serialized['schemaVersion']).toBe(EARLY_WARNING_SCHEMA_VERSION);
  });
});
