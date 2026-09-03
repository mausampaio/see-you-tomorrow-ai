import { describe, expect, it } from 'vitest';
import { GENERATION_SYSTEM_PROMPT } from '../../../../src/adapters/generation/system-prompt.js';
import { buildLeanArgs } from '../../../../src/adapters/generation/args.js';

// S4-T0e: this only proves the two instructions exist in the exported prompt text and are the
// ones actually sent to `claude` (via `args.ts`). It does NOT prove the model obeys them — that
// depends on the model, and no unit test can establish it (see docs/QUESTOES.md Q-045: the real
// validation is observing real captures, and it hasn't happened yet).
describe('GENERATION_SYSTEM_PROMPT', () => {
  it('keeps the original instruction: say so plainly instead of inventing activity', () => {
    expect(GENERATION_SYSTEM_PROMPT).toContain('say so plainly instead of inventing activity');
  });

  it('instructs naming a known category instead of enumerating unseen specific items', () => {
    expect(GENERATION_SYSTEM_PROMPT).toContain(
      'If you can tell a category of things exists but not which specific ones, name the ' +
        'category — not invented items.',
    );
  });

  it('instructs reporting partial evidence as partial instead of stating what it proves', () => {
    expect(GENERATION_SYSTEM_PROMPT).toContain(
      'If your evidence is partial — an unfinished search, a cut-off message — say it is ' +
        'partial instead of stating what it proves.',
    );
  });

  it('is the exact string sent as --system-prompt to `claude` (args.ts wiring)', () => {
    const args = buildLeanArgs({ model: 'sonnet', budgetPerSessionUsd: 0.25 });
    expect(args[args.indexOf('--system-prompt') + 1]).toBe(GENERATION_SYSTEM_PROMPT);
  });

  // D-011: every character here is paid on every generation call. This isn't a hard spec limit,
  // just a tripwire so a future addition to this prompt gets noticed and measured instead of
  // creeping up unnoticed the same way Q-036/D-011 already found once with volume vs. cost.
  it('stays short: under 1000 characters', () => {
    expect(GENERATION_SYSTEM_PROMPT.length).toBeLessThan(1000);
  });
});
