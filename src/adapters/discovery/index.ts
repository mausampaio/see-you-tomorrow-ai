/**
 * Discovery adapter: reads `~/.claude/sessions` and `~/.claude/projects`, implements
 * `SessionProvider`. See docs/ARQUITETURA.md.
 *
 * S1-T3 implements only the **registry strategy** — the first of D-016/D-023's three sources
 * (`registry.ts`). `SessionProvider.list()` itself, the deduplicated union of all three
 * strategies, is S1-T9's job: this module doesn't claim to implement the port yet, it only
 * exports the strategy function for whoever wires the merge (S1-T9) or the composition root
 * (`cli/`, S1-T6) to call. The two sibling strategies (transcript scan, S1-T8; process + `.key`,
 * S1-T10) will each add their own file here, same shape.
 */
export {
  discoverSessionsFromRegistry,
  type RegistryDiscoveryOptions,
  type RegistryDiscoveryResult,
  type RejectedSessionRecord,
} from './registry.js';
