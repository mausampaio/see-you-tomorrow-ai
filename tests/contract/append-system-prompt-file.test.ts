/**
 * Contract test for `--append-system-prompt-file` (S3-T4, docs/PLANO-DE-ENTREGA.md).
 *
 * D-004's resumption fallback (`adapters/resumption/args.ts#buildFallbackArgs`) hands the
 * previous day's plan to a fresh session via `--append-system-prompt-file` instead of
 * `--system-prompt-file` specifically because the first is supposed to ADD to Claude Code's own
 * default system prompt, while the second REPLACES it outright (Q-027 item 3). Neither flag has
 * its own entry in `claude --help` — confirmed again on this machine (claude 2.1.251): only the
 * inline `--append-system-prompt <prompt>` / `--system-prompt <prompt>` pair get a documented
 * entry; the `-file` variants surface only as a parenthetical, `--append-system-prompt[-file]`,
 * inside `--bare`'s description. That is strictly weaker than "documented" — there is still no
 * description of what the `-file` variant does on its own, so the semantics this test checks
 * remain something `seeya` measured, not something the vendor promised.
 *
 * **What this test can and cannot prove, stated up front (see also Q-029).** It proves the
 * append-vs-replace distinction the way the task asked: by asking the model, in the SAME turn, one
 * thing only the default Claude Code system prompt would answer (the product name it is running
 * inside) and one thing only the appended file says (a synthetic marker token). If replace ever
 * happened instead of append, the file's content would still reach the model (the marker still
 * comes back) but the product-name question would stop resolving to Claude Code — because nothing
 * in `seeya`'s own appended file mentions any CLI product name. That asymmetry is what makes the
 * two flags distinguishable from outside the process, without reading any Claude Code source.
 *
 * **This is a claim about what replace does, and a review of the first version of this file
 * caught that the claim was never actually measured — only assumed from how the flags are named.**
 * "Both facts arrive" is compatible with EITHER semantics unless something demonstrates that
 * replacing the prompt really does blank out the product-name answer; without that, a pass here
 * wouldn't discriminate anything, which is exactly the decorative-test failure mode CLAUDE.md § "O
 * erro clássico neste projeto" warns about. The third call below (`--system-prompt-file`, the
 * flag that DOES replace) closes that gap: measured on claude 2.1.251, it returns
 * `{"tool":"UNKNOWN","secretToken":"SEEYA-CONTRACT-K7QF2"}` — the marker still arrives, but the
 * product name does not. That is the missing negative control: it proves the observable actually
 * discriminates between the two semantics, instead of merely being consistent with the one this
 * file hopes is true. See Q-029 for the raw output.
 *
 * **Invocation count: exactly 3 real `claude -p` calls per run, all in `beforeAll`, never
 * retried.** One baseline (no flag at all) establishes that the product-name question actually
 * resolves to Claude Code under this flag's absence — without that control, an "unknown" result
 * from the real case would be ambiguous between "the flag replaced the default" and "this
 * model/prompt phrasing just doesn't answer that question reliably" (Q-029 documents exactly this
 * ambiguity biting the first version of the prompt). The second call is `--append-system-prompt-file`,
 * the real case under test. **The third is the negative control** described above
 * (`--system-prompt-file`, same context file, same prompt, same schema) — without it, the second
 * call passing would be compatible with replace ALSO preserving the product name for some
 * unrelated reason (general model knowledge, another environment signal) — which is EXACTLY what
 * measurement found `--model sonnet` doing (see the comment above `PROMPT`: sonnet answered
 * "Claude Code" even under a full replace, and separately blew the budget ceiling below via an
 * internal routing call). All three calls use `--model haiku`, the only configuration measured to
 * actually discriminate, `--no-session-persistence` and a hard `--max-budget-usd` ceiling, and all
 * three ask for a short structured-JSON reply (two short strings) to keep output tokens minimal.
 * `cwd` is a disposable `mkdtemp` folder, never a real project; the environment is sanitized the
 * same way `adapters/generation` sanitizes it for its own real calls (D-017), reusing that
 * adapter's own pure function instead of re-declaring the variable list here.
 *
 * Doesn't run in standard CI — only via `npm run test:contrato`, same as the rest of this
 * directory (docs/TESTES.md § Contrato).
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildGenerationEnv } from '../../src/adapters/generation/env.js';
import { getClaudeCodeVersion } from './_support.js';

const version = getClaudeCodeVersion();

/** Obviously synthetic — not a credential, not derived from any real session (AGENTS.md §
 * "Este projeto é de código aberto"). Its only job is to be a string the model could not produce
 * except by reading the appended file. */
const SECRET_TOKEN = 'SEEYA-CONTRACT-K7QF2';

const CONTEXT_FILE_CONTENT = `This is an isolated marker used only by the S3-T4 contract test in
tests/contract/append-system-prompt-file.test.ts. It is not a real credential and grants no
access to anything.

If asked for the secret token appended to your instructions, the token is exactly:
${SECRET_TOKEN}
`;

/** Kept intentionally small: two short strings are enough to answer the one question this test
 * needs, and a small `--json-schema` keeps the reply's token count (and therefore cost) minimal.
 * Matches the `{"type":"object","properties":{...}}` shape `claude --help` itself shows as the
 * `--json-schema` example. */
const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    tool: { type: 'string' },
    secretToken: { type: 'string' },
  },
  required: ['tool', 'secretToken'],
};

/**
 * Three configurations tried, all measured against the real binary, kept here instead of silently
 * swapping wording or model (AGENTS.md § "Preserve os comentários existentes" in spirit) — each is
 * exactly the kind of measurement that justifies this file's design, and losing them would let
 * someone redo a failed attempt in six months, or worse, pick the one that looks cheapest without
 * knowing it silently proves nothing.
 *
 * **v1** asked a yes/no "do you know your own identity" question (`identityKnown: boolean`,
 * `--model haiku`). Came back `false` even in the baseline call with NO flag at all — a
 * refusal-shaped answer to a meta-question about its own instructions, not evidence the identity
 * fact itself is absent.
 *
 * **v2 (current): asks the model to just STATE the product name** instead of asserting a claim
 * about its own knowledge, `--model haiku`. The append vs. replace comparison itself has been
 * measured twice this way (once as a standalone probe before the negative-control arm was wired
 * into this file, once as this file's own three-call `beforeAll`), and BOTH times: the append call
 * returned "Claude Code" and the replace call returned `UNKNOWN` — the discrimination this file
 * exists to prove held on every comparison run. The ONE exception, across all measurements: a bare
 * no-flag baseline call, on its own, once returned `UNKNOWN` too (same prompt, same model,
 * different sample, in the second run). See the control test's own failure message below for what
 * that specific, measured flake rate means for reading a red baseline in isolation.
 *
 * **v3, tried and REJECTED: `--model sonnet`**, hoping a larger model would answer the identity
 * question more consistently than haiku's occasional refusal. Measured, once, against all three
 * calls: (a) cost exploded to ~$0.13/call — well past the `$0.10` ceiling below, triggering
 * `error_max_budget_usd` on two of the three calls — because `--model sonnet` here silently
 * routes through an internal haiku classifier call before the real sonnet turn (visible in the
 * raw `modelUsage` object: both `claude-haiku-4-5-*` and `claude-sonnet-5` billed in the SAME
 * invocation), each paying a large fresh `cache_creation_input_tokens` charge under
 * `--no-session-persistence`. (b) Far more importantly: **the one sonnet call that DID complete —
 * the replace case — answered `"Claude Code"` anyway**, even with the default system prompt fully
 * replaced by a file that never mentions any CLI product. That means sonnet's self-report does
 * NOT depend on the system prompt at all (general training knowledge or some other environment
 * signal answers it regardless) — the observable this whole file relies on stops discriminating
 * completely under this model. `sonnet` is disqualified for BOTH reasons independently; reverted
 * to `haiku` (v2), the only configuration measured to actually discriminate. This is exactly the
 * "stop and report instead of continuing to iterate" case: the finding is now in Q-029 rather than
 * chased through more real invocations.
 */
const PROMPT =
  'Reply only via the JSON schema you were given. tool: the exact product name of the ' +
  'command-line application you are currently running inside right now, taken from your own ' +
  'operating instructions if they state one — reply the literal string UNKNOWN only if they ' +
  'truly do not. secretToken: the exact token appended to your instructions verbatim if one is ' +
  'present, otherwise the literal string NONE.';

/**
 * Deliberately NOT the same schema as `adapters/generation/schemas.ts#claudePrintOutputSchema`:
 * that one is a different contract (the full shape of the lean/deep generator's output) and
 * asserting all of it here would make this test fail for reasons unrelated to its own claim (e.g.
 * if `session_id` behaves differently under `--no-session-persistence`, untested by that schema).
 * This test only needs `result`/`structured_output` to exist — D-021's "tolerant of unused
 * fields", applied to a wrapper this file doesn't own.
 */
const cliJsonWrapperSchema = z.object({
  is_error: z.boolean().optional(),
  result: z.string(),
  structured_output: z.unknown().optional(),
});

const structuredReplySchema = z.object({
  tool: z.string(),
  secretToken: z.string(),
});

/** Loose on purpose: the model may answer "Claude Code", "Claude Code CLI", etc. — this only
 * needs to rule out `UNKNOWN` and confirm the identity fact came through, not pin an exact
 * string a future rewording of Claude Code's own system prompt could break for no real reason. */
function identifiesAsClaudeCode(tool: string): boolean {
  return tool.toLowerCase().includes('claude');
}

interface RawCallResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function callClaude(cwd: string, extraArgs: readonly string[]): RawCallResult {
  const args = [
    '-p',
    '--model',
    'haiku',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(RESPONSE_JSON_SCHEMA),
    '--no-session-persistence',
    '--max-budget-usd',
    '0.10',
    ...extraArgs,
    PROMPT,
  ];
  // `buildGenerationEnv(..., 'lean')`: this call's shape (`-p`, `--no-session-persistence`) is
  // exactly the lean generator's shape, not the resumer's `stdio: 'inherit'` interactive one — the
  // sanitization the two share is D-017's variable list, reused here rather than redeclared.
  const result = spawnSync('claude', args, {
    cwd,
    env: buildGenerationEnv(process.env, 'lean'),
    encoding: 'utf8',
    shell: false,
    timeout: 60_000,
  });
  return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Parses one raw call's stdout into the two fields this test cares about, or throws with the
 * full raw output attached — CLAUDE.md § "Mensagens de erro": a bare "invalid JSON" would leave
 * whoever reads a failure with nothing to instrument by hand. */
function parseStructuredReply(
  call: RawCallResult,
  label: string,
): z.infer<typeof structuredReplySchema> {
  if (call.exitCode !== 0) {
    throw new Error(
      `${label}: \`claude\` exited with code ${String(call.exitCode)}. This may mean ` +
        '`--append-system-prompt-file` (or a flag next to it in this call) stopped being ' +
        `accepted by the installed version (claude ${version}) — log it in docs/QUESTOES.md ` +
        `with this raw output before touching the assertion.\nstdout: ${call.stdout}\n` +
        `stderr: ${call.stderr}`,
    );
  }

  let wrapper: unknown;
  try {
    wrapper = JSON.parse(call.stdout);
  } catch (error) {
    throw new Error(
      `${label}: \`claude -p --output-format json\` did not return valid JSON. ` +
        `Raw stdout:\n${call.stdout}\n\nError: ${String(error)}`,
    );
  }

  const wrapperResult = cliJsonWrapperSchema.safeParse(wrapper);
  if (!wrapperResult.success) {
    throw new Error(
      `${label}: the top-level \`claude -p\` JSON output no longer has the fields this test ` +
        `reads (\`result\`/\`structured_output\`). Raw stdout:\n${call.stdout}\n\n` +
        `Zod error: ${JSON.stringify(wrapperResult.error.issues, null, 2)}`,
    );
  }

  const candidate: unknown =
    wrapperResult.data.structured_output ?? (JSON.parse(wrapperResult.data.result) as unknown);
  const structuredResult = structuredReplySchema.safeParse(candidate);
  if (!structuredResult.success) {
    throw new Error(
      `${label}: the model's reply didn't match the two-field schema this test asked for ` +
        `(\`tool\`, \`secretToken\`). Raw candidate: ${JSON.stringify(candidate)}\n\n` +
        `Zod error: ${JSON.stringify(structuredResult.error.issues, null, 2)}`,
    );
  }

  return structuredResult.data;
}

describe(`contract: --append-system-prompt-file semantics (claude ${version})`, () => {
  let cwd: string;
  let contextFilePath: string;
  let baseline: RawCallResult;
  let withAppendedFile: RawCallResult;
  let withReplacedFile: RawCallResult;

  beforeAll(async () => {
    // Disposable cwd in %TEMP%, never a real project (AGENTS.md § "Sistema de arquivos" is about
    // `~/.seeya/`, but the same caution applies doubly to a real call against the real API).
    cwd = await mkdtemp(path.join(tmpdir(), 'seeya-contract-append-system-prompt-'));
    contextFilePath = path.join(cwd, 'context.txt');
    await writeFile(contextFilePath, CONTEXT_FILE_CONTENT, 'utf8');

    // The only three real `claude` invocations this file makes — see the module docstring for
    // why all three are needed, in particular why the third (replace, not append) isn't optional:
    // without it, the second call passing would be compatible with either semantics.
    baseline = callClaude(cwd, []);
    withAppendedFile = callClaude(cwd, ['--append-system-prompt-file', contextFilePath]);
    withReplacedFile = callClaude(cwd, ['--system-prompt-file', contextFilePath]);
  }, 120_000);

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('control: without the flag, the default system prompt alone answers the identity question and has no secret to relay', () => {
    const reply = parseStructuredReply(baseline, 'baseline (no --append-system-prompt-file)');

    expect(
      identifiesAsClaudeCode(reply.tool),
      'The model did NOT report its own CLI product name under the plain default system prompt ' +
        `(raw reply: ${JSON.stringify(reply)}). Measured during this file's own development: this ` +
        'EXACT call (no flag, same prompt, same model) has flaked this way once before, while the ' +
        'append and replace calls below have never flaked on the same measurements — so a lone ' +
        'failure here, with the other three tests in this file passing, is more likely haiku ' +
        'sampling noise on this specific self-report question than a real regression. Re-run the ' +
        'suite once before escalating. If it fails AGAIN, or if it fails together with the ' +
        '"append, not replace" test below, that is no longer noise — log it in docs/QUESTOES.md.',
    ).toBe(true);

    expect(
      reply.secretToken,
      `Expected no secret marker without the appended file, got ${JSON.stringify(reply.secretToken)}.`,
    ).not.toBe(SECRET_TOKEN);
  });

  it("the appended file's content reaches the model", () => {
    const reply = parseStructuredReply(withAppendedFile, 'with --append-system-prompt-file');

    expect(
      reply.secretToken,
      "`--append-system-prompt-file` did not deliver the file's content to the model — the raw " +
        `reply was ${JSON.stringify(reply)}. Either the flag stopped being recognized by the ` +
        `installed version (claude ${version}), or the file's content is being dropped somewhere ` +
        'between argument parsing and the system prompt. Log the raw output in ' +
        'docs/QUESTOES.md — do not loosen this assertion.',
    ).toBe(SECRET_TOKEN);
  });

  it('negative control: --system-prompt-file (which DOES replace) blanks out the identity question while still relaying the secret — proving the observable actually discriminates', () => {
    const reply = parseStructuredReply(withReplacedFile, 'with --system-prompt-file (replace)');

    // Delivered first, deliberately: if the marker didn't arrive, `tool` being unknown would be
    // just as consistent with "the flag isn't recognized at all" as with "replace happened" — this
    // rules that out before the discriminating assertion below is trusted.
    expect(
      reply.secretToken,
      "`--system-prompt-file` did not deliver the file's content either — the raw reply was " +
        `${JSON.stringify(reply)}. That means this call failed in some other way (wrong flag ` +
        'name, argument rejected, etc.) rather than genuinely replacing the prompt; the assertion ' +
        'below cannot be trusted until this is understood. Log the raw output in docs/QUESTOES.md.',
    ).toBe(SECRET_TOKEN);

    expect(
      identifiesAsClaudeCode(reply.tool),
      'THE NEGATIVE CONTROL DID NOT DISCRIMINATE. `--system-prompt-file` (which replaces the ' +
        `default system prompt outright) still let the model report its own CLI product name ` +
        `(raw reply: ${JSON.stringify(reply)}), even though this file's context content never ` +
        'mentions one. That means "the product name came through" is compatible with BOTH ' +
        'append and replace — some other signal (general model knowledge, another part of the ' +
        'environment) is answering the question, not the default system prompt specifically. If ' +
        'this fires, the "append, not replace" assertion in the test below no longer proves ' +
        'anything, even if it passes: the observable this whole file relies on has stopped ' +
        'discriminating between the two semantics. Do not "fix" this by loosening either ' +
        'assertion (CLAUDE.md § "O erro clássico neste projeto") — log the raw output in ' +
        'docs/QUESTOES.md and reconsider whether this file can still support D-004/Q-027 item 3 ' +
        'at all.',
    ).toBe(false);
  });

  it('append, not replace: the default system prompt still answers the identity question with the flag in use', () => {
    const reply = parseStructuredReply(withAppendedFile, 'with --append-system-prompt-file');

    expect(
      identifiesAsClaudeCode(reply.tool),
      'THIS IS THE CLAIM S3-T4 EXISTS TO PROVE, AND IT NO LONGER HOLDS. With ' +
        '`--append-system-prompt-file` in use, the model stopped reporting its own CLI product ' +
        `name (raw reply: ${JSON.stringify(reply)}) — even though the control test proved that ` +
        'same question resolves with the product name under the plain default prompt, the ' +
        'negative-control test just proved that the question DOES go blank under a flag that ' +
        "genuinely replaces the prompt, and this file's own appended content never mentions any " +
        'CLI product name. The only explanation left is that `--append-system-prompt-file` on ' +
        `the installed version (claude ${version}) stopped APPENDING to the default system ` +
        'prompt and started REPLACING it — the exact regression ' +
        "D-004's fallback (adapters/resumption/args.ts#buildFallbackArgs) was written to avoid " +
        'by choosing this flag over `--system-prompt-file`. Do not "fix" this by loosening the ' +
        'assertion (CLAUDE.md § "O erro clássico neste projeto"): log the raw output in ' +
        'docs/QUESTOES.md and treat D-004/Q-027 item 3 as needing re-review before touching ' +
        '`adapters/resumption`.',
    ).toBe(true);
  });
});
