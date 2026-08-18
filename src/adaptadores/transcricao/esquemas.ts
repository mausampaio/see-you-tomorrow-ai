/**
 * zod schemas for transcript lines (`~/.claude/projects/<slug>/<sessionId>.jsonl`). See
 * docs/ESPECIFICACAO.md § "Como as sessões são descobertas" and docs/ARQUITETURA.md § transcricao/.
 *
 * The JSONL isn't public API: Claude Code adds new entry types over time. That's why the parser
 * (S1-T4, out of this task's scope) sniffs each line's `type` field and only tries to validate
 * against a known schema when it recognizes the type — an unknown type is ignored, not an error.
 * `KNOWN_ENTRY_TYPES` here exhaustively documents every type observed so far on this machine, but
 * **it is not used to reject** a type outside the list: that list is a reference for whoever
 * writes the parser, not an allowlist the schema enforces.
 *
 * Only `user` and `assistant` have a structural schema — they're the only two entries the spec
 * says the parser will read ("last prompts, files touched, last activity"), and the only two
 * docs/TESTES.md's contract requires validating against reality
 * (tests/contrato/transcript.teste.ts). Confirmed against 1048 real `user` entries and 1760
 * `assistant` entries, from every project on this machine, with no required field missing in any
 * of them.
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
