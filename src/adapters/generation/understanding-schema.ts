/**
 * The shape `claude -p` is asked to produce for the handoff's "understanding" layer (D-003), and
 * the single source both the runtime validator and the `--json-schema` flag's value are derived
 * from — one zod schema, never a hand-typed JSON Schema kept in sync by hand next to it.
 *
 * Field names match `core/types.ts#GeneratedUnderstanding` and the handoff's own disk keys
 * exactly (AGENTS.md § "Idioma").
 */
import { z } from 'zod';

export const generatedUnderstandingContentSchema = z.object({
  understanding: z.string(),
  pendingItems: z.array(z.string()),
  tomorrowPlan: z.array(z.string()),
});

export type GeneratedUnderstandingContent = z.infer<typeof generatedUnderstandingContentSchema>;

/**
 * The literal string passed to `claude -p --json-schema` (D-011). Built with zod v4's own
 * `z.toJSONSchema` from `generatedUnderstandingContentSchema` above, so the flag's value can never
 * drift from what `extractUnderstanding` (`extract.ts`) actually validates afterwards — confirmed
 * for real (S2-T2, claude 2.1.235, local `claude -p` call, no test in this suite touches the
 * network): asking for exactly this schema makes the model reply with `structured_output` already
 * shaped as `{understanding, pendingItems, tomorrowPlan}`.
 *
 * The `$schema` meta key `z.toJSONSchema` adds by default is stripped before stringifying: the
 * real call above was verified against a schema WITHOUT that key, so this keeps the flag's value
 * exactly what was confirmed instead of an untested variant.
 */
export const UNDERSTANDING_JSON_SCHEMA: string = (() => {
  const schema = z.toJSONSchema(generatedUnderstandingContentSchema) as Record<string, unknown>;
  delete schema['$schema'];
  return JSON.stringify(schema);
})();
