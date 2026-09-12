/**
 * `runConfigGetCommand`/`runConfigSetCommand`/`runConfigPolicyCommand` (S4-T4,
 * docs/ESPECIFICACAO.md § "seeya config", D-027, D-035). Uses `InMemoryScheduleStorage` — a real
 * in-memory `Storage` double, since the point here is the CLI layer's own read/validate/write
 * flow, not re-testing `configFileSchema` itself (already covered by
 * `tests/integration/storage/read-config.test.ts`).
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolvePolicyCwdArgument,
  runConfigGetCommand,
  runConfigPolicyCommand,
  runConfigSetCommand,
} from '../../../src/cli/config-command.js';
import { normalizeCwdForComparison } from '../../../src/core/cwd-normalization.js';
import { InMemoryScheduleStorage } from './_fakes.js';
import type { Config } from '../../../src/core/types.js';

function config(overrides: Partial<Config> = {}): Config {
  return {
    endOfDayTime: '19:30',
    leadTimesInMinutes: [30, 15],
    relevanceHours: 12,
    idleMinutes: 45,
    captureModel: 'sonnet',
    budgetPerSessionUsd: 0.25,
    captureConcurrency: 3,
    ignore: [],
    projectPolicy: {},
    forkCleanupDays: 7,
    maxGitRootsToVisit: 8,
    maxCaptureAttemptsPerSessionPerDay: 3,
    maxBriefingScanDays: 30,
    overdueFireThresholdMinutes: 5,
    leadTimeHysteresisMinutes: 3,
    ...overrides,
  };
}

describe('runConfigGetCommand', () => {
  it('with no key, prints every scalar field plus a projectPolicy section', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const report = await runConfigGetCommand({ storage }, undefined);

    expect(report).toContain('endOfDayTime: 19:30');
    expect(report).toContain('captureModel: sonnet');
    expect(report).toContain('leadTimesInMinutes: 30, 15');
    expect(report).toContain('projectPolicy: (none)');
  });

  it('with a single scalar key, prints only that line', async () => {
    const storage = new InMemoryScheduleStorage(config({ relevanceHours: 6 }));
    const report = await runConfigGetCommand({ storage }, 'relevanceHours');
    expect(report).toBe('relevanceHours: 6');
  });

  it('formats an empty list distinctly from a populated one', async () => {
    const storage = new InMemoryScheduleStorage(config({ ignore: [] }));
    expect(await runConfigGetCommand({ storage }, 'ignore')).toBe('ignore: (empty)');
  });

  it('formats endOfDayTime: null explicitly, not as an empty string', async () => {
    const storage = new InMemoryScheduleStorage(config({ endOfDayTime: null }));
    expect(await runConfigGetCommand({ storage }, 'endOfDayTime')).toBe('endOfDayTime: null');
  });

  it('an unknown key names the value received and the keys expected (AGENTS.md § "Mensagens de erro")', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const report = await runConfigGetCommand({ storage }, 'bogusKey');
    expect(report).toContain('"bogusKey"');
    expect(report).toContain('endOfDayTime');
    expect(report).toContain('seeya config policy');
  });

  it('"projectPolicy" as the key lists every project (the one category `set` cannot reach)', async () => {
    const storage = new InMemoryScheduleStorage(
      config({ projectPolicy: { 'c:\\code\\a': { canTerminate: true, deepCapture: false } } }),
    );
    const report = await runConfigGetCommand({ storage }, 'projectPolicy');
    expect(report).toContain('c:\\code\\a: canTerminate=true, deepCapture=false');
  });

  // S4-T6: before this, "schemaVersion" fell into the exact same branch as a made-up key
  // ("bogusKey" above) and got called "unknown" — false, it's real and checked on every read.
  it('"schemaVersion" reports the version this build reads/writes, never "unknown config key"', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const report = await runConfigGetCommand({ storage }, 'schemaVersion');
    expect(report).toBe('schemaVersion: 1');
    expect(report).not.toContain('unknown');
  });
});

describe('runConfigSetCommand', () => {
  it('sets a valid scalar field and persists it via Storage#saveConfig', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const message = await runConfigSetCommand({ storage }, 'relevanceHours', '6');

    expect(message).toBe('relevanceHours set to 6.');
    expect(storage.savedConfigs).toHaveLength(1);
    expect(storage.savedConfigs[0]?.relevanceHours).toBe(6);
    // The rest of the document survives untouched — a `set` is one field, not a fresh document.
    expect(storage.savedConfigs[0]?.captureModel).toBe('sonnet');
  });

  it('parses a comma-separated list field', async () => {
    const storage = new InMemoryScheduleStorage(config());
    await runConfigSetCommand({ storage }, 'leadTimesInMinutes', '45, 20');
    expect(storage.savedConfigs[0]?.leadTimesInMinutes).toEqual([45, 20]);
  });

  it('the literal "null" disables endOfDayTime', async () => {
    const storage = new InMemoryScheduleStorage(config({ endOfDayTime: '19:30' }));
    const message = await runConfigSetCommand({ storage }, 'endOfDayTime', 'null');
    expect(storage.savedConfigs[0]?.endOfDayTime).toBeNull();
    expect(message).toBe('endOfDayTime set to null.');
  });

  it('refuses an unknown key WITHOUT writing anything (D-027)', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const message = await runConfigSetCommand({ storage }, 'notARealKey', '5');

    expect(message).toContain('"notARealKey"');
    expect(storage.savedConfigs).toHaveLength(0);
  });

  // S4-T8 item 3: before this, `projectPolicy` fell through to `unknownConfigKeyMessage`, which
  // said "unknown config key \"projectPolicy\"" in the same breath as "for \"projectPolicy\", use
  // seeya config policy <cwd> instead" — the program contradicting itself about a key it very much
  // recognizes (`runConfigGetCommand` above already reads it). Same distinction S4-T6 already drew
  // for `schemaVersion`: "exists, wrong tool" is not "unknown".
  it('refuses projectPolicy through `set` — it has its own sub-action, and is never called "unknown"', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const message = await runConfigSetCommand({ storage }, 'projectPolicy', '{}');
    expect(message).toContain('projectPolicy');
    expect(message).not.toContain('unknown');
    expect(message).toContain('seeya config policy');
    expect(storage.savedConfigs).toHaveLength(0);
  });

  // S4-T6: distinguishes "doesn't exist" (the 'notARealKey' case above, which DOES say "unknown")
  // from "exists, isn't editable" — schemaVersion is the latter, and must never say "unknown".
  it('refuses "schemaVersion" WITHOUT writing anything, and never calls it unknown (D-025)', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const message = await runConfigSetCommand({ storage }, 'schemaVersion', '2');

    expect(message).toContain('schemaVersion');
    expect(message).not.toContain('unknown');
    expect(storage.savedConfigs).toHaveLength(0);
  });

  it('refuses a value the schema would reject, naming both the value and why (AGENTS.md § "Mensagens de erro")', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const message = await runConfigSetCommand({ storage }, 'relevanceHours', 'not-a-number');

    expect(message).toContain('"not-a-number"');
    expect(message).toContain('relevanceHours');
    expect(storage.savedConfigs).toHaveLength(0);
  });

  it('refuses an out-of-range value (endOfDayTime must be 24h "HH:MM")', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const message = await runConfigSetCommand({ storage }, 'endOfDayTime', '25:99');

    expect(message).toContain('"25:99"');
    expect(storage.savedConfigs).toHaveLength(0);
  });

  // S4-T8 item 1, end to end through the CLI layer: `seeya config set endOfDayTime 9:30` writes
  // the canonical two-digit form, not the single-digit spelling the person typed.
  it('normalizes a single-digit hour to two digits before persisting (S4-T8 item 1)', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const message = await runConfigSetCommand({ storage }, 'endOfDayTime', '9:30');

    expect(message).toBe('endOfDayTime set to 09:30.');
    expect(storage.savedConfigs[0]?.endOfDayTime).toBe('09:30');
  });

  it('refuses captureConcurrency: 0 — the schema requires at least 1', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const message = await runConfigSetCommand({ storage }, 'captureConcurrency', '0');
    expect(message).toContain('captureConcurrency');
    expect(storage.savedConfigs).toHaveLength(0);
  });

  it('accepts the permitted case: a valid captureConcurrency of 1 (AGENTS.md: "teste o caso permitido, não só o proibido")', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const message = await runConfigSetCommand({ storage }, 'captureConcurrency', '1');
    expect(message).toBe('captureConcurrency set to 1.');
    expect(storage.savedConfigs[0]?.captureConcurrency).toBe(1);
  });
});

describe('runConfigPolicyCommand', () => {
  it('with no flags, shows the current (default) policy for a cwd never mentioned before', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const report = await runConfigPolicyCommand({ storage }, 'c:\\code\\new', {});
    expect(report).toBe('c:\\code\\new: canTerminate=false, deepCapture=false');
    expect(storage.savedConfigs).toHaveLength(0);
  });

  it('sets canTerminate without touching an existing deepCapture', async () => {
    const storage = new InMemoryScheduleStorage(
      config({ projectPolicy: { 'c:\\code\\p': { canTerminate: false, deepCapture: true } } }),
    );
    const message = await runConfigPolicyCommand({ storage }, 'c:\\code\\p', {
      canTerminate: 'true',
    });

    expect(message).toContain('canTerminate=true, deepCapture=true');
    // S4-T12: written CANONICALIZED (separators unified to `/`), merged onto the existing entry —
    // see `applyProjectPolicyUpdate`'s own tests in `config-schema.test.ts` for the normalization
    // itself; this just proves the CLI layer wires it through.
    expect(storage.savedConfigs[0]?.projectPolicy['c:/code/p']).toEqual({
      canTerminate: true,
      deepCapture: true,
    });
    expect(storage.savedConfigs[0]?.projectPolicy['c:\\code\\p']).toBeUndefined();
  });

  it('sets both flags at once', async () => {
    const storage = new InMemoryScheduleStorage(config());
    await runConfigPolicyCommand({ storage }, 'c:\\code\\p', {
      canTerminate: 'true',
      deepCapture: 'true',
    });
    expect(storage.savedConfigs[0]?.projectPolicy['c:/code/p']).toEqual({
      canTerminate: true,
      deepCapture: true,
    });
  });

  it('refuses an invalid boolean flag value, naming it and the expected shape, without writing', async () => {
    const storage = new InMemoryScheduleStorage(config());
    const message = await runConfigPolicyCommand({ storage }, 'c:\\code\\p', {
      canTerminate: 'yes',
    });

    expect(message).toContain('"yes"');
    expect(message).toContain('true');
    expect(message).toContain('false');
    expect(storage.savedConfigs).toHaveLength(0);
  });

  // S4-T12 (docs/QUESTOES.md Q-056 item 3): reading a policy already on disk under a raw key still
  // matches a `cwd` spelled differently, without needing a write to "fix" it first.
  it('with no flags, matches an existing raw-keyed entry spelled with a different separator/case', async () => {
    const storage = new InMemoryScheduleStorage(
      config({ projectPolicy: { 'c:\\code\\p': { canTerminate: true, deepCapture: false } } }),
    );
    const report = await runConfigPolicyCommand({ storage }, 'c:/code/p', {});
    expect(report).toContain('canTerminate=true, deepCapture=false');
  });

  describe('S4-T12 cuidado (b): a relative cwd is resolved, never silently written unmatched', () => {
    it('a relative cwd resolves against the CLI process working directory before writing', async () => {
      const storage = new InMemoryScheduleStorage(config());
      const message = await runConfigPolicyCommand({ storage }, 'relative-project', {
        canTerminate: 'true',
      });

      const expectedCanonicalCwd = normalizeCwdForComparison(
        path.resolve('relative-project'),
        process.platform === 'win32' ? 'win32' : 'posix',
      );
      expect(message).toContain(expectedCanonicalCwd);
      expect(storage.savedConfigs[0]?.projectPolicy[expectedCanonicalCwd]).toEqual({
        canTerminate: true,
        deepCapture: false,
      });
      // Never written under the raw, unresolved string — that key would never match any real
      // session's absolute `cwd`.
      expect(storage.savedConfigs[0]?.projectPolicy['relative-project']).toBeUndefined();
    });
  });
});

describe('resolvePolicyCwdArgument (S4-T12 cuidado (b))', () => {
  it('leaves an already-absolute cwd (either OS convention) untouched, regardless of host', () => {
    expect(resolvePolicyCwdArgument('c:\\code\\x', '/irrelevant/base')).toBe('c:\\code\\x');
    expect(resolvePolicyCwdArgument('/home/x/project', '/irrelevant/base')).toBe('/home/x/project');
  });

  it('resolves a relative cwd against the injected working directory, not the real process.cwd()', () => {
    const resolved = resolvePolicyCwdArgument('sub/dir', '/base');
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).not.toBe('sub/dir');
  });

  it('defaults the working directory to the real process.cwd() when none is injected', () => {
    const resolved = resolvePolicyCwdArgument('.');
    expect(resolved).toBe(path.resolve('.'));
  });
});
