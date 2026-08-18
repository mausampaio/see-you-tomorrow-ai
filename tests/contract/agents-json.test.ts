import { describe, expect, it } from 'vitest';
import { validateAgentsJsonOutput } from '../../src/adapters/discovery/schemas.js';
import { runClaude, getClaudeCodeVersion } from './_support.js';

const version = getClaudeCodeVersion();

/**
 * docs/TESTES.md § Contrato, item 4: "`claude agents --json` still returns an array with `pid`,
 * `sessionId`, `cwd`." Local command (D-016) — enumerates processes already running on the
 * machine, doesn't touch the network. Doesn't run in standard CI — only via `npm run
 * test:contrato`.
 *
 * `validateAgentsJsonOutput` is item-by-item (D-022) — but D-022's tolerance is for the
 * **product**: the user's `seeya sessoes` can't go down because of a strange entry, so the
 * adapter discards the bad item and moves on. **This test has the opposite purpose**: it exists
 * to scream when reality diverges from the schema, because the contract suite doesn't run in CI
 * (only via `npm run test:contrato`) and a failure here is the only signal a human has to go
 * investigate. If we applied the same tolerance here, a new variant would be silently discarded
 * and nobody would know — the alarm would turn into a shock absorber, and "green contract" would
 * stop proving what it claims to prove. That's why `rejected` needs to be **empty**, not just
 * `accepted` greater than zero: any item the schema doesn't recognize fails the test, with the
 * item's raw JSON in the message.
 */
describe(`contract: claude agents --json (claude ${version})`, () => {
  it('returns only sessions the schema recognizes — none may be silently discarded', () => {
    const result = runClaude(['agents', '--json']);

    expect(
      result.exitCode,
      `\`claude agents --json\` exited with a non-zero code. stderr: ${result.error}`,
    ).toBe(0);

    let json: unknown;
    try {
      json = JSON.parse(result.output);
    } catch (error) {
      throw new Error(
        `\`claude agents --json\` did not return valid JSON. Raw output:\n${result.output}\n\n` +
          `Error: ${String(error)}`,
      );
    }

    const { accepted, rejected } = validateAgentsJsonOutput(json);

    // Strict, unlike the adapter: any rejected item here is reality diverging from the schema,
    // and the test needs to scream with the raw item visible — not silently swallow it.
    expect(
      rejected,
      'agentsJsonItemSchema rejected item(s) from the real output of `claude agents --json`. ' +
        "Reality changed — log it in docs/QUESTOES.md with this raw output, don't loosen the " +
        `schema.\n\nRejected: ${JSON.stringify(rejected, null, 2)}`,
    ).toEqual([]);

    // A different case from the previous one: no item rejected, but also none accepted — there's
    // no open session to confirm the items have pid/sessionId/cwd.
    expect(
      accepted.length,
      "No active session returned by `claude agents --json` — can't confirm the items have " +
        'pid/sessionId/cwd. Run the contract suite with at least one session open.',
    ).toBeGreaterThan(0);
  });

  /**
   * S1-T0c / D-022. This machine (Windows) doesn't produce the "background" variant — it was
   * only observed on a second machine, Linux. Without this fixture, the contract suite never
   * proves the variant keeps being accepted: the test above only sees what `claude agents --json`
   * returns *here*. Values anonymized per CLAUDE.md § "Este projeto é de código aberto" — `id`,
   * `sessionId` and `cwd` don't belong to any real session; the UUID is obviously synthetic (only
   * 3 distinct symbols: 1, 4, 8).
   */
  it('accepts the "background" variant observed on the second machine (anonymized fixture, D-022)', () => {
    const backgroundSampleFromTheSecondMachine = {
      id: '11111111',
      cwd: '/home/<usuario>/.claude/agente/ui',
      kind: 'background',
      startedAt: 1780000000000,
      sessionId: '11111111-1111-4111-8111-111111111111',
      name: 'background session',
      state: 'blocked',
    };

    const { accepted, rejected } = validateAgentsJsonOutput([backgroundSampleFromTheSecondMachine]);

    expect(rejected, `rejection reason(s): ${JSON.stringify(rejected, null, 2)}`).toEqual([]);
    expect(accepted).toStrictEqual([backgroundSampleFromTheSecondMachine]);
  });
});
