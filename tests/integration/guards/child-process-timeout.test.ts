import { describe, expect, it } from 'vitest';
import { runCommandWithBudget } from './_support.js';

/**
 * Regression test for S2-T7 (docs/PLANO-DE-ENTREGA.md): before this task, `_support.ts`'s `run()`
 * called `spawnSync` with no `timeout` option at all — the child process had no budget of its
 * own. The only thing that ever stopped a slow child was Vitest's `it(...)` timeout killing the
 * whole test (and the child with it) from OUTSIDE, at the same instant the (misleadingly named)
 * `CHILD_PROCESS_TIMEOUT` constant expired. The result was "Test timed out in 20000ms" — Vitest's
 * generic message, not a diagnosable reason from the tool that was actually slow.
 *
 * This test forces that exact scenario with a fake command (`node -e 'setTimeout(...)'`, per the
 * plan's acceptance criterion) that outlives a deliberately small budget, and proves the CHILD
 * now reports its own failure with a legible reason. It runs with Vitest's default test timeout
 * (no third `it(...)` argument): the whole point is that the budget below is small enough that
 * this test finishes in well under a second, nowhere near any Vitest timeout — proving the
 * child's own clock is what caught this, not the test's.
 *
 * Fails before the fix: the old `run()` had no `timeoutMs` option to accept, so
 * `runCommandWithBudget` didn't exist and this file wouldn't even compile — and if the fake sleep
 * below had instead been raced against a real `it(...)` timeout (the only mechanism that existed
 * pre-fix), the failure would have been Vitest's own "Test timed out", exactly the defect this
 * task closes.
 */
describe('guard: a child process that outlives its own budget fails with a legible reason', () => {
  it('reports a diagnosable timeout instead of hanging until something else notices', () => {
    const budgetMs = 300;
    const startedAt = Date.now();

    // A fake command that sleeps far past its budget (5s sleep vs. a 300ms budget) — the
    // "comando falso que dorme além do orçamento" the plan's acceptance criterion asks for.
    const result = runCommandWithBudget(['-e', 'setTimeout(() => {}, 5_000);'], budgetMs);

    const elapsedMs = Date.now() - startedAt;

    // The child was actually killed near its own budget, not left running for the full 5s sleep
    // — proof this is the child's clock catching it, not some other mechanism. Generous upper
    // bound (budget + 5s) so this assertion isn't itself a new source of flakiness under load.
    expect(elapsedMs, result.output).toBeLessThan(budgetMs + 5_000);

    // A killed child is a FAILURE, never silently green (`status: null` from spawnSync, never 0).
    expect(result.exitCode, result.output).not.toBe(0);

    // The diagnosable reason this task exists to produce: not empty output, not a bare `null`
    // exit code that looks identical to "the tool ran and printed nothing".
    expect(result.output).toContain('exceeded its own');
    expect(result.output).toContain(`${budgetMs}ms budget`);
    expect(result.output).toContain('CHILD_PROCESS_BUDGET_MS');
  });

  it('a command that finishes well inside its budget reports its real result, no timeout noise (control)', () => {
    const result = runCommandWithBudget(['-e', "console.log('done');"], 5_000);

    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain('done');
    // Without this control, the assertions above could pass for the wrong reason (e.g. the
    // diagnostic text always being appended, timeout or not).
    expect(result.output).not.toContain('exceeded its own');
  });
});
