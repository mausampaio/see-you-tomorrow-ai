/**
 * D-013's multi-source collection, for one session: calls `TranscriptReader`/`GitReader`, merges
 * what they answer into `HandoffFacts`, and decides `sources[]` — which of the three evidence
 * sources actually contributed. A source that throws is treated the same as a source with nothing
 * to say (D-025's "absence of data" applied to a failure, not just a gap): failing to read git or
 * the transcript for ONE session must never take the whole capture down, and it must never take
 * down the OTHER source for the same session either (docs/PLANO-DE-ENTREGA.md S2-T3: "coleta
 * multi-fonte... handoff válido com qualquer fonte respondendo").
 *
 * **Where this guard-rail ends.** A thrown error here is swallowed with no record of WHY that
 * source didn't answer — there's no field in `Handoff` (docs/ESPECIFICACAO.md § "Formato do
 * handoff") to carry a per-source failure reason, only whether it answered at all. This covers the
 * ordinary case (permission denied, file vanished mid-read) silently degrading to "didn't
 * respond"; it doesn't diagnose *why* for someone reading the handoff later. AGENTS.md's "ainda
 * não existe logger" is why this isn't logged either — see docs/QUESTOES.md for this gap flagged
 * for the PO.
 */
import type { GitReader, TranscriptReader } from '../core/ports.js';
import type {
  DiscoveredSession,
  EvidenceSource,
  HandoffFacts,
  SessionFacts,
} from '../core/types.js';

const EMPTY_TRANSCRIPT_FACTS: SessionFacts = {
  lastActivity: null,
  lastPrompts: [],
  touchedFiles: [],
};

interface TranscriptGatherResult {
  readonly facts: SessionFacts;
  readonly responded: boolean;
}

/**
 * `transcript` only counts as answered when `session.hasTranscript` is true (D-013's own table:
 * "Disponível quando: persistência ligada") AND the read didn't throw — never called at all when
 * `hasTranscript` is already known false, since `TranscriptReader.readFacts` would only re-derive
 * the same "not found" outcome `core/ports.ts`'s docstring already promises, at the cost of a real
 * I/O attempt this function can skip knowing the answer in advance.
 */
async function gatherTranscript(
  transcriptReader: TranscriptReader,
  session: DiscoveredSession,
): Promise<TranscriptGatherResult> {
  if (!session.hasTranscript) {
    return { facts: EMPTY_TRANSCRIPT_FACTS, responded: false };
  }
  try {
    const result = await transcriptReader.readFacts(session);
    return { facts: result.facts, responded: true };
  } catch {
    return { facts: EMPTY_TRANSCRIPT_FACTS, responded: false };
  }
}

interface GitGatherResult {
  readonly facts: HandoffFacts['git'];
  readonly responded: boolean;
}

/** `git` counts as answered whenever `cwd` is a repository at all (`hasGit: true`) — regardless of
 * whether anything happened today (docs/ESPECIFICACAO.md's own table: "Disponível quando: `cwd` é
 * repositório"), never gated on "had activity" the way `noRecentActivity` gates eligibility. */
async function gatherGit(gitReader: GitReader, cwd: string): Promise<GitGatherResult> {
  try {
    const result = await gitReader.readFacts(cwd);
    return result.hasGit
      ? { facts: result.facts, responded: true }
      : { facts: null, responded: false };
  } catch {
    return { facts: null, responded: false };
  }
}

export interface GatheredEvidence {
  readonly facts: HandoffFacts;
  readonly sources: readonly EvidenceSource[];
}

/**
 * Gathers every D-013 source for `session` and assembles `HandoffFacts` plus `sources[]`.
 * `registry` needs no I/O at all: it's already known from `session.hasPid` — only the registry
 * discovery strategy (S1-T3) ever produces `SessionWithPid`, so a guaranteed PID IS the "registry
 * answered" signal (`session.cwd`/`session.name` from the transcript-scan strategy, S1-T8, are a
 * *reconstruction*, not the registry, so they don't count here).
 */
export async function gatherEvidence(
  transcriptReader: TranscriptReader,
  gitReader: GitReader,
  session: DiscoveredSession,
): Promise<GatheredEvidence> {
  const [transcript, git] = await Promise.all([
    gatherTranscript(transcriptReader, session),
    gatherGit(gitReader, session.cwd),
  ]);

  const sources: EvidenceSource[] = [];
  if (git.responded) {
    sources.push('git');
  }
  if (transcript.responded) {
    sources.push('transcript');
  }
  if (session.hasPid) {
    sources.push('registry');
  }

  return {
    facts: { ...transcript.facts, git: git.facts },
    sources,
  };
}
