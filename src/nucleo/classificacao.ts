/**
 * Pure session state classification. See docs/ESPECIFICACAO.md § "Glossário" and
 * docs/DECISOES.md D-016. No I/O or real liveness read happens here — the caller has already
 * resolved `processIsAlive` via the `ProcessControl` port (S1-T2) and passes the result in.
 */
import type { SessionState, DiscoveredSession } from './tipos.js';

export interface ClassificationParams {
  /** The current instant, obtained from the `Clock` port by the caller — never read here (D-019). */
  readonly now: Date;
  /** `minutosParaOcioso` from `config.json` (docs/ARQUITETURA.md § Config). */
  readonly idleMinutes: number;
}

/**
 * Decides whether two `procStart` values — the one recorded at discovery time and the one
 * observed now during a real liveness check (S1-T2) — represent the same process, or whether the
 * PID was recycled by the OS and the entry is stale (docs/ESPECIFICACAO.md § "Como as sessões
 * são descobertas": "PID is recycled by the OS. `procStart` is used to break the tie").
 *
 * Pure comparison, without querying the OS — capturing the two values is the responsibility of
 * `adaptadores/processo` (S1-T2, out of this task's scope). The function itself is a pure
 * predicate (string to boolean, no I/O and no state): there's no reason for it to live outside
 * `nucleo/`, and the layer matrix in docs/ARQUITETURA.md doesn't forbid a pure decision from
 * living here just because the data it compares also feeds an adapter.
 *
 * String equality, not numeric: both sides come in as strings because they exceed
 * `Number.MAX_SAFE_INTEGER` (same reason as `adaptadores/descoberta/esquemas.ts`), and comparing
 * as strings avoids any precision loss on conversion.
 */
export function pidRepresentsSameProcess(
  registeredProcStart: string,
  observedProcStart: string,
): boolean {
  return registeredProcStart === observedProcStart;
}

/**
 * No transcript write for more than `idleMinutes`? **`null` returns `false` (D-025).** `idle` is
 * a claim — "no write for more than X minutes" — and that claim can only be made from a real
 * timestamp that has already passed the limit. `null` isn't a very old timestamp, it's the
 * absence of any data about writing (no transcript, or a suppressed transcript — D-013): there's
 * no way to establish "no write for more than X minutes" when there's no way to establish
 * anything about writing. Treating `null` as "idle" would convert "I don't know" into a positive
 * claim — exactly what D-025 forbids for the whole domain. `alive` (the caller returns `alive`
 * when this function returns `false`) is the least specific state that a live process already
 * supports on its own, and that's what's left when write evidence is missing.
 *
 * Concrete case that motivated the fix: a session without a transcript because of D-013 is
 * exactly the autonomous execution agent, which has every reason to be working at full speed.
 * Marking it `idle` with no evidence of inactivity would confidently lie about the case that
 * matters most.
 */
function isIdleByTranscript(
  lastTranscriptWrite: Date | null,
  now: Date,
  idleMinutes: number,
): boolean {
  if (lastTranscriptWrite === null) {
    return false;
  }
  const minutesSinceLastWrite = (now.getTime() - lastTranscriptWrite.getTime()) / 60_000;
  return minutesSinceLastWrite > idleMinutes;
}

/**
 * Classifies the display state of a discovered session (docs/ESPECIFICACAO.md § "Glossário").
 *
 * Without a PID (`SessionWithoutPid`, D-016): always `unknown` — there's no liveness to check.
 * With a PID: a dead process (stale entry or a process that really ended) is `ended`; a live
 * process is `idle` only when there's a real timestamp of the last write beyond `idleMinutes`,
 * and `alive` in every other case — including with no transcript at all (D-025, see
 * `isIdleByTranscript`).
 */
export function classifyState(
  session: DiscoveredSession,
  params: ClassificationParams,
): SessionState {
  if (!session.hasPid) {
    return 'unknown';
  }

  if (!session.processIsAlive) {
    return 'ended';
  }

  return isIdleByTranscript(session.lastTranscriptWrite, params.now, params.idleMinutes)
    ? 'idle'
    : 'alive';
}
