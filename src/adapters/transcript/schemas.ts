/**
 * zod schemas for transcript lines (`~/.claude/projects/<slug>/<sessionId>.jsonl`). See
 * docs/ESPECIFICACAO.md § "Como as sessões são descobertas" and docs/ARQUITETURA.md § transcript/.
 *
 * The JSONL isn't public API: Claude Code adds new entry types over time. That's why the parser
 * (`reader.ts`, S1-T4) sniffs each line's `type` field and only tries to validate against a known
 * schema when it recognizes the type — an unknown type is ignored, not an error.
 * `KNOWN_ENTRY_TYPES` here exhaustively documents every type observed so far on this machine, but
 * **it is not used to reject** a type outside the list: that list (and `KNOWN_ENTRY_TYPE_SET`,
 * its `Set` view) is a reference for the parser, not an allowlist the schema enforces.
 *
 * Only `user` and `assistant` have a structural schema — they're the only two entries the spec
 * says the parser will read ("last prompts, files touched, last activity"), and the only two
 * docs/TESTES.md's contract requires validating against reality
 * (tests/contract/transcript.test.ts). Confirmed against 1048 real `user` entries and 1760
 * `assistant` entries, from every project on this machine, with no required field missing in any
 * of them. `userEntryTextSchema`/`assistantEntryToolUseSchema` below extend these two with the
 * one extra content-block field each (`text`, `input.file_path`) fact extraction reads — the two
 * original schemas stay exactly as validated against reality, unchanged.
 */
import { z } from 'zod';

/**
 * Every entry-line type already observed in the real `.jsonl` on this machine (2.1.233). Purely
 * documentational — see the warning above. A new type showing up is not a contract failure.
 */
export const KNOWN_ENTRY_TYPES = [
  'queue-operation',
  'user',
  'assistant',
  'attachment',
  'file-history-snapshot',
  'file-history-delta',
  'ai-title',
  'last-prompt',
  'bridge-session',
  'mode',
  'permission-mode',
  'system',
] as const;

/**
 * A block from `message.content[]`. Only `type` is validated — it's all that's needed to tell
 * text apart from tool use further down; the rest of the block varies by type and by version and
 * passes through `z.object()` unnoticed (dropped, not rejected).
 */
const contentBlockSchema = z.object({
  type: z.string().min(1),
});

/**
 * `content` observed both as a plain string (rare, ~3% of entries) and as an array of blocks (the
 * majority). The parser needs to handle both shapes.
 */
const messageContentSchema = z.union([z.string(), z.array(contentBlockSchema)]);

const messageSchema = z.object({
  role: z.string().min(1),
  content: messageContentSchema,
});

/** Fields common to `user` and `assistant` entries, confirmed present in both. */
const baseEntrySchema = z.object({
  uuid: z.uuid(),
  parentUuid: z.uuid().nullable(),
  isSidechain: z.boolean(),
  sessionId: z.uuid(),
  cwd: z.string().min(1),
  timestamp: z.iso.datetime(),
  message: messageSchema,
});

/**
 * `type: "user"` entry. `promptId` is specific to `user` (the corresponding `assistant` entry has
 * `requestId` instead, not used yet) — that's why it's left out of the base schema.
 */
export const userEntrySchema = baseEntrySchema.extend({
  type: z.literal('user'),
});

export type UserEntry = z.infer<typeof userEntrySchema>;

/** `type: "assistant"` entry. */
export const assistantEntrySchema = baseEntrySchema.extend({
  type: z.literal('assistant'),
});

export type AssistantEntry = z.infer<typeof assistantEntrySchema>;

/**
 * `Set` view of `KNOWN_ENTRY_TYPES`, for the parser (S1-T4) to test a line's `type` field in
 * O(1) without a widening cast: `KNOWN_ENTRY_TYPES.includes(someString)` doesn't type-check as-is
 * (the tuple's element type is a literal union, not `string`), and casting the tuple itself would
 * be exactly the kind of production `as` AGENTS.md asks to avoid. Assigning the inferred
 * `Set<'user' | 'assistant' | ...>` to a `ReadonlySet<string>`-typed binding is enough for
 * TypeScript to accept a plain `string` argument at every call to `.has()` afterward.
 */
export const KNOWN_ENTRY_TYPE_SET: ReadonlySet<string> = new Set(KNOWN_ENTRY_TYPES);

/**
 * Cheap sniff of a line's `type` field alone, before deciding which (if any) full schema to try
 * next — the same "peek before you parse" shape `adapters/discovery/transcript-cwd.ts`'s
 * `entryWithCwdSchema` uses for `cwd`.
 */
export const entryTypeSchema = z.object({ type: z.string().min(1) });

/**
 * A `text` content block, richer than `contentBlockSchema` above (which only keeps `type`, by
 * design — most callers don't need the payload). Fact extraction (S1-T4) is the one caller that
 * does: this is what a real user-typed prompt looks like when `message.content` is an array
 * instead of a plain string.
 */
const textContentBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

/**
 * A `tool_use` content block that names a file, restricted to the three write-capable tools
 * observed in Claude Code's tool set (`Edit`, `Write`, `NotebookEdit`). Read-only tools
 * (`Read`, `Grep`, `Glob`, ...) are deliberately excluded from what counts as a "touched" file —
 * see docs/QUESTOES.md for why this is a judgment call, not something confirmed against a real
 * transcript.
 */
const writeToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  name: z.enum(['Edit', 'Write', 'NotebookEdit']),
  input: z.object({ file_path: z.string().min(1) }),
});

/**
 * `userEntrySchema`, extended with the richer content shape fact extraction needs
 * (`textContentBlockSchema`) instead of `contentBlockSchema`'s bare `{ type }`. Any content block
 * that isn't recognized text still falls through to the generic `{ type }` shape, exactly as
 * tolerant of the unmodeled rest as the original schema — this only adds a payload to the one
 * block type S1-T4 reads, it doesn't narrow what's accepted.
 */
export const userEntryTextSchema = userEntrySchema.extend({
  message: z.object({
    role: z.string().min(1),
    content: z.union([z.string(), z.array(z.union([textContentBlockSchema, contentBlockSchema]))]),
  }),
});

export type UserEntryWithText = z.infer<typeof userEntryTextSchema>;

/**
 * `assistantEntrySchema`, extended the same way `userEntryTextSchema` extends `userEntrySchema`,
 * but keeping BOTH richer block shapes fact extraction reads from an assistant entry:
 * `writeToolUseBlockSchema` (for `touchedFiles`, S1-T4) and `textContentBlockSchema` (for the
 * assistant's own words, S4-T00c/Q-036 — the text a "4 done, 6 pending"-style status turn carries,
 * which `touchedFiles` alone can never surface). Same tolerance-preserving shape as
 * `userEntryTextSchema`: any other block still falls through to the generic `{ type }` shape.
 */
export const assistantEntryWithContentSchema = assistantEntrySchema.extend({
  message: z.object({
    role: z.string().min(1),
    content: z.union([
      z.string(),
      z.array(z.union([textContentBlockSchema, writeToolUseBlockSchema, contentBlockSchema])),
    ]),
  }),
});

export type AssistantEntryWithContent = z.infer<typeof assistantEntryWithContentSchema>;

/**
 * `type: "ai-title"` entry (D-031, Spike I): `{ type, aiTitle, sessionId }`, measured as 388
 * occurrences in one real transcript — rewritten repeatedly as the session's subject evolves.
 * Only `aiTitle` is validated: `sessionId` isn't needed (the caller already knows which session's
 * file it opened), and zod's default "strip unknown keys" tolerance (D-021) keeps this schema
 * working even if Claude Code adds a field here later. Internal, undocumented entry (D-031's own
 * ressalva) — never a `.strict()` schema that would treat a harmless future field as corruption.
 */
export const aiTitleEntrySchema = z.object({
  type: z.literal('ai-title'),
  aiTitle: z.string(),
});

export type AiTitleEntry = z.infer<typeof aiTitleEntrySchema>;

/**
 * `type: "last-prompt"` entry (D-031, Spike I): `{ type, lastPrompt, leafUuid, sessionId }`,
 * measured as 387 occurrences in the same transcript. Only `lastPrompt` is validated — same
 * reasoning as `aiTitleEntrySchema` above for `leafUuid`/`sessionId`.
 */
export const lastPromptEntrySchema = z.object({
  type: z.literal('last-prompt'),
  lastPrompt: z.string(),
});

export type LastPromptEntry = z.infer<typeof lastPromptEntrySchema>;
