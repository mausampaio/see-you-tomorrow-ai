import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  parseConfigDocument,
} from '../../../../src/adapters/storage/config-schema.js';

describe('parseConfigDocument', () => {
  it('returns every default when the document has no fields at all', () => {
    expect(parseConfigDocument({})).toEqual(DEFAULT_CONFIG);
  });

  it('keeps unspecified fields at their default while honoring the ones that are present', () => {
    const result = parseConfigDocument({ relevanceHours: 6, ignore: ['c:\\code\\draft'] });
    expect(result.relevanceHours).toBe(6);
    expect(result.ignore).toEqual(['c:\\code\\draft']);
    expect(result.idleMinutes).toBe(DEFAULT_CONFIG.idleMinutes);
    expect(result.captureModel).toBe(DEFAULT_CONFIG.captureModel);
    expect(result.leadTimesInMinutes).toEqual(DEFAULT_CONFIG.leadTimesInMinutes);
  });

  it('resolves projectPolicy per-project defaults (canTerminate/deepCapture both default false)', () => {
    const result = parseConfigDocument({
      projectPolicy: { 'c:\\code\\projeto': { canTerminate: true } },
    });
    expect(result.projectPolicy).toEqual({
      'c:\\code\\projeto': { canTerminate: true, deepCapture: false },
    });
  });

  it('accepts a fully-specified project policy unchanged', () => {
    const result = parseConfigDocument({
      projectPolicy: { 'c:\\code\\projeto': { canTerminate: true, deepCapture: true } },
    });
    expect(result.projectPolicy).toEqual({
      'c:\\code\\projeto': { canTerminate: true, deepCapture: true },
    });
  });

  it('accepts endOfDayTime: null (manual-only) explicitly', () => {
    expect(parseConfigDocument({ endOfDayTime: null }).endOfDayTime).toBeNull();
  });

  it('accepts a well-formed endOfDayTime', () => {
    expect(parseConfigDocument({ endOfDayTime: '19:30' }).endOfDayTime).toBe('19:30');
  });

  it('ignores unknown top-level keys without failing (tolerant of the unfamiliar, like every other schema in this project)', () => {
    expect(() => parseConfigDocument({ somethingFuture: 'x' })).not.toThrow();
    expect(parseConfigDocument({ somethingFuture: 'x' })).toEqual(DEFAULT_CONFIG);
  });

  it.each([
    ['relevanceHours as a string', { relevanceHours: '12' }],
    ['endOfDayTime not matching "HH:MM"', { endOfDayTime: '25:99' }],
    ['endOfDayTime missing the leading zero', { endOfDayTime: '9:30' }],
    ['leadTimesInMinutes with a non-number entry', { leadTimesInMinutes: [30, 'x'] }],
    ['captureConcurrency as zero', { captureConcurrency: 0 }],
    ['captureConcurrency as a negative number', { captureConcurrency: -1 }],
    ['relevanceHours as zero', { relevanceHours: 0 }],
    ['projectPolicy value not an object', { projectPolicy: { 'c:\\x': 'not-an-object' } }],
    ['captureModel as an empty string', { captureModel: '' }],
    ['maxGitRootsToVisit as zero', { maxGitRootsToVisit: 0 }],
    ['maxGitRootsToVisit as a non-integer', { maxGitRootsToVisit: 1.5 }],
    ['maxCaptureAttemptsPerSessionPerDay as zero', { maxCaptureAttemptsPerSessionPerDay: 0 }],
    ['maxBriefingScanDays as negative', { maxBriefingScanDays: -1 }],
    ['overdueFireThresholdMinutes as negative', { overdueFireThresholdMinutes: -1 }],
    ['overdueFireThresholdMinutes as a string', { overdueFireThresholdMinutes: '5' }],
  ])('throws a visible error on %s, never silently falling back to defaults', (_label, raw) => {
    expect(() => parseConfigDocument(raw)).toThrow();
  });
});

describe('parseConfigDocument — D-035 four config numbers (each defaults to the prior constant)', () => {
  it('defaults every one when the document says nothing about them', () => {
    const result = parseConfigDocument({});
    expect(result.maxGitRootsToVisit).toBe(8);
    expect(result.maxCaptureAttemptsPerSessionPerDay).toBe(3);
    expect(result.maxBriefingScanDays).toBe(30);
    expect(result.overdueFireThresholdMinutes).toBe(5);
  });

  it('honors each one explicitly, independent of the others', () => {
    const result = parseConfigDocument({
      maxGitRootsToVisit: 20,
      maxCaptureAttemptsPerSessionPerDay: 1,
      maxBriefingScanDays: 0,
      overdueFireThresholdMinutes: 2.5,
    });
    expect(result.maxGitRootsToVisit).toBe(20);
    expect(result.maxCaptureAttemptsPerSessionPerDay).toBe(1);
    expect(result.maxBriefingScanDays).toBe(0);
    expect(result.overdueFireThresholdMinutes).toBe(2.5);
  });

  it('maxBriefingScanDays: 0 ("only look at today") is accepted, not rejected as degenerate', () => {
    expect(() => parseConfigDocument({ maxBriefingScanDays: 0 })).not.toThrow();
  });
});
