/**
 * zod schemas for the two Claude Code structures that feed session discovery
 * (docs/ESPECIFICACAO.md § "Como as sessões são descobertas"; docs/DECISOES.md D-016).
 *
 * Neither is public Claude Code API — no field here is guaranteed by the vendor. That's why both
 * schemas follow the mandatory principle of docs/TESTES.md: **strict on the fields we use,
 * tolerant of unknown fields**. `z.object()` without `.strict()` already silently drops any
 * field outside the declared shape instead of failing — that's zod's default behavior and it's
 * exactly what's wanted here: confirmed on this machine that version 2.1.233 already writes
 * fields the original spec didn't foresee (`status`, `updatedAt`, `statusUpdatedAt`,
 * `bridgeSessionId`, `nameSource`, `nameSince`, `version`, `peerProtocol`) and parsing stays
 * intact.
 *
 * S0-T5's `esquemaSaidaAgentsJson` was `z.array(esquemaItemDeAgentsJson)` — tested against real
 * output from a second machine, Linux, a single entry (the background variant) took down the
 * whole array (D-022). `validarSaidaAgentsJson` replaces that schema with item-by-item
 * validation: no collection from an external source can be all-or-nothing.
 *
 * Both schemas were confirmed against real files and real output from two machines before being
 * written — see tests/contrato/registro-de-sessoes.teste.ts and tests/contrato/agents-json.teste.ts.
 * If they ever diverge from reality, the answer is to log it in docs/QUESTOES.md with the raw
 * output observed, never to loosen the schema to make it pass.
 */
import { z } from 'zod';

/**
 * `~/.claude/sessions/<pid>.json` — one file per process, alive or stale. The seven fields below
 * are cited literally by the spec and are the ones discovery uses, but not all of them fail the
 * record if missing — D-021 splits the fields into two groups:
 *
 * - **Identity and liveness, required**: `sessionId` and `cwd` (identify and locate the
 *   session), `pid` and `procStart` (liveness tie-break — PID recycled by the OS), `startedAt`.
 *   Without them there's no way to know which session this is nor whether it's alive — the
 *   session can't enter discovery.
 * - **Classification and display, optional**: `kind`, `entrypoint`, `name`. Cosmetic: without
 *   them the session is still identifiable and capturable, just not precisely
 *   classifiable/nameable. D-021 exists because the previous schema required all three and
 *   rejected the whole record if one was missing — crossed with a suppressed transcript
 *   (D-013), the session became totally invisible. The display defaults (`name` derived from
 *   `cwd`, `kind`/`entrypoint` as "unknown") are the S1-T3 adapter's responsibility, not this
 *   schema's.
 *
 * `kind` and `entrypoint` stay free-form strings, not an enum: only "interactive" and
 * "cli"/"claude-vscode" have been observed on this machine, but the spec already assumes other
 * values exist (`docs/DECISOES.md` D-016 talks about a headless session, which leaves no such
 * record; question Q-002 in docs/QUESTOES.md leaves open whether `kind` gets its own value for
 * it). Locking to a literal would break parsing the day that changes.
 *
 * `procStart` is a string, not a number: the real observed values (e.g. "134313811658518463")
 * exceed `Number.MAX_SAFE_INTEGER` — storing as a number would lose precision in exactly the
 * field used for tie-breaking.
 */
export const sessionRecordSchema = z.object({
  pid: z.number().int().positive(),
  sessionId: z.uuid(),
  cwd: z.string().min(1),
  startedAt: z.number().int().positive(),
  procStart: z.string().regex(/^\d+$/, 'procStart must be a digits-only string'),
  kind: z.string().min(1).optional(),
  entrypoint: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

export type SessionRecord = z.infer<typeof sessionRecordSchema>;

/**
 * An item from the output of `claude agents --json` (D-016). An independent source from the
 * on-disk record — mostly the same shape, but without `entrypoint`. `kind` and `name` follow the
 * same D-021 treatment: cosmetic, optional, never fail the item.
 *
 * There are **two shapes** of item, confirmed against real output from two machines (D-022):
 *
 * - **Interactive**: has `pid` and, only sometimes, `status` (observed: a "busy" session has
 *   `status`, an idle session doesn't have the field).
 * - **Background** (second machine, Linux — e.g. a session that brings up a UI and sits blocked
 *   waiting on its children): **has no `pid`**, uses `id` as the background session's
 *   identifier, and uses `state` instead of `status`.
 *
 * `pid` is optional here for a different reason than the rest of D-021's display group: it isn't
 * cosmetic, it's liveness — it's just that the background variant provides no PID at all, `id`
 * takes its place. **An item without `pid` is never a candidate for process termination
 * (D-002)**: there's no way to send a signal to a process with no PID, and `id` isn't a PID.
 * Whoever implements the termination policy (S1-T3 onward) needs to check `pid !== undefined`
 * before considering the item eligible — there's no other way to get the PID of a background item
 * from this source.
 */
const agentsJsonItemSchema = z.object({
  pid: z.number().int().positive().optional(),
  id: z.string().min(1).optional(),
  sessionId: z.uuid(),
  cwd: z.string().min(1),
  startedAt: z.number().int().positive(),
  kind: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
});

export type AgentsJsonItem = z.infer<typeof agentsJsonItemSchema>;

/**
 * An item from the output of `claude agents --json` that didn't pass the schema, with the reason
 * (D-022). The raw value is preserved — this module only validates; logging the rejection is the
 * caller's responsibility (the discovery adapter, S1-T3).
 */
export interface RejectedAgentsJsonItem {
  raw: unknown;
  reason: string;
}

/**
 * Result of `validateAgentsJsonOutput`: both sides, always both (D-022). Without the rejected
 * ones here, `seeya sessoes` would lie by omission instead of being able to say "3 sessions, 1
 * entry ignored".
 */
export interface AgentsJsonValidationResult {
  accepted: AgentsJsonItem[];
  rejected: RejectedAgentsJsonItem[];
}

/**
 * Validates the output of `claude agents --json` (and `--json --all`) **item by item**, never in
 * bulk (D-022). Before this it was `z.array(agentsJsonItemSchema)` — tested against real output
 * from a second machine, a single entry (the background variant) took down the whole array, and
 * `seeya` lost the entire discovery source because of one session. A valid item goes in; an
 * invalid item is reported with the reason and discarded individually; the operation continues —
 * per CLAUDE.md: "external file corrupted or with an unknown field: log it and move on. Never
 * take down the whole command because of one bad entry."
 *
 * If `value` isn't even an array, the value itself becomes the sole rejected item: the documented
 * output of `claude agents --json` is always an array (docs/TESTES.md), so this shape means
 * reality changed more than one entry — but it still doesn't throw, so as not to take down the
 * caller.
 */
export function validateAgentsJsonOutput(value: unknown): AgentsJsonValidationResult {
  if (!Array.isArray(value)) {
    return {
      accepted: [],
      rejected: [{ raw: value, reason: '`claude agents --json` output is not an array' }],
    };
  }

  const accepted: AgentsJsonItem[] = [];
  const rejected: RejectedAgentsJsonItem[] = [];

  for (const item of value) {
    const result = agentsJsonItemSchema.safeParse(item);
    if (result.success) {
      accepted.push(result.data);
    } else {
      rejected.push({ raw: item, reason: z.prettifyError(result.error) });
    }
  }

  return { accepted, rejected };
}
