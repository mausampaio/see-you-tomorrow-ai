/**
 * Core ports — the interfaces every access to the world has to go through
 * (docs/ARQUITETURA.md § "Princípio"). `core/` declares the interface; `adapters/`
 * implements it; `cli/` is the only composition root that names the concrete implementation and
 * injects it (D-020).
 *
 * **Only the three ports Sprint 1 needs.** docs/ARQUITETURA.md already sketches seven ports (the
 * whole architecture design), but the four missing here all share the same concrete problem: the
 * signature of each references a type that doesn't exist in this project yet. Declaring them now
 * would mean inventing those types too early, just to fill in a signature, or declaring the port
 * with `unknown` — worse than not declaring it. The four, and the type missing from each:
 *
 * - `LeitorDeTranscricao` — returns `FatosDaSessao`, a type that only appears in S2-T3/S2-T4
 *   (out of this task's scope). The cheap transcript reading that Sprint 1 uses (S1-T8, mtime
 *   scan) doesn't go through here: it's `stat`, not content parsing.
 * - `GeradorDeHandoff` — returns `EntendimentoGerado`, also a handoff type. Implemented in
 *   S2-T2.
 * - `Notificador` — implemented in S4-T1. S1-T7's pure rule (notify once per `sessionId`,
 *   never repeating) doesn't need the whole port to be pure; whoever implements S1-T7 decides
 *   the minimal shape that rule needs.
 * - `Armazenamento` — the signature in docs/ARQUITETURA.md uses `Handoff`, `Briefing`,
 *   `EstadoDoDia`, none of which exist yet. S1-T5 declares here whatever it needs, at whatever
 *   size it has at that point (likely `lerConfig`/`salvarEstado` first, growing in S2 for the
 *   handoff/briefing methods).
 *
 * Open question about this scope cut: docs/QUESTOES.md Q-004.
 */
import type { DiscoveredSession } from './types.js';

/**
 * The project's single source of "now" (D-019). Implemented in `adapters/clock/`. No other
 * module calls `new Date()` with no argument, `Date.now()`, or a long-running
 * `setTimeout`/`setInterval` — this port is what returns the instant, and whoever needs it
 * receives it already resolved.
 */
export interface Clock {
  now(): Date;
}

/**
 * Process liveness and termination (D-002, D-023). Implemented in `adapters/process/`
 * (S1-T2). `isAlive` receives `procStart` to break ties on a recycled PID
 * (docs/ESPECIFICACAO.md § "Como as sessões são descobertas") — the pure decision of when two
 * `procStart` values count as the same process lives in
 * `core/classification.ts#pidRepresentsSameProcess`; this port only declares the async
 * contract that the adapter fulfills by querying the real OS.
 */
export interface ProcessControl {
  isAlive(pid: number, procStart?: string): Promise<boolean>;
  terminateGracefully(pid: number, deadlineMs: number): Promise<boolean>;
}

/**
 * Session discovery (D-016, D-023). Implemented in `adapters/discovery/`, merging the
 * strategies of S1-T3 (registry), S1-T8 (transcript scan) and S1-T10 (process + `.key`) into a
 * single deduplicated list of `DiscoveredSession` — `list()` returns the already-merged union,
 * never the raw concatenation of the three sources: callers shouldn't need to know how many
 * strategies exist underneath, nor deduplicate on their own.
 */
export interface SessionProvider {
  list(): Promise<DiscoveredSession[]>;
}
