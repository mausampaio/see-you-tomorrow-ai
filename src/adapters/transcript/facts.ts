/**
 * Pure extraction of the facts that need a content block, not just an entry's top-level fields:
 * the text of a user prompt, the text of an assistant message (S4-T00c), and the file paths a
 * write-capable tool touched. No I/O here — `reader.ts` does the streaming and calls these per
 * parsed entry, which is why this file is covered by unit tests (docs/TESTES.md § Unidade: "a
 * lógica pura de `transcript/`"), not integration ones.
 */
import type { UserEntryWithText, AssistantEntryWithContent } from './schemas.js';

/**
 * How many of the most recent user prompts `SessionFacts.lastPrompts` keeps. Not specified by
 * docs/ESPECIFICACAO.md or docs/TESTES.md — this is a judgment call, not a measured or decided
 * number; see docs/QUESTOES.md for why it's 10 and what would change it.
 */
export const MAX_LAST_PROMPTS = 10;

/**
 * How many of the most recent assistant messages `SessionFacts.assistantMessages` keeps (S4-T00c,
 * Q-036). Same count as `MAX_LAST_PROMPTS`, chosen for symmetry with the user side rather than
 * independently measured — the thing that WAS measured (`docs/spikes/J-cache-na-captura.md` §
 * "S4-T00c") is cost, and it turned out not to discriminate between volumes: a shared,
 * time-windowed cache effect on the fixed `--tools ""`/`--system-prompt`/`--json-schema` apparatus
 * (the same mechanism Spike J's Achado 4 already flagged as unexplained) swings cost by an order
 * of magnitude independently of how much assistant text was sent — the 10-message, ~3.6 KB arm
 * measured CHEAPER (US$ 0,0213) than the 3-message, ~1.7 KB arm (US$ 0,0754) run one minute
 * earlier, because the second call read cache the first call had just written. With volume not
 * predicting cost, the count is chosen for prompt quality instead: `MAX_LAST_PROMPTS`'s own
 * precedent.
 */
export const MAX_ASSISTANT_MESSAGES = 10;

/**
 * Per-message character cap for `SessionFacts.assistantMessages` (S4-T00c, Q-036). Not a
 * cost control — see `MAX_ASSISTANT_MESSAGES`'s docstring, the measurement found volume doesn't
 * reliably predict cost — but a real assistant turn can carry pasted logs, diffs or long code
 * blocks (the away-summary prompt Spike I found even tells the model to skip exactly that kind of
 * content: "root-cause narrative, fix internals"). This bounds a single verbose turn from
 * crowding out the other four facts `buildLeanPrompt` sends, independent of the cache question.
 */
export const MAX_ASSISTANT_MESSAGE_CHARS = 500;

/** Cuts `text` to `MAX_ASSISTANT_MESSAGE_CHARS`, marking the cut so the model never reads a
 * truncated sentence as a complete thought. */
function truncateAssistantMessage(text: string): string {
  if (text.length <= MAX_ASSISTANT_MESSAGE_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_ASSISTANT_MESSAGE_CHARS)} […]`;
}

/** A content-block union member that carries `text` (`textContentBlockSchema` in schemas.ts). */
interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

function isTextBlock(block: { readonly type: string }): block is TextBlock {
  return 'text' in block;
}

/**
 * Shared by `extractPromptText` and `extractAssistantMessageText`: joins every text block's
 * trimmed content with `\n` (a plain-string `content` is already the whole message). `null` when
 * nothing textual was found — D-025's "not found", never evidence that the speaker said nothing.
 */
function joinTextBlocks(content: string | readonly { readonly type: string }[]): string | null {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const text = content
    .filter(isTextBlock)
    .map((block) => block.text.trim())
    .filter((piece) => piece.length > 0)
    .join('\n');
  return text.length > 0 ? text : null;
}

/**
 * The text of a real, human-typed prompt from a `user` entry, or `null` when this entry isn't
 * one — a sub-agent turn (`isSidechain: true`), or a synthetic tool-result turn whose content is
 * entirely non-text. `null` here is D-025's "not found", never evidence that the user wrote
 * nothing.
 */
export function extractPromptText(entry: UserEntryWithText): string | null {
  if (entry.isSidechain) {
    return null;
  }
  return joinTextBlocks(entry.message.content);
}

/**
 * The text of what the assistant itself said in one `assistant` entry (S4-T00c, Q-036) — the data
 * the D-011 reevaluation found structurally missing: `processAssistantEntry` (`reader.ts`) used to
 * read only timestamp and tool-use file paths from this entry type, so a turn like "4 done, 6
 * pending" never reached `SessionFacts` at all. `null`, same as `extractPromptText`, for a
 * sub-agent turn (`isSidechain: true` — internal tool-use narration, not something the assistant
 * told the human) or a turn with no text block at all (pure tool-use, nothing to extract).
 * Truncated to `MAX_ASSISTANT_MESSAGE_CHARS` — see that constant's docstring for why.
 */
export function extractAssistantMessageText(entry: AssistantEntryWithContent): string | null {
  if (entry.isSidechain) {
    return null;
  }
  const text = joinTextBlocks(entry.message.content);
  return text === null ? null : truncateAssistantMessage(text);
}

/** A content-block union member that names a file (`writeToolUseBlockSchema` in schemas.ts). */
interface WriteToolUseBlock {
  readonly type: 'tool_use';
  readonly name: 'Edit' | 'Write' | 'NotebookEdit';
  readonly input: { readonly file_path: string };
}

function isWriteToolUseBlock(block: { readonly type: string }): block is WriteToolUseBlock {
  return 'input' in block;
}

/**
 * Every file path a write-capable tool touched in one `assistant` entry. A plain-string
 * `message.content` (the ~3% shape schemas.ts documents) never carries a tool call, so it
 * contributes nothing — not an error, just no evidence in this entry.
 */
export function extractTouchedFiles(entry: AssistantEntryWithContent): string[] {
  const { content } = entry.message;
  if (typeof content === 'string') {
    return [];
  }
  return content.filter(isWriteToolUseBlock).map((block) => block.input.file_path);
}
