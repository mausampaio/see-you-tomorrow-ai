import { describe, expect, it } from 'vitest';
import {
  applyConfigFieldUpdate,
  applyProjectPolicyUpdate,
  DEFAULT_CONFIG,
  EDITABLE_CONFIG_KEYS,
  formatConfigValue,
  isEditableConfigKey,
  parseConfigDocument,
  parseConfigFieldUpdate,
  serializeConfigDocument,
  unknownConfigKeyMessage,
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

describe('isEditableConfigKey / unknownConfigKeyMessage (S4-T4)', () => {
  it('accepts every key in EDITABLE_CONFIG_KEYS and rejects projectPolicy plus a made-up key', () => {
    for (const key of EDITABLE_CONFIG_KEYS) {
      expect(isEditableConfigKey(key)).toBe(true);
    }
    expect(isEditableConfigKey('projectPolicy')).toBe(false);
    expect(isEditableConfigKey('bogus')).toBe(false);
  });

  it('names the received key and the full expected set, plus the projectPolicy escape hatch', () => {
    const message = unknownConfigKeyMessage('bogus');
    expect(message).toContain('"bogus"');
    for (const key of EDITABLE_CONFIG_KEYS) {
      expect(message).toContain(key);
    }
    expect(message).toContain('seeya config policy');
  });
});

describe('parseConfigFieldUpdate (S4-T4)', () => {
  it('rejects an unknown key without ever constructing a value', () => {
    const result = parseConfigFieldUpdate('bogus', '5');
    expect(result).toEqual({ ok: false, error: unknownConfigKeyMessage('bogus') });
  });

  it('rejects projectPolicy through this path — it is not a scalar field', () => {
    const result = parseConfigFieldUpdate('projectPolicy', '{}');
    expect(result.ok).toBe(false);
  });

  it.each([
    ['relevanceHours', '6', 6],
    ['idleMinutes', '30', 30],
    ['budgetPerSessionUsd', '0.5', 0.5],
    ['captureConcurrency', '2', 2],
    ['forkCleanupDays', '10', 10],
    ['maxGitRootsToVisit', '4', 4],
    ['maxCaptureAttemptsPerSessionPerDay', '5', 5],
    ['maxBriefingScanDays', '0', 0],
    ['overdueFireThresholdMinutes', '2.5', 2.5],
    ['captureModel', 'opus', 'opus'],
  ])('coerces and validates a scalar field: %s', (key, raw, expected) => {
    const result = parseConfigFieldUpdate(key, raw);
    expect(result).toEqual({ ok: true, key, value: expected });
  });

  it('coerces a comma-separated list field (leadTimesInMinutes)', () => {
    const result = parseConfigFieldUpdate('leadTimesInMinutes', '30, 15');
    expect(result).toEqual({ ok: true, key: 'leadTimesInMinutes', value: [30, 15] });
  });

  it('an empty string clears a list field to []', () => {
    const result = parseConfigFieldUpdate('ignore', '');
    expect(result).toEqual({ ok: true, key: 'ignore', value: [] });
  });

  it('the literal "null" (any case) resolves endOfDayTime to null', () => {
    expect(parseConfigFieldUpdate('endOfDayTime', 'null')).toEqual({
      ok: true,
      key: 'endOfDayTime',
      value: null,
    });
    expect(parseConfigFieldUpdate('endOfDayTime', 'NULL')).toEqual({
      ok: true,
      key: 'endOfDayTime',
      value: null,
    });
  });

  it('a real "HH:MM" value for endOfDayTime is accepted (the permitted case next to the null one above)', () => {
    expect(parseConfigFieldUpdate('endOfDayTime', '19:30')).toEqual({
      ok: true,
      key: 'endOfDayTime',
      value: '19:30',
    });
  });

  it.each([
    ['relevanceHours', 'not-a-number'],
    ['relevanceHours', '0'],
    ['captureConcurrency', '0'],
    ['captureConcurrency', '1.5'],
    ['endOfDayTime', '25:99'],
    ['captureModel', ''],
    ['leadTimesInMinutes', '30,-1'],
    ['leadTimesInMinutes', '30,abc'],
  ])(
    'rejects a value the schema does not accept: %s = %s, naming the value and the key',
    (key, raw) => {
      const result = parseConfigFieldUpdate(key, raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(`"${raw}"`);
        expect(result.error).toContain(key);
      }
    },
  );
});

describe('applyConfigFieldUpdate (S4-T4)', () => {
  it('replaces exactly the named field, leaving every other field untouched', () => {
    const updated = applyConfigFieldUpdate(DEFAULT_CONFIG, 'relevanceHours', 6);
    expect(updated.relevanceHours).toBe(6);
    expect(updated.captureModel).toBe(DEFAULT_CONFIG.captureModel);
    expect(updated.projectPolicy).toBe(DEFAULT_CONFIG.projectPolicy);
  });
});

describe('applyProjectPolicyUpdate (S4-T4)', () => {
  it('a cwd never mentioned before defaults both flags to false, then applies just the one passed', () => {
    const { config, policy } = applyProjectPolicyUpdate(DEFAULT_CONFIG, 'c:\\code\\new', {
      canTerminate: true,
    });
    expect(policy).toEqual({ canTerminate: true, deepCapture: false });
    expect(config.projectPolicy['c:\\code\\new']).toEqual(policy);
  });

  it('updating one flag preserves the other flag already on record for that cwd', () => {
    const withDeepCapture: typeof DEFAULT_CONFIG = {
      ...DEFAULT_CONFIG,
      projectPolicy: { 'c:\\code\\p': { canTerminate: false, deepCapture: true } },
    };
    const { policy } = applyProjectPolicyUpdate(withDeepCapture, 'c:\\code\\p', {
      canTerminate: true,
    });
    expect(policy).toEqual({ canTerminate: true, deepCapture: true });
  });

  it('never mutates other projects already in projectPolicy', () => {
    const withOther: typeof DEFAULT_CONFIG = {
      ...DEFAULT_CONFIG,
      projectPolicy: { 'c:\\code\\other': { canTerminate: true, deepCapture: true } },
    };
    const { config } = applyProjectPolicyUpdate(withOther, 'c:\\code\\new', {
      deepCapture: true,
    });
    expect(config.projectPolicy['c:\\code\\other']).toEqual({
      canTerminate: true,
      deepCapture: true,
    });
  });
});

describe('formatConfigValue (S4-T4)', () => {
  it.each([
    [null, 'null'],
    [[], '(empty)'],
    [[30, 15], '30, 15'],
    [['a', 'b'], 'a, b'],
    [6, '6'],
    ['sonnet', 'sonnet'],
  ])('formats %j as %s', (value, expected) => {
    expect(formatConfigValue(value as never)).toBe(expected);
  });
});

describe('serializeConfigDocument (S4-T4)', () => {
  it('round-trips through parseConfigDocument unchanged', () => {
    const custom = { ...DEFAULT_CONFIG, relevanceHours: 6, captureModel: 'opus' };
    const document = serializeConfigDocument(custom);
    expect(parseConfigDocument(document)).toEqual(custom);
  });

  it('always stamps the current schemaVersion', () => {
    const document = serializeConfigDocument(DEFAULT_CONFIG);
    expect(document.schemaVersion).toBe(1);
  });
});
