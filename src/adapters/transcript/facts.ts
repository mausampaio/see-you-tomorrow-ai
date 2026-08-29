/**
 * Pure extraction of the two facts that need a content block, not just an entry's top-level
 * fields: the text of a user prompt, and the file paths a write-capable tool touched. No I/O
 * here — `reader.ts` does the streaming and calls these per parsed entry, which is why this file
 * is covered by unit tests (docs/TESTES.md § Unidade: "a lógica pura de `transcript/`"), not
 * integration ones.
 */
import type { UserEntryWithText, AssistantEntryWithToolUse } from './schemas.js';

/**
 * How many of the most recent user prompts `SessionFacts.lastPrompts` keeps. Not specified by
 * docs/ESPECIFICACAO.md or docs/TESTES.md — this is a judgment call, not a measured or decided
 * number; see docs/QUESTOES.md for why it's 10 and what would change it.
 */
export const MAX_LAST_PROMPTS = 10;

/** A content-block union member that carries `text` (`textContentBlockSchema` in schemas.ts). */
interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

function isTextBlock(block: { readonly type: string }): block is TextBlock {
  return 'text' in block;
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
  const { content } = entry.message;
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
export function extractTouchedFiles(entry: AssistantEntryWithToolUse): string[] {
  const { content } = entry.message;
  if (typeof content === 'string') {
    return [];
  }
  return content.filter(isWriteToolUseBlock).map((block) => block.input.file_path);
}
