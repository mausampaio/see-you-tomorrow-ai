import { describe, expect, it } from 'vitest';
import {
  applyConfigFieldUpdate,
  applyProjectPolicyUpdate,
  CONFIG_SCHEMA_VERSION,
  DEFAULT_CONFIG,
  EDITABLE_CONFIG_KEYS,
  formatConfigValue,
  isEditableConfigKey,
  parseConfigDocument,
  parseConfigFieldUpdate,
  projectPolicyNotEditableMessage,
  schemaVersionNotEditableMessage,
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

  // S4-T8 item 1: the mantenedor's own case — "eu não errei digitando... 09 e 9 é basicamente a
  // mesma coisa". Accepting a single-digit hour is only half of it; the other half is that what
  // lands on disk is always the canonical two-digit form, so config.json never grows two spellings
  // of the same hour (this task's own cuidado (a)).
  it('accepts a single-digit hour and normalizes it to two digits', () => {
    expect(parseConfigDocument({ endOfDayTime: '9:30' }).endOfDayTime).toBe('09:30');
  });

  it('a single-digit hour at the top of the range normalizes the same way', () => {
    expect(parseConfigDocument({ endOfDayTime: '0:05' }).endOfDayTime).toBe('00:05');
  });

  // The minute half did NOT get the same leniency — "9:5" is genuinely ambiguous (five minutes, or
  // a typo for ":50"?) in a way "9:30" never was, so it keeps requiring exactly two digits.
  it('still rejects a single-digit minute — only the hour got more lenient', () => {
    expect(() => parseConfigDocument({ endOfDayTime: '9:5' })).toThrow();
  });

  it('ignores unknown top-level keys without failing (tolerant of the unfamiliar, like every other schema in this project)', () => {
    expect(() => parseConfigDocument({ somethingFuture: 'x' })).not.toThrow();
    expect(parseConfigDocument({ somethingFuture: 'x' })).toEqual(DEFAULT_CONFIG);
  });

  it.each([
    ['relevanceHours as a string', { relevanceHours: '12' }],
    ['endOfDayTime not matching "HH:MM"', { endOfDayTime: '25:99' }],
    // S4-T8 item 1: a single-digit HOUR ("9:30") is now accepted and normalized (see the dedicated
    // describe block above) — this leaves the still-rejected shapes explicit: out-of-range hour
    // (25), out-of-range minute (99, and the single-digit-minute case below), and non-numeric input.
    ['endOfDayTime with a single-digit minute', { endOfDayTime: '9:5' }],
    ['endOfDayTime with an out-of-range hour', { endOfDayTime: '24:00' }],
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
    ['leadTimeHysteresisMinutes as negative', { leadTimeHysteresisMinutes: -1 }],
    ['leadTimeHysteresisMinutes as a string', { leadTimeHysteresisMinutes: '3' }],
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

describe('parseConfigDocument — leadTimeHysteresisMinutes (S4-T7)', () => {
  it('defaults to 3 minutes when the document says nothing about it', () => {
    expect(parseConfigDocument({}).leadTimeHysteresisMinutes).toBe(3);
  });

  it('honors an explicit value', () => {
    expect(parseConfigDocument({ leadTimeHysteresisMinutes: 10 }).leadTimeHysteresisMinutes).toBe(
      10,
    );
  });

  it('0 ("never suppress a second leadTimeWarning") is accepted, not rejected as degenerate', () => {
    expect(() => parseConfigDocument({ leadTimeHysteresisMinutes: 0 })).not.toThrow();
    expect(parseConfigDocument({ leadTimeHysteresisMinutes: 0 }).leadTimeHysteresisMinutes).toBe(0);
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

// S4-T6, D-025: `schemaVersion` is a REAL key — required, checked on every read — just not one
// `isEditableConfigKey` recognizes, because there is nothing to set it to. `cli/config-command.ts`
// checks `key === 'schemaVersion'` before ever consulting `isEditableConfigKey`, so this list
// correctly excluding it is the precondition for that branch mattering, not a gap by itself.
describe('schemaVersionNotEditableMessage (S4-T6)', () => {
  it('is not among EDITABLE_CONFIG_KEYS (it is a known key, just not a settable one)', () => {
    expect(isEditableConfigKey('schemaVersion')).toBe(false);
  });

  it('names schemaVersion, says it exists (not "unknown"), and says where it is checked', () => {
    const message = schemaVersionNotEditableMessage();
    expect(message).toContain('schemaVersion');
    expect(message).not.toContain('unknown');
    expect(message).toContain('config.json');
    expect(message).toContain('handoff');
  });

  it('CONFIG_SCHEMA_VERSION is the value "seeya config get schemaVersion" reports', () => {
    expect(CONFIG_SCHEMA_VERSION).toBe(1);
  });
});

// S4-T8 item 3: the same shape of fix as schemaVersionNotEditableMessage above, for the other name
// `seeya config set` was contradicting itself about ("unknown config key \"projectPolicy\"" next to
// "for \"projectPolicy\", use..." in the same sentence).
describe('projectPolicyNotEditableMessage (S4-T8)', () => {
  it('is not among EDITABLE_CONFIG_KEYS (it is a known key, just not a flat settable one)', () => {
    expect(isEditableConfigKey('projectPolicy')).toBe(false);
  });

  it('names projectPolicy, says it exists (not "unknown"), and names both alternatives', () => {
    const message = projectPolicyNotEditableMessage();
    expect(message).toContain('projectPolicy');
    expect(message).not.toContain('unknown');
    expect(message).toContain('seeya config policy');
    expect(message).toContain('seeya config get projectPolicy');
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
    ['leadTimeHysteresisMinutes', '5', 5],
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

  // S4-T8 item 1: `seeya config set endOfDayTime 9:30` — the mantenedor's own case — is accepted
  // AND normalized to the canonical two-digit form before it ever reaches `applyConfigFieldUpdate`
  // (and therefore `saveConfig`), so disk never ends up with two spellings of the same hour.
  it('a single-digit hour for endOfDayTime is accepted and normalized to two digits', () => {
    expect(parseConfigFieldUpdate('endOfDayTime', '9:30')).toEqual({
      ok: true,
      key: 'endOfDayTime',
      value: '09:30',
    });
  });

  it.each([
    ['relevanceHours', 'not-a-number'],
    ['relevanceHours', '0'],
    ['captureConcurrency', '0'],
    ['captureConcurrency', '1.5'],
    ['endOfDayTime', '25:99'],
    ['endOfDayTime', '9:5'], // S4-T8 item 1: minute still needs exactly two digits
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

  // S4-T8 item 1: the "✖" in the message before this fix was `z.prettifyError`'s own formatting
  // leaking onto the screen, not something this project chose to print (AGENTS.md § "Registro e
  // saída"). The message now names the expected shape WITH an example instead.
  it('an invalid endOfDayTime names an example of what is accepted, without the validation library\'s own "✖" formatting', () => {
    const result = parseConfigFieldUpdate('endOfDayTime', '25:99');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain('✖');
      expect(result.error).toContain('09:30');
    }
  });
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
